from __future__ import annotations

"""Вход в MAX по QR-коду с отменой, которая срабатывает сразу.

Штатный `QrAuthFlow` из PyMax опрашивает MAX до истечения QR-кода и между
опросами ничего не слушает. Здесь и ожидание ответа, и пауза между опросами идут
наперегонки с событием отмены, поэтому кнопка «Отмена» не ждёт своей очереди, а
вход завершается именно отменой, а не случайной ошибкой транспорта.
"""

import asyncio
import threading
import time
from typing import Any, Callable

Emit = Callable[[str, object], None]


class LoginCancelledError(RuntimeError):
    """Оператор отменил вход до того, как MAX выдал токен."""


def build_auth_flow(
    emit: Emit, cancel: asyncio.Event, requested: threading.Event, passwords: asyncio.Queue
) -> Any:
    """QR-вход PyMax, который реагирует на отмену сразу, а не по таймеру.

    Штатный `QrAuthFlow` опрашивает MAX до истечения QR-кода и между опросами
    ничего не слушает. Здесь и ожидание ответа MAX, и пауза между опросами идут
    наперегонки с событием отмены, поэтому кнопка «Отмена» срабатывает мгновенно
    и вход завершается именно отменой, а не случайной ошибкой транспорта.
    """
    from pymax.auth.qr import QrAuthFlow

    class _QrHandler:
        async def show_qr(self, qr_url: str) -> None:
            # Ссылка входа передаётся только в память процесса: ни лога, ни диска.
            emit("qr", qr_url)

    class _PasswordProvider:
        async def get_password(self, hint: str | None = None) -> str:
            emit("password_required", hint or "")
            value = await first_of(passwords.get(), cancel.wait())
            if value is None or value is True:
                raise LoginCancelledError("Вход отменён оператором")
            # Пароль передаётся как есть: пробелы могут быть его частью, а
            # пустая строка для PyMax означает «спроси ещё раз».
            return str(value)

    class _Flow(QrAuthFlow):
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

    return _Flow(_QrHandler(), _PasswordProvider())


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
