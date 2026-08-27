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
import time
from contextlib import closing
from pathlib import Path
from typing import Any, Callable

from transport import MAX_WS_URL, build_direct_web_client_class, silence_websocket_logging

Emit = Callable[[str, object], None]

LOG = logging.getLogger("kontakt_bridge")

SESSION_FILE = "session.db"


class LoginCancelledError(RuntimeError):
    """Оператор отменил вход до того, как MAX выдал токен."""


def _build_auth_flow(emit: Emit, cancel: asyncio.Event, passwords: asyncio.Queue) -> Any:
    """QR-вход PyMax, который реагирует на отмену сразу, а не по таймеру.

    Штатный `QrAuthFlow` опрашивает MAX до истечения QR-кода и между опросами
    ничего не слушает. Здесь ожидание идёт одновременно за ответом MAX и за
    событием отмены, поэтому кнопка «Отмена» срабатывает мгновенно.
    """
    from pymax.auth.qr import QrAuthFlow

    class _QrHandler:
        async def show_qr(self, qr_url: str) -> None:
            # Ссылка входа передаётся только в память процесса: ни лога, ни диска.
            emit("qr", qr_url)

    class _PasswordProvider:
        async def get_password(self, hint: str | None = None) -> str:
            emit("password_required", hint or "")
            password_task = asyncio.create_task(passwords.get())
            cancel_task = asyncio.create_task(cancel.wait())
            try:
                done, _ = await asyncio.wait(
                    {password_task, cancel_task}, return_when=asyncio.FIRST_COMPLETED
                )
                if cancel_task in done and cancel.is_set():
                    raise LoginCancelledError("Вход отменён оператором")
                value = await password_task
                if value is None:
                    raise LoginCancelledError("Вход отменён оператором")
                # Пароль передаётся как есть: пробелы могут быть его частью, а
                # пустая строка для PyMax означает «спроси ещё раз».
                return str(value)
            finally:
                for task in (password_task, cancel_task):
                    if not task.done():
                        task.cancel()
                await asyncio.gather(password_task, cancel_task, return_exceptions=True)

    class _Flow(QrAuthFlow):
        async def _poll_qr(self, app: Any, qr_info: Any) -> bool:
            interval = max(0.1, qr_info.polling_interval / 1000)
            expires_at = qr_info.expires_at / 1000

            while time.time() < expires_at:
                if cancel.is_set():
                    raise LoginCancelledError("Вход отменён оператором")

                response = await app.api.auth.check_qr(qr_info.track_id)
                # После «login_available» отмену уже не слушаем: токен вот-вот
                # будет выдан, и его нужно сохранить, чтобы было что отзывать.
                if response.status.login_available:
                    return True

                remaining = max(0.0, expires_at - time.time())
                wait_for = min(interval, remaining)
                if wait_for <= 0:
                    break
                try:
                    await asyncio.wait_for(cancel.wait(), timeout=wait_for)
                except asyncio.TimeoutError:
                    continue
                raise LoginCancelledError("Вход отменён оператором")

            return False

    return _Flow(_QrHandler(), _PasswordProvider())


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
            self._thread = threading.Thread(target=self._thread_main, name="max-runtime", daemon=True)
            self._thread.start()

    def cancel_connection(self) -> None:
        """Отменить вход или закрыть уже открытое соединение."""
        loop, cancel = self.loop, self._cancel
        if loop is None or cancel is None or not loop.is_running():
            return
        loop.call_soon_threadsafe(cancel.set)
        # Событие отмены помогает только пока идёт QR-вход. Если соединение уже
        # установлено, ждать нечего, и его нужно закрыть явно.
        asyncio.run_coroutine_threadsafe(self._close_client(), loop)

    def submit_password(self, password: str) -> None:
        loop, queue = self.loop, self._passwords
        if loop is None or queue is None or not loop.is_running():
            raise RuntimeError("Вход в MAX сейчас не выполняется")
        loop.call_soon_threadsafe(queue.put_nowait, password)

    def logout(self) -> None:
        loop = self.loop
        if not self.connected or loop is None or not loop.is_running():
            raise RuntimeError("Аккаунт MAX не подключён")
        self._wipe_session = True
        asyncio.run_coroutine_threadsafe(self._logout_coro(), loop)

    def shutdown(self, timeout: float) -> bool:
        """Остановить поток рантайма. False — поток не успел завершиться."""
        thread = self._thread
        if thread is None or not thread.is_alive():
            return True
        self.cancel_connection()
        thread.join(timeout)
        return not thread.is_alive()

    async def _close_client(self) -> None:
        client = self.client
        if client is None:
            return
        try:
            await client.close()
        except Exception as exc:  # noqa: BLE001 - закрытие не должно ронять поток
            LOG.warning("Закрытие клиента MAX завершилось ошибкой: %s", type(exc).__name__)

    async def _logout_coro(self) -> None:
        client = self.client
        if client is None:
            return
        try:
            await client.logout()
        except Exception as exc:  # noqa: BLE001 - сессию всё равно стираем локально
            LOG.warning("MAX не подтвердил выход: %s", type(exc).__name__)
        self.connected = False
        self.emit("logged_out", None)
        await self._close_client()

    def _wipe_session_files(self) -> None:
        for suffix in ("", "-wal", "-shm"):
            candidate = self.session_path.with_name(self.session_path.name + suffix)
            try:
                candidate.unlink(missing_ok=True)
            except OSError as exc:
                LOG.error("Не удалось удалить файл сессии MAX: %s", type(exc).__name__)

    def _thread_main(self) -> None:
        try:
            self._run()
        except LoginCancelledError:
            self.emit("connection_cancelled", None)
        except BaseException as exc:  # noqa: BLE001 - поток не должен молча умереть
            LOG.error("Рантайм MAX завершился: %s: %s", type(exc).__name__, exc)
            if _is_invalid_token(exc):
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
            with self._thread_lock:
                self._thread = None
            self.emit("runtime_stopped", None)

    def _run(self) -> None:
        from pymax import ExtraConfig, WebClient

        silence_websocket_logging()
        self.session_dir.mkdir(parents=True, exist_ok=True)

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
            auth_flow=_build_auth_flow(self.emit, cancel, passwords),
        )

        @self.client.on_start()
        async def _on_start(_client: Any) -> None:
            if cancel.is_set():
                # Отмена пришла в момент подтверждения QR: серверная сессия уже
                # создана, поэтому её нужно закрыть, а не просто забыть.
                self._wipe_session = True
                await self._logout_coro()
                raise LoginCancelledError("Вход отменён оператором")
            self.connected = True
            self.emit("connected", True)

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


def _is_invalid_token(exc: BaseException) -> bool:
    """MAX отозвал сохранённый токен: локальную копию надо стереть."""
    text = str(exc).lower()
    return "login token" in text or "token is invalid" in text


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
