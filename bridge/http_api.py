from __future__ import annotations

"""HTTP-слой моста: маршруты, CORS и перевод результатов MAX в JSON.

Контракт этих ответов читает `src/features/max-bridge` в приложении. Менять
поля можно только вместе с ним.
"""

import json
import logging
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable

from phones import mask_phone, normalize_phone
from qr import render_qr_svg
from service import BridgeError, BridgeService, ResultStatus
from state import PHASE_CONNECTED, PHASE_QR

MAX_BODY_BYTES = 64 * 1024
MAX_TEXT_LENGTH = 10_000
PREFLIGHT_MAX_AGE = "600"

BRIDGE_VERSION = "2.0"

LOG = logging.getLogger("kontakt_bridge")


@dataclass(frozen=True, slots=True)
class SendOutcome:
    """Как трактовать конкретный статус отправки в ответе POST /send."""

    delivered: bool
    uncertain: bool
    note: str = ""


# Каждый статус описан явно: вызывающая сторона обязана различать «точно не
# отправлено» и «возможно, уже отправлено».
SEND_OUTCOMES: dict[ResultStatus, SendOutcome] = {
    ResultStatus.SENT: SendOutcome(delivered=True, uncertain=False),
    ResultStatus.UNKNOWN: SendOutcome(
        delivered=False,
        uncertain=True,
        note="Сообщение могло уже уйти в MAX. Автоматический повтор запрещён, "
        "проверьте переписку вручную.",
    ),
    ResultStatus.SKIPPED_DUPLICATE: SendOutcome(
        delivered=False,
        uncertain=False,
        note="Отправка не выполнялась: защита от повторов заблокировала дубль.",
    ),
    ResultStatus.NOT_FOUND: SendOutcome(delivered=False, uncertain=False),
    ResultStatus.RATE_LIMITED: SendOutcome(
        delivered=False,
        uncertain=False,
        note="MAX отклонил запрос из-за лимита. Повторите позже вручную.",
    ),
    ResultStatus.ERROR: SendOutcome(delivered=False, uncertain=False),
}


class BridgeServer(ThreadingHTTPServer):
    daemon_threads = True
    # Второй экземпляр моста не должен подхватить тот же порт: занятый порт —
    # это и есть проверка «мост уже запущен».
    allow_reuse_address = False

    def __init__(
        self,
        address: tuple[str, int],
        handler: type[BaseHTTPRequestHandler],
        service: BridgeService,
        allowed_origins: frozenset[str],
    ) -> None:
        super().__init__(address, handler)
        self.service = service
        self.allowed_origins = allowed_origins


