from __future__ import annotations

"""Локальный HTTP-мост между Kontakt Board и мессенджером MAX.

Браузер не может говорить с MAX напрямую: протокол двоичный, поверх WebSocket, и
требует заголовка Origin чужого сайта, который браузер подменить не даёт. Поэтому
рядом с приложением работает этот маленький сервер на loopback: он держит вход по
QR-коду, сессию и отправку КП, а страница обращается к нему обычным JSON.

Запускается скриптом `scripts/start-bridge.ps1`, который сам готовит окружение.
Никакие другие программы для работы не нужны.
"""

import argparse
import logging
import os
import signal
import sys
import threading
from pathlib import Path

from http_api import BridgeHandler, BridgeServer
from service import BridgeError, BridgeService

# Мост слушает только loopback: наружу его API отдавать незачем.
HOST = "127.0.0.1"
DEFAULT_PORT = 8765

# По умолчанию разрешены только адреса разработки: `npm run dev` и `npm run
# preview`. Рабочий запуск занимает первый свободный порт, поэтому его точный
# адрес передаёт `scripts/serve-dist.ps1` ключом --origin. Список конкретных
# источников заменяет собой звёздочку в CORS.
DEFAULT_ORIGINS = tuple(
    f"http://{host}:{port}" for port in (5173, 4173) for host in ("localhost", "127.0.0.1")
)

LOG = logging.getLogger("kontakt_bridge")


def resolve_data_dir() -> Path:
    """Папка для сессии MAX и журнала отправок, рядом с данными других программ."""
    local = os.environ.get("LOCALAPPDATA")
    if local:
        return Path(local) / "KontaktBoard"
    return Path.home() / ".kontakt-board"


def configure_logging() -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    LOG.handlers.clear()
    LOG.addHandler(handler)
    LOG.setLevel(logging.INFO)
    LOG.propagate = False


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="bridge.py", description="Локальный HTTP-мост Kontakt Board к MAX"
    )
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="Порт прослушивания")
    parser.add_argument(
        "--origin",
        action="append",
        dest="origins",
        metavar="URL",
        help="Дополнительный разрешённый Origin браузера. Можно указать несколько раз.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    configure_logging()

    origins = frozenset(DEFAULT_ORIGINS) | frozenset(args.origins or ())
    service = BridgeService(resolve_data_dir())
    try:
        server = BridgeServer((HOST, args.port), BridgeHandler, service, origins)
    except OSError as exc:
        print(f"ОШИБКА: не удалось занять {HOST}:{args.port}: {exc}")
        print("Скорее всего мост уже запущен в другом окне.")
        return 5

    print(f"Мост слушает http://{HOST}:{args.port}")
    print("Остановка: Ctrl+C", flush=True)
    try:
        if service.resume_saved_session():
            LOG.info("Найдена сохранённая сессия MAX: подключаюсь без нового QR")
        else:
            LOG.info("Сохранённой сессии MAX нет: жду входа по QR из приложения")
    except BridgeError as exc:
        LOG.error("Автоподключение не запущено: %s", exc.message)

    # serve_forever() крутится в отдельном потоке, а главный только ждёт сигнал:
    # обработчик сигнала выполняется в главном потоке, а server.shutdown() из
    # самого потока serve_forever дал бы дедлок.
    stop = threading.Event()

    def _request_stop(signum: int, _frame: object) -> None:
        LOG.info("Получен сигнал %s: останавливаю мост", signum)
        stop.set()

    signal.signal(signal.SIGINT, _request_stop)
    if hasattr(signal, "SIGBREAK"):
        signal.signal(signal.SIGBREAK, _request_stop)  # type: ignore[attr-defined]

    http_thread = threading.Thread(
        target=server.serve_forever, kwargs={"poll_interval": 0.5}, name="bridge-http", daemon=True
    )
    http_thread.start()
    try:
        while not stop.wait(0.5):
            pass
    except KeyboardInterrupt:
        LOG.info("Получен Ctrl+C: останавливаю мост")
    finally:
        server.shutdown()
        server.server_close()
        service.shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
