from __future__ import annotations

"""Фоновый рантайм MAX: поток, event loop и один клиент PyMax внутри него.

PyMax асинхронный, HTTP-сервер моста синхронный и многопоточный. Поэтому клиент
живёт в отдельном потоке со своим event loop, а обработчики запросов общаются с
ним только через `asyncio.run_coroutine_threadsafe` и события.

Автоматический повторный вход намеренно выключен: если сохранённый токен
отозвали, мост сообщает об этом и ждёт явного действия оператора, а не
подсовывает новый QR в фоне.
"""

import asyncio
import logging
import sqlite3
import threading
from contextlib import closing
from pathlib import Path
from typing import Any, Callable

from auth_flow import Emit, LoginCancelledError, build_auth_flow
from transport import MAX_WS_URL, build_direct_web_client_class, silence_websocket_logging

LOG = logging.getLogger("kontakt_bridge")

SESSION_FILE = "session.db"


class MaxRuntime:
    """Владелец потока с PyMax. Публичные методы вызываются из HTTP-потоков."""

    def __init__(self, session_dir: Path, emit: Emit) -> None:
        self.session_dir = session_dir
        self.emit = emit
        self.connected = False
        self.client: Any | None = None
        self.loop: asyncio.AbstractEventLoop | None = None
        self._thread: threading.Thread | None = None
        self._thread_lock = threading.Lock()
        # Отмену взводит `threading.Event`: он работает и до того, как event loop
        # успел стартовать. Событие asyncio нужно только чтобы разбудить loop.
        self._cancel_requested = threading.Event()
        self._cancel: asyncio.Event | None = None
        self._passwords: asyncio.Queue | None = None
        self._wipe_session = False

    @property
    def session_path(self) -> Path:
        return self.session_dir / SESSION_FILE

    def has_saved_session(self) -> bool:
        """Есть ли сохранённый токен MAX.

        Проверяется именно запись в файле: PyMax заводит пустое хранилище уже при
        первой попытке входа, поэтому по наличию файла мост считал бы вход
        выполненным и на каждом запуске молча просил новый QR-код.
        """
        if not self.session_path.is_file():
            return False
        try:
            with closing(sqlite3.connect(self.session_path)) as connection:
                return connection.execute("SELECT 1 FROM sessions LIMIT 1").fetchone() is not None
        except sqlite3.Error as exc:
            LOG.warning("Не удалось прочитать сессию MAX: %s", type(exc).__name__)
            return False

    def start_connection(self) -> None:
        with self._thread_lock:
            if self._thread and self._thread.is_alive():
                raise RuntimeError("Предыдущее подключение MAX ещё завершается. Подождите пару секунд.")
            self._cancel_requested.clear()
            self._thread = threading.Thread(target=self._thread_main, name="max-runtime", daemon=True)
            self._thread.start()

    def cancel_connection(self) -> None:
        """Отменить вход. Если он уже завершился, сессию нужно отозвать.

        Оператор нажимает «Отмена» на экране входа, но между его кликом и
        подтверждением QR проходит секунда опроса состояния. Успевшую появиться
        серверную сессию нельзя просто забыть: её никто потом не найдёт.
        """
        loop, cancel = self._wake_for_stop()
        if loop is not None and cancel is not None and self.connected:
            self._run_in_loop(loop, self._logout_coro())

    def _wake_for_stop(self) -> tuple[asyncio.AbstractEventLoop | None, asyncio.Event | None]:
        """Взвести отмену. Соединение при этом не рвётся.

        Пока идёт вход, закрывать соединение нельзя: оборванный запрос к MAX
        пришёл бы наверх ошибкой транспорта вместо честной отмены. Достаточно
        разбудить ожидание, дальше вход свернётся сам.
        """
        self._cancel_requested.set()
        loop, cancel = self.loop, self._cancel
        if loop is not None and cancel is not None:
            self._in_loop(loop, cancel.set)
        return loop, cancel

    def submit_password(self, password: str) -> None:
        loop, queue = self.loop, self._passwords
        if loop is None or queue is None or not self._in_loop(loop, queue.put_nowait, password):
            raise RuntimeError("Вход в MAX сейчас не выполняется")

    def logout(self) -> None:
        loop = self.loop
        if not self.connected or loop is None or not self._run_in_loop(loop, self._logout_coro()):
            raise RuntimeError("Аккаунт MAX не подключён")

    def shutdown(self, timeout: float) -> bool:
        """Остановить поток рантайма. False — поток не успел завершиться.

        Сессия при остановке НЕ отзывается: мост закрывают вместе с окном
        приложения каждый вечер, и вход по QR не должен требоваться каждое утро.
        """
        thread = self._thread
        if thread is None or not thread.is_alive():
            return True
        loop, _ = self._wake_for_stop()
        if loop is not None:
            # Разрыв намеренный, поэтому соединение помечается закрытым заранее:
            # иначе `_serve_client` сообщил бы о нём как о сетевом сбое.
            self.connected = False
            self._run_in_loop(loop, self._close_client())
        thread.join(timeout)
        return not thread.is_alive()

    @staticmethod
    def _in_loop(loop: asyncio.AbstractEventLoop, call: Callable[..., Any], *args: Any) -> bool:
        """Выполнить вызов в потоке loop. False — loop уже закрыт.

        Проверять `is_running()` заранее бесполезно: поток рантайма может успеть
        закрыть loop между проверкой и вызовом, и тогда прилетает RuntimeError.
        """
        try:
            loop.call_soon_threadsafe(call, *args)
        except RuntimeError:
            return False
        return True

    @staticmethod
    def _run_in_loop(loop: asyncio.AbstractEventLoop, coro: Any) -> bool:
        try:
            asyncio.run_coroutine_threadsafe(coro, loop)
        except RuntimeError:
            # Корутину надо закрыть вручную, иначе Python ругается на
            # «coroutine was never awaited» уже в другом месте.
            coro.close()
            return False
        return True

    async def _close_client(self) -> None:
        client = self.client
        if client is None:
            return
        try:
            await client.close()
        except Exception as exc:  # noqa: BLE001 - закрытие не должно ронять поток
            LOG.warning("Закрытие клиента MAX завершилось ошибкой: %s", type(exc).__name__)

    async def _logout_coro(self) -> None:
        """Завершить серверную сессию и только потом стереть локальную копию.

        Порядок принципиален. Если удалить токен, не дождавшись подтверждения от
        MAX, в списке устройств останется живая web-сессия, которую уже нечем
        отозвать: оператор о ней не узнает.
        """
        client = self.client
        if client is None:
            return
        self.connected = False
        try:
            await client.logout()
        except Exception as exc:  # noqa: BLE001 - сессия ценнее аккуратной трассировки
            LOG.error("MAX не подтвердил выход: %s", type(exc).__name__)
            self.emit(
                "connection_error",
                "MAX не подтвердил завершение сессии. Она сохранена, повторите выход "
                "или завершите её вручную в списке устройств MAX.",
            )
        else:
            self._wipe_session = True
            self.emit("logged_out", None)
        await self._close_client()

    def _wipe_session_files(self) -> None:
        for suffix in ("", "-wal", "-shm"):
            candidate = self.session_path.with_name(self.session_path.name + suffix)
            try:
                candidate.unlink(missing_ok=True)
            except OSError as exc:
                LOG.error("Не удалось удалить файл сессии MAX: %s", type(exc).__name__)

    def _is_invalid_token(self, exc: BaseException) -> bool:
        """MAX отозвал сохранённый токен: локальную копию надо стереть.

        Спрашиваем саму библиотеку, а не разбираем текст: PyMax сверяет опкод и
        код ошибки, и только он знает, что `FAIL_LOGOUT_ALL` (оператор вышел на
        всех устройствах) значит то же самое, что `FAIL_LOGIN_TOKEN`.
        """
        app = getattr(self.client, "_app", None)
        checker = getattr(app, "_is_invalid_login_token_error", None)
        if callable(checker):
            try:
                return bool(checker(exc))
            except Exception:  # noqa: BLE001 - контракт PyMax мог измениться
                LOG.warning("Проверка токена PyMax не отработала, разбираю текст ошибки")
        text = str(exc).upper()
        return "FAIL_LOGIN_TOKEN" in text or "FAIL_LOGOUT_ALL" in text

    def _thread_main(self) -> None:
        try:
            self._run()
        except LoginCancelledError:
            self.emit("connection_cancelled", None)
        except BaseException as exc:  # noqa: BLE001 - поток не должен молча умереть
            LOG.error("Рантайм MAX завершился: %s: %s", type(exc).__name__, exc)
            if self._is_invalid_token(exc):
                self._wipe_session = True
                self.emit("session_invalid", None)
            else:
                self.emit("connection_error", f"Ошибка MAX: {type(exc).__name__}")
        finally:
            self.connected = False
            self.emit("connected", False)
            if self._wipe_session:
                self._wipe_session = False
                self._wipe_session_files()
            self.client = None
            self.loop = None
            self._cancel = None
            self._passwords = None
            # Событие об остановке уходит до того, как слот потока освободится:
            # иначе новое подключение успело бы стартовать и получить это
            # событие как своё, оказавшись в фазе «остановлено».
            self.emit("runtime_stopped", None)
            with self._thread_lock:
                self._thread = None

    def _run(self) -> None:
        from pymax import ExtraConfig, WebClient

        silence_websocket_logging()
        self.session_dir.mkdir(parents=True, exist_ok=True)
        # Флаг привязан к одному прогону потока: подключение не должно унести
        # удаление сессии, заказанное в прошлой жизни рантайма.
        self._wipe_session = False

        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        self.loop = loop
        cancel = asyncio.Event()
        passwords: asyncio.Queue = asyncio.Queue()
        self._cancel = cancel
        self._passwords = passwords

        client_class = build_direct_web_client_class(WebClient)
        self.client = client_class(
            work_dir=str(self.session_dir),
            session_name=SESSION_FILE,
            extra_config=ExtraConfig(
                url=MAX_WS_URL,
                telemetry=False,
                log_level="CRITICAL",
                proxy=None,
                # Переподключение выключено: молчаливый повтор входа скрыл бы от
                # оператора, что сессия больше не действует.
                reconnect=False,
                request_timeout=20.0,
            ),
            auth_flow=build_auth_flow(self.emit, cancel, self._cancel_requested, passwords),
        )

        @self.client.on_start()
        async def _on_start(_client: Any) -> None:
            if self._cancel_requested.is_set():
                # Отмена пришла в момент подтверждения QR: серверная сессия уже
                # создана, поэтому её нужно закрыть, а не просто забыть. О своём
                # исходе `_logout_coro` сообщает сам, и он же закрывает клиента,
                # обрывая эту задачу: после него код здесь уже не выполняется.
                await self._logout_coro()
                return
            self.connected = True
            self.emit("connected", True)

        # Отмена могла прийти, пока поток импортировал PyMax: до сети дело не
        # дошло, отзывать нечего.
        if self._cancel_requested.is_set():
            raise LoginCancelledError("Вход отменён оператором")

        try:
            loop.run_until_complete(self._serve_client())
        finally:
            _drain_loop(loop)

    async def _serve_client(self) -> None:
        """Один прогон PyMax без его собственного цикла переподключения."""
        client = self.client
        if client is None:
            raise RuntimeError("Клиент MAX не создан")
        app = client._app
        try:
            await app.start()
            if not app.started:
                return
            await app.dispatcher.emit_start(client)
            await client._connection.wait_closed()
            if self.connected:
                self.connected = False
                self.emit("connection_lost", None)
                self.emit("connected", False)
        finally:
            await self._close_client()


def _drain_loop(loop: asyncio.AbstractEventLoop) -> None:
    try:
        pending = asyncio.all_tasks(loop)
        for task in pending:
            task.cancel()
        if pending:
            loop.run_until_complete(asyncio.gather(*pending, return_exceptions=True))
    except Exception as exc:  # noqa: BLE001 - остановка не должна ронять поток
        LOG.warning("Не все задачи MAX завершились: %s", type(exc).__name__)
    finally:
        loop.close()
