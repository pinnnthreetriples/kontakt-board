from __future__ import annotations

"""Вход в MAX: по QR-коду или по номеру телефона с кодом из SMS.

Оба сценария живут здесь, потому что у них общая механика: ответы оператора
приходят из HTTP-потока через очередь, а отмена должна срабатывать сразу, не
дожидаясь ответа MAX. Штатные провайдеры PyMax для этого не годятся: они читают
консоль, а между опросами ничего не слушают.
"""

import asyncio
import threading
import time
from typing import Any, Callable

Emit = Callable[[str, object], None]

# Пять кодов по 120 секунд: десять минут на вход, дальше окно явно забыли.
QR_ROUNDS = 5


def is_expired_qr(exc: BaseException) -> bool:
    """Истёкший QR PyMax сообщает обычным RuntimeError с этим текстом.

    Отдельная ветка нужна оператору: это не поломка, а просто «не успел», и
    единственное действие здесь — открыть новый код.
    """
    return isinstance(exc, RuntimeError) and "qr authentication expired" in str(exc).lower()


class LoginCancelledError(RuntimeError):
    """Оператор отменил вход до того, как MAX выдал токен."""


async def first_of(work: Any, cancellation: Any) -> Any:
    """Результат первой завершившейся корутины. `True` означает отмену.

    Проигравшая корутина снимается и дожидается, иначе PyMax остался бы с
    висящей задачей, которая позже допишет что-нибудь в закрытое соединение.
    """
    work_task = asyncio.ensure_future(work)
    cancel_task = asyncio.ensure_future(cancellation)
    try:
        done, _ = await asyncio.wait({work_task, cancel_task}, return_when=asyncio.FIRST_COMPLETED)
        if work_task in done:
            return work_task.result()
        return True
    finally:
        for task in (work_task, cancel_task):
            if not task.done():
                task.cancel()
        await asyncio.gather(work_task, cancel_task, return_exceptions=True)


async def _answer(queue: asyncio.Queue, cancel: asyncio.Event) -> str:
    """Дождаться ответа оператора. Отмена приходит сюда исключением."""
    value = await first_of(queue.get(), cancel.wait())
    if value is None or value is True:
        raise LoginCancelledError("Вход отменён оператором")
    return str(value)


class _PasswordProvider:
    """Пароль второго фактора приходит из интерфейса, а не из консоли."""

    def __init__(self, emit: Emit, cancel: asyncio.Event, passwords: asyncio.Queue) -> None:
        self._emit = emit
        self._cancel = cancel
        self._passwords = passwords

    async def get_password(self, hint: str | None = None) -> str:
        self._emit("password_required", hint or "")
        # Пароль передаётся как есть: пробелы могут быть его частью, а пустая
        # строка для PyMax означает «спроси ещё раз».
        return await _answer(self._passwords, self._cancel)


def build_qr_auth_flow(
    emit: Emit, cancel: asyncio.Event, requested: threading.Event, passwords: asyncio.Queue
) -> Any:
    """QR-вход, который переживает истечение кода и мгновенно реагирует на отмену.

    Штатный `QrAuthFlow` опрашивает MAX до истечения кода и между опросами ничего
    не слушает, а истёкший код роняет весь вход. Здесь ожидание идёт наперегонки
    с событием отмены, а мёртвый код молча заменяется новым.
    """
    from pymax.auth.qr import QrAuthFlow

    class _QrHandler:
        async def show_qr(self, qr_url: str) -> None:
            # Ссылка входа передаётся только в память процесса: ни лога, ни диска.
            emit("qr", qr_url)

    class _Flow(QrAuthFlow):
        async def authenticate(self, app: Any) -> Any:
            """Держать на экране живой код, пока оператор ищет сканер.

            MAX даёт на код ровно 120 секунд. Этого мало: пока человек берёт
            телефон и открывает камеру, код успевает умереть, и вход падает
            ошибкой на ровном месте. Сдаёмся только после нескольких кругов,
            чтобы забытое открытым окно не просило у MAX коды до вечера.
            """
            for _ in range(QR_ROUNDS):
                try:
                    return await super().authenticate(app)
                except RuntimeError as exc:
                    if not is_expired_qr(exc) or requested.is_set():
                        raise
            raise RuntimeError("QR authentication expired")

        async def _poll_qr(self, app: Any, qr_info: Any) -> bool:
            interval = max(0.1, qr_info.polling_interval / 1000)
            expires_at = qr_info.expires_at / 1000

            while time.time() < expires_at:
                if requested.is_set():
                    raise LoginCancelledError("Вход отменён оператором")

                response = await first_of(app.api.auth.check_qr(qr_info.track_id), cancel.wait())
                if response is True:
                    raise LoginCancelledError("Вход отменён оператором")
                # После «login_available» отмену уже не слушаем: токен вот-вот
                # будет выдан, и его нужно сохранить, чтобы было что отзывать.
                if response.status.login_available:
                    return True

                wait_for = min(interval, max(0.0, expires_at - time.time()))
                if wait_for <= 0:
                    break
                try:
                    await asyncio.wait_for(cancel.wait(), timeout=wait_for)
                except asyncio.TimeoutError:
                    continue
                raise LoginCancelledError("Вход отменён оператором")

            return False

    return _Flow(_QrHandler(), _PasswordProvider(emit, cancel, passwords))


def build_sms_auth_flow(
    emit: Emit, cancel: asyncio.Event, codes: asyncio.Queue, passwords: asyncio.Queue
) -> Any:
    """Вход по номеру телефона: MAX присылает код в SMS, оператор вводит его.

    Запасной путь для случая, когда отсканировать QR нечем. Работает только на
    мобильном клиенте PyMax: web-режим коды по SMS не запрашивает.
    """
    from pymax.auth.sms import SmsAuthFlow

    class _CodeProvider:
        async def get_code(self, phone: str) -> str:
            emit("sms_code_required", "")
            # Пробелы и дефисы оператор наверняка скопирует вместе с кодом.
            return "".join(char for char in await _answer(codes, cancel) if char.isdigit())

    return SmsAuthFlow(_CodeProvider(), _PasswordProvider(emit, cancel, passwords))
