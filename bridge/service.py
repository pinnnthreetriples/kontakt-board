from __future__ import annotations

"""Связка рантайма, состояния авторизации и журнала отправок.

HTTP-слой не знает ни про потоки, ни про event loop: он вызывает эти методы и
получает либо результат, либо `BridgeError` с готовым HTTP-статусом.
"""

import asyncio
import logging
import threading
from concurrent.futures import Future
from concurrent.futures import TimeoutError as FutureTimeoutError
from pathlib import Path
from typing import Any, Coroutine

from history import SendLedger
from phones import mask_phone
from runtime import MaxRuntime
from sending import ResultStatus, SendResult, find_recipient, recipient_name, send_proposal
from state import AuthState

LOG = logging.getLogger("kontakt_bridge")

# Свои таймауты рантайма меньше (поиск 15 с, отправка 20 с). Эти — страховка на
# случай, если задача зависнет вне сетевого вызова.
SEARCH_TIMEOUT = 60.0
SEND_TIMEOUT = 90.0
SHUTDOWN_TIMEOUT = 8.0


class BridgeError(Exception):
    """Ошибка, которую нужно вернуть клиенту как {"ok": false, "error": ...}."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


class BridgeService:
    def __init__(self, data_dir: Path) -> None:
        self.data_dir = data_dir
        self.state = AuthState()
        self.runtime = MaxRuntime(data_dir / "session", self._emit)
        # Рантайм выполняет одну операцию MAX за раз. Лок неблокирующий: честный
        # 409 лучше очереди HTTP-запросов, висящих на сокете.
        self._operation_lock = threading.Lock()

    def _emit(self, name: str, payload: object) -> None:
        # Вызывается из потока рантайма и из его event loop. Только быстрая
        # мутация состояния: ни сети, ни диска, ни ожиданий.
        self.state.apply_event(name, payload)
        LOG.info("Событие MAX %s, состояние %s", name, self.state.snapshot().phase)

    def account_name(self) -> str:
        """Имя подключённого аккаунта. Пустая строка, если MAX его не отдал."""
        client = self.runtime.client
        if client is None or not self.runtime.connected:
            return ""
        try:
            me = getattr(client, "me", None)
            contact = getattr(me, "contact", None)
            name = recipient_name(contact if contact is not None else me)
        except Exception as exc:  # noqa: BLE001 - имя аккаунта не критично
            LOG.warning("Не удалось прочитать имя аккаунта: %s", type(exc).__name__)
            return ""
        return " ".join(name.split())[:160]

    def resume_saved_session(self) -> bool:
        """Подключиться сразу, если сессия уже сохранена с прошлого раза."""
        if not self.runtime.has_saved_session():
            return False
        self.start_connection()
        return True

    def start_connection(self) -> None:
        try:
            self.runtime.start_connection()
        except RuntimeError as exc:
            raise BridgeError(409, str(exc)) from exc
        self.state.mark_connecting()

    def cancel_connection(self) -> None:
        self.runtime.cancel_connection()

    def submit_password(self, password: str) -> None:
        try:
            self.runtime.submit_password(password)
        except RuntimeError as exc:
            raise BridgeError(409, str(exc)) from exc

    def logout(self) -> None:
        try:
            self.runtime.logout()
        except RuntimeError as exc:
            raise BridgeError(409, str(exc)) from exc

    def search(self, phone: str) -> SendResult:
        future = self._submit(find_recipient(self.runtime.client, phone))
        try:
            return future.result(timeout=SEARCH_TIMEOUT)
        except FutureTimeoutError as exc:
            # Проверка номера ничего не пишет, поэтому отмена безопасна.
            future.cancel()
            raise BridgeError(504, "MAX не ответил на проверку номера вовремя.") from exc

    def send(self, phone: str, text: str) -> SendResult:
        future = self._submit(self._send_coro(phone, text))
        try:
            return future.result(timeout=SEND_TIMEOUT)
        except FutureTimeoutError as exc:
            # Отправку НЕ отменяем: запрос мог уже дойти до MAX. Задача доиграет
            # в своём loop и сама закроет запись в журнале, который и остаётся
            # настоящей защитой от дубля.
            LOG.error("Отправка на %s не завершилась вовремя", mask_phone(phone))
            raise BridgeError(
                504,
                "MAX не подтвердил отправку вовремя. Сообщение могло уже уйти, "
                "не повторяйте автоматически, проверьте переписку вручную.",
            ) from exc

    def _submit(self, coro: Coroutine[Any, Any, SendResult]) -> Future[SendResult]:
        """Поставить операцию в event loop рантайма и занять его на время работы."""
        try:
            loop = self._require_connected_loop()
        except BridgeError:
            # Корутина создана раньше проверки, и без закрытия Python пожалуется
            # на «coroutine was never awaited» в постороннем месте.
            coro.close()
            raise
        if not self._operation_lock.acquire(blocking=False):
            coro.close()
            raise BridgeError(409, "Предыдущая операция ещё выполняется")
        try:
            future = asyncio.run_coroutine_threadsafe(coro, loop)
        except RuntimeError as exc:
            # Поток рантайма успел закрыть loop между проверкой и постановкой.
            self._operation_lock.release()
            coro.close()
            raise BridgeError(503, "Соединение с MAX закрылось. Подключитесь заново.") from exc
        # Лок снимает сама задача, а не выход из этого метода: по таймауту
        # отправка продолжает выполняться, и до её конца второй запрос в MAX
        # пускать нельзя.
        future.add_done_callback(lambda _: self._operation_lock.release())
        return future

    async def _send_coro(self, phone: str, text: str) -> SendResult:
        # Журнал открывается внутри потока event loop: соединение sqlite3
        # принадлежит создавшему его потоку.
        with SendLedger(self.data_dir / "send_ledger.sqlite3") as ledger:
            return await send_proposal(self.runtime.client, ledger, phone, text)

    def _require_connected_loop(self) -> asyncio.AbstractEventLoop:
        loop = self.runtime.loop
        if not self.runtime.connected or loop is None:
            raise BridgeError(
                503,
                "Аккаунт MAX не подключён. Войдите по QR-коду в настройках приложения.",
            )
        if self.runtime.client is None:
            raise BridgeError(503, "Клиент MAX недоступен. Повторите вход.")
        return loop

    def shutdown(self) -> None:
        if self.runtime.shutdown(SHUTDOWN_TIMEOUT):
            LOG.info("Фоновый модуль MAX остановлен")
        else:
            LOG.error(
                "Фоновый модуль MAX не остановился за %s секунд. Проверьте, что процесс "
                "python.exe завершился.",
                int(SHUTDOWN_TIMEOUT),
            )


__all__ = ["BridgeError", "BridgeService", "ResultStatus", "SendResult"]