class BridgeHandler(BaseHTTPRequestHandler):
    server_version = f"KontaktBoardBridge/{BRIDGE_VERSION}"
    sys_version = ""
    protocol_version = "HTTP/1.1"

    # ------------------------------------------------------------------ ответы

    def _send_json(self, status: int, body: dict[str, Any], origin: str) -> None:
        payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Vary", "Origin")
        if origin:
            # Никогда не "*": звёздочка разрешила бы любому сайту читать
            # состояние авторизации и результаты отправки.
            self.send_header("Access-Control-Allow-Origin", origin)
        if status >= 400:
            # Тело отклонённого запроса не вычитывается, поэтому keep-alive
            # оставил бы соединение рассинхронизированным.
            self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(payload)

    def _send_error_json(self, status: int, message: str, origin: str = "") -> None:
        self._send_json(status, {"ok": False, "error": message}, origin)

    def log_message(self, fmt: str, *args: Any) -> None:
        LOG.info("%s %s", self.command or "-", self.path or "-")

    # ---------------------------------------------------------------- проверки

    def _validated_origin(self) -> str:
        """Единственная защита от CSRF: чужой сайт не должен слать КП в MAX.

        Запрос без Origin тоже отклоняется: на loopback это либо посторонний
        инструмент, либо простая форма со случайного сайта.
        """
        origin = self.headers.get("Origin", "")
        allowed: frozenset[str] = self.server.allowed_origins  # type: ignore[attr-defined]
        if origin and origin in allowed:
            return origin
        raise BridgeError(403, "Источник запроса не разрешён")

    def _read_json_body(self) -> dict[str, Any]:
        raw_length = self.headers.get("Content-Length", "0")
        try:
            length = int(raw_length)
        except ValueError as exc:
            raise BridgeError(400, "Некорректный заголовок Content-Length") from exc
        if length < 0:
            raise BridgeError(400, "Некорректный заголовок Content-Length")
        if length > MAX_BODY_BYTES:
            raise BridgeError(413, "Тело запроса слишком большое")
        if length == 0:
            return {}

        content_type = self.headers.get("Content-Type", "").split(";")[0].strip().lower()
        if content_type != "application/json":
            # Вместе с проверкой Origin это гарантирует предварительный
            # CORS-запрос: простая форма такой Content-Type отправить не может.
            raise BridgeError(415, "Ожидается Content-Type: application/json")

        body = self.rfile.read(length)
        if len(body) != length:
            raise BridgeError(400, "Тело запроса получено не полностью")
        try:
            parsed = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise BridgeError(400, "Тело запроса не является корректным JSON") from exc
        if not isinstance(parsed, dict):
            raise BridgeError(400, "Ожидается JSON-объект")
        return parsed

    @staticmethod
    def _text_field(body: dict[str, Any], key: str) -> str:
        value = body.get(key)
        if value is None:
            return ""
        if not isinstance(value, str):
            raise BridgeError(400, f"Поле «{key}» должно быть строкой")
        return value

    @staticmethod
    def _normalized_phone(raw: str) -> str:
        phone = normalize_phone(raw)
        if phone is None:
            raise BridgeError(
                400,
                "Некорректный номер телефона. Ожидается российский номер "
                "(9XXXXXXXXX, 8XXXXXXXXXX, +7XXXXXXXXXX) или номер в формате +<код><номер>.",
            )
        return phone

    # -------------------------------------------------------------- маршруты

    def do_OPTIONS(self) -> None:  # noqa: N802 - имя задано BaseHTTPRequestHandler
        try:
            origin = self._validated_origin()
        except BridgeError as exc:
            self._send_error_json(exc.status, exc.message)
            return
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", PREFLIGHT_MAX_AGE)
        self.send_header("Content-Length", "0")
        self.send_header("Vary", "Origin")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        self._dispatch({"/auth/state": self._auth_state})

    def do_POST(self) -> None:  # noqa: N802
        self._dispatch(
            {
                "/auth/start": self._auth_start,
                "/auth/sms/start": self._auth_sms_start,
                "/auth/sms/code": self._auth_sms_code,
                "/auth/cancel": self._auth_cancel,
                "/auth/password": self._auth_password,
                "/auth/logout": self._auth_logout,
                "/search": self._search,
                "/send": self._send,
            }
        )

    def _dispatch(self, routes: dict[str, Callable[[str], None]]) -> None:
        origin = ""
        try:
            origin = self._validated_origin()
            handler = routes.get(self.path.split("?", 1)[0])
            if handler is None:
                raise BridgeError(404, "Неизвестный адрес")
            handler(origin)
        except BridgeError as exc:
            self._send_error_json(exc.status, exc.message, origin)
        except Exception as exc:  # noqa: BLE001 - мост не должен падать из-за запроса
            LOG.error("Внутренняя ошибка обработчика: %s", type(exc).__name__)
            self._send_error_json(500, f"Внутренняя ошибка моста: {type(exc).__name__}", origin)

    # ----------------------------------------------------------- обработчики

    @property
    def _service(self) -> BridgeService:
        return self.server.service  # type: ignore[attr-defined,no-any-return]

    def _auth_state(self, origin: str) -> None:
        service = self._service
        snapshot = service.state.snapshot()
        body: dict[str, Any] = {"ok": True, "state": snapshot.phase}

        if snapshot.phase == PHASE_QR and snapshot.qr_link:
            body["qrLink"] = snapshot.qr_link
            svg = service.state.cached_qr_svg(snapshot.qr_link)
            if not svg:
                # Отрисовка идёт в потоке HTTP-запроса, а не в обработчике
                # события: рантайм нельзя блокировать. Результат кэшируется до
                # следующей QR-ссылки.
                svg = render_qr_svg(snapshot.qr_link)
                if svg:
                    service.state.store_qr_svg(snapshot.qr_link, svg)
            if svg:
                body["qrSvg"] = svg

        if snapshot.error:
            body["error"] = snapshot.error

        if snapshot.phase == PHASE_CONNECTED:
            name = service.account_name()
            if name:
                body["account"] = {"name": name}

        self._send_json(200, body, origin)

    def _auth_start(self, origin: str) -> None:
        self._read_json_body()
        self._service.start_connection()
        self._send_json(200, {"ok": True, "state": "connecting"}, origin)

    def _auth_sms_start(self, origin: str) -> None:
        body = self._read_json_body()
        phone = self._normalized_phone(self._text_field(body, "phone"))
        self._service.start_sms_connection(phone)
        LOG.info("Вход по SMS для %s", mask_phone(phone))
        self._send_json(200, {"ok": True, "state": "connecting"}, origin)

    def _auth_sms_code(self, origin: str) -> None:
        body = self._read_json_body()
        if "code" not in body:
            raise BridgeError(400, "Не передано поле «code»")
        code = "".join(char for char in self._text_field(body, "code") if char.isdigit())
        if not code:
            raise BridgeError(400, "Код из SMS состоит из цифр")
        self._service.submit_sms_code(code)
        self._send_json(200, {"ok": True}, origin)

    def _auth_cancel(self, origin: str) -> None:
        self._read_json_body()
        self._service.cancel_connection()
        self._send_json(200, {"ok": True}, origin)

    def _auth_password(self, origin: str) -> None:
        body = self._read_json_body()
        if "password" not in body:
            raise BridgeError(400, "Не передано поле «password»")
        # Пароль передаётся как есть: пробелы могут быть его частью.
        self._service.submit_password(self._text_field(body, "password"))
        self._send_json(200, {"ok": True}, origin)

    def _auth_logout(self, origin: str) -> None:
        self._read_json_body()
        self._service.logout()
        self._send_json(200, {"ok": True}, origin)

    def _search(self, origin: str) -> None:
        body = self._read_json_body()
        phone = self._normalized_phone(self._text_field(body, "phone"))
        result = self._service.search(phone)
        LOG.info("Проверка %s, статус %s", mask_phone(phone), result.status.name)
        self._send_json(
            200,
            {
                "ok": True,
                "found": result.status is ResultStatus.FOUND,
                "recipient": result.recipient,
                "status": result.status.name,
                "detail": result.detail,
            },
            origin,
        )

    def _send(self, origin: str) -> None:
        body = self._read_json_body()
        phone = self._normalized_phone(self._text_field(body, "phone"))
        text = self._text_field(body, "text")
        if not text.strip():
            raise BridgeError(400, "Текст сообщения пуст")
        if len(text) > MAX_TEXT_LENGTH:
            raise BridgeError(400, f"Текст сообщения длиннее {MAX_TEXT_LENGTH} символов")

        result = self._service.send(phone, text)
        outcome = SEND_OUTCOMES.get(result.status, SendOutcome(delivered=False, uncertain=True))
        LOG.info("Отправка %s, статус %s", mask_phone(phone), result.status.name)

        detail = result.detail
        if outcome.note:
            detail = f"{detail}. {outcome.note}" if detail else outcome.note

        self._send_json(
            200,
            {
                "ok": True,
                "status": result.status.name,
                "recipient": result.recipient,
                "detail": detail,
                "delivered": outcome.delivered,
                "uncertain": outcome.uncertain,
            },
            origin,
        )
