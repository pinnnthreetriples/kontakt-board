from __future__ import annotations

"""Состояние авторизации MAX для HTTP-моста.

Рантайм сообщает о себе только событиями, и вызывает их из своего потока и из
своего event loop. Обработчик события не имеет права блокироваться, поэтому тут
нет ни сети, ни диска: только короткая мутация снимка под локом. HTTP-обработчик
читает готовый снимок и никогда не ждёт рантайм.
"""

import threading
from dataclasses import dataclass, replace

# Значения совпадают с контрактом GET /auth/state.
PHASE_IDLE = "idle"
PHASE_CONNECTING = "connecting"
PHASE_QR = "qr"
PHASE_SMS_CODE = "sms_code"
PHASE_PASSWORD = "password"
PHASE_CONNECTED = "connected"
PHASE_ERROR = "error"
PHASE_STOPPED = "stopped"

# Фазы, из которых рантайм может выйти сам: поток ещё жив или только что умер.
_IN_PROGRESS_PHASES = frozenset(
    {PHASE_CONNECTING, PHASE_QR, PHASE_SMS_CODE, PHASE_PASSWORD, PHASE_CONNECTED}
)


@dataclass(frozen=True, slots=True)
class AuthSnapshot:
    phase: str = PHASE_IDLE
    qr_link: str = ""
    error: str = ""


class AuthState:
    """Потокобезопасный автомат авторизации.

    Автомат намеренно «залипающий»: сообщение об ошибке не затирается более
    поздним техническим событием остановки рантайма. Оператор должен увидеть
    первопричину, а не общее «остановлено».
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._snapshot = AuthSnapshot()
        # Кэш отрисованного QR. Ссылка входа — краткоживущий секрет, поэтому кэш
        # сбрасывается вместе с ней и никуда не записывается.
        self._qr_svg_link = ""
        self._qr_svg = ""

    def snapshot(self) -> AuthSnapshot:
        with self._lock:
            return self._snapshot

    def mark_connecting(self) -> None:
        """Вызывается из HTTP-обработчика сразу после запуска подключения."""
        with self._lock:
            self._snapshot = AuthSnapshot(phase=PHASE_CONNECTING)
            self._forget_qr_locked()

    def cached_qr_svg(self, link: str) -> str:
        with self._lock:
            return self._qr_svg if link and self._qr_svg_link == link else ""

    def store_qr_svg(self, link: str, svg: str) -> None:
        with self._lock:
            if self._snapshot.qr_link == link:
                self._qr_svg_link = link
                self._qr_svg = svg

    def apply_event(self, name: str, payload: object) -> None:
        """Обработать событие рантайма. Наружу исключения не выпускает.

        Исключение из обработчика попало бы в поток рантайма и могло оборвать
        его в момент работы с MAX-сессией.
        """
        with self._lock:
            try:
                self._apply_locked(name, payload)
            except Exception:  # noqa: BLE001 - событие не должно ломать рантайм
                self._snapshot = replace(
                    self._snapshot,
                    phase=PHASE_ERROR,
                    error="Внутренняя ошибка обработки события рантайма MAX",
                )

    def _apply_locked(self, name: str, payload: object) -> None:
        current = self._snapshot

        if name == "qr":
            self._snapshot = replace(current, phase=PHASE_QR, qr_link=str(payload or ""), error="")
            self._forget_qr_locked()
            return

        if name == "sms_code_required":
            self._snapshot = replace(current, phase=PHASE_SMS_CODE, qr_link="", error="")
            self._forget_qr_locked()
            return

        if name == "password_required":
            self._snapshot = replace(current, phase=PHASE_PASSWORD, qr_link="", error="")
            self._forget_qr_locked()
            return

        if name == "connected":
            if bool(payload):
                self._snapshot = replace(current, phase=PHASE_CONNECTED, qr_link="", error="")
                self._forget_qr_locked()
            elif current.phase == PHASE_CONNECTED:
                # Отключение без более конкретного события: connection_lost и
                # connection_error приходят раньше и уже описали причину.
                self._snapshot = replace(
                    current, phase=PHASE_STOPPED, qr_link="", error="Соединение с MAX завершено."
                )
            return

        if name == "connection_lost":
            self._set_error_locked("Соединение с MAX закрыто. Подключитесь заново.")
            return

        if name == "connection_error":
            self._set_error_locked(str(payload or "MAX сообщил об ошибке."))
            return

        if name == "session_invalid":
            self._set_error_locked("Сохранённая сессия MAX недействительна. Войдите заново по QR.")
            return

        if name in ("connection_cancelled", "logged_out"):
            self._snapshot = AuthSnapshot(phase=PHASE_IDLE)
            self._forget_qr_locked()
            return

        if name == "runtime_stopped" and current.phase in _IN_PROGRESS_PHASES:
            self._snapshot = replace(
                current, phase=PHASE_STOPPED, qr_link="", error="Фоновый модуль MAX остановлен."
            )
            self._forget_qr_locked()

    def _set_error_locked(self, message: str) -> None:
        self._snapshot = replace(self._snapshot, phase=PHASE_ERROR, qr_link="", error=message)
        self._forget_qr_locked()

    def _forget_qr_locked(self) -> None:
        self._qr_svg_link = ""
        self._qr_svg = ""
