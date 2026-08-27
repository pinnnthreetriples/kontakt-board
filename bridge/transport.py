from __future__ import annotations

"""Транспорт к MAX: строгий TLS и отправка текста без переписывания разметки.

Библиотека PyMax сама по себе умеет и то, и другое «почти»: она берёт прокси из
настроек системы и прогоняет текст через Markdown-форматтер. Для отправки КП
нужно ровно обратное, поэтому здесь живёт подкласс её WebClient.
"""

import asyncio
import hashlib
import logging
import ssl
from pathlib import Path
from typing import Any


MAX_WS_URL = "wss://api.oneme.ru/websocket"
MAX_ORIGIN = "https://web.max.ru"
MAX_HOST = "api.oneme.ru"
MAX_PORT = 443

# api.oneme.ru отдаёт цепочку Let's Encrypt, которая завершается корнем
# ISRG Root X2. Windows добирает корни своей программы по требованию только
# через schannel: браузер сайт открывает, а OpenSSL внутри Python видит лишь то,
# что уже лежит в хранилище, и падает с CERTIFICATE_VERIFY_FAILED. Поэтому этот
# корень лежит рядом с программой и добавляется к системным как ещё один якорь.
#
# Отпечаток закреплён намеренно. Файл, который подкладывают в каталог программы
# и загружают как якорь доверия, иначе стал бы способом подсунуть чужой УЦ.
# Сертификат хранится в DER: тогда закреплённое значение — это канонический
# SHA-256 самого сертификата, а не хеш текстовой обёртки с её переводами строк.
EXTRA_ROOT_PATH = Path(__file__).resolve().parent / "isrg-root-x2.cer"
EXTRA_ROOT_SHA256 = "69729b8e15a86efc177a57afb7171dfc64add28c2fca8cf1507e34453ccb1470"


def build_tls_context() -> ssl.SSLContext:
    """Строгий TLS-контекст для MAX: системные корни плюс закреплённый ISRG Root X2.

    Проверка остаётся полной: сверка имени узла, CERT_REQUIRED, TLS не ниже 1.2,
    цепочка достраивается до самоподписанного корня. Ослаблений вроде
    PARTIAL_CHAIN здесь нет и быть не должно.
    """
    tls = ssl.create_default_context()
    tls.minimum_version = ssl.TLSVersion.TLSv1_2
    tls.check_hostname = True
    tls.verify_mode = ssl.CERT_REQUIRED

    if not EXTRA_ROOT_PATH.is_file():
        # Корня рядом нет: работаем только на системном хранилище, как раньше.
        return tls
    payload = EXTRA_ROOT_PATH.read_bytes()
    digest = hashlib.sha256(payload).hexdigest()
    if digest != EXTRA_ROOT_SHA256:
        # Fail closed: подменённый якорь доверия опаснее отсутствующего.
        raise RuntimeError(
            "Отпечаток файла isrg-root-x2.cer не совпадает с ожидаемым. "
            "Удалите файл или восстановите оригинал, соединение остановлено."
        )
    tls.load_verify_locations(cadata=payload)
    return tls


def build_direct_web_client_class(web_client_base: type[Any]) -> type[Any]:
    """Return a PyMax WebClient subclass that *never* uses system proxies.

    websockets 16 uses the OS/system proxy configuration by default when its
    ``proxy`` argument is omitted. PyMax 2.4.0 omits that argument when
    ``ExtraConfig.proxy`` is None. For an authentication-bearing connection we
    prefer a deterministic direct TLS path, so this subclass supplies a
    transport that passes ``proxy=None`` explicitly.
    """

    from pymax.connection import ConnectionManager
    from pymax.connection.readers import WSReader
    from pymax.protocol.tcp import TcpProtocol
    from pymax.transport.websocket import WebSocketTransport
    from websockets import Origin
    from websockets.asyncio import client as ws_client

    class DirectWebSocketTransport(WebSocketTransport):
        async def connect(self) -> None:
            # Проверка стоит в точке дозвона: здесь видны ровно те значения, с
            # которыми уходит запрос.
            if self.url != MAX_WS_URL:
                raise RuntimeError("Неожиданный адрес MAX WebSocket")
            if self.proxy is not None:
                raise RuntimeError("Прокси для MAX отключён политикой безопасности")

            tls = build_tls_context()

            # Explicit proxy=None is security-relevant. websockets 16 otherwise
            # auto-discovers OS proxy settings.
            self.ws = await ws_client.connect(
                self.url,
                origin=Origin(MAX_ORIGIN),
                proxy=None,
                ssl=tls,
                max_size=1024 * 1024 * 10,
                open_timeout=15,
                close_timeout=10,
            )

    class DirectWebClient(web_client_base):
        async def send_text_exact(self, chat_id: int, text: str) -> Any:
            return await send_text_exact(self._app, chat_id, text)

        def _build_connection(self) -> Any:
            transport = DirectWebSocketTransport(
                url=self.extra_config.url,
                proxy=None,
            )
            reader = WSReader(transport=transport)
            return ConnectionManager(
                reader=reader,
                transport=transport,
                protocol=TcpProtocol(),
            )

    DirectWebClient.__name__ = "DirectWebClient"
    return DirectWebClient


def build_direct_client_class(client_base: type[Any]) -> type[Any]:
    """Клиент MAX поверх TCP: он нужен для входа по SMS.

    Вход по QR-коду умеет только web-клиент, а код из SMS MAX присылает лишь
    тому, кто представился мобильным приложением. Поэтому у моста два клиента, и
    оба ходят через один и тот же строгий TLS.
    """

    from pymax.connection import ConnectionManager
    from pymax.connection.readers import TCPReader
    from pymax.protocol.tcp import TcpProtocol
    from pymax.protocol.tcp.framing import TcpPacketFramer
    from pymax.transport.tcp import TCPTransport

    class DirectTcpTransport(TCPTransport):
        async def connect(self) -> None:
            if (self._host, self._port) != (MAX_HOST, MAX_PORT):
                raise RuntimeError("Неожиданный адрес MAX")
            if self._proxy is not None:
                raise RuntimeError("Прокси для MAX отключён политикой безопасности")

            # Штатный транспорт передаёт ssl=True, то есть только системные
            # корни. ISRG Root X2 среди них нет, и соединение падает на проверке
            # цепочки там, где браузер работает.
            self._reader, self._writer = await asyncio.open_connection(
                MAX_HOST,
                MAX_PORT,
                ssl=build_tls_context(),
                server_hostname=MAX_HOST,
            )

    class DirectClient(client_base):
        async def send_text_exact(self, chat_id: int, text: str) -> Any:
            return await send_text_exact(self._app, chat_id, text)

        def _build_connection(self) -> Any:
            transport = DirectTcpTransport(
                host=self.extra_config.host,
                port=self.extra_config.port,
                proxy=None,
            )
            reader = TCPReader(transport=transport, framer=TcpPacketFramer())
            return ConnectionManager(
                reader=reader,
                transport=transport,
                protocol=TcpProtocol(),
            )

    DirectClient.__name__ = "DirectClient"
    return DirectClient


async def send_text_exact(app: Any, chat_id: int, text: str) -> Any:
    """Отправить текст ровно как есть, без Markdown-разметки PyMax.

    Штатный `send_message` прогоняет текст через форматтер, и звёздочки или
    подчёркивания в КП превратились бы в разметку.
    """
    from pymax.api.messages.payloads import SendMessagePayload, SendMessagePayloadMessage
    from pymax.api.response import require_payload_model
    from pymax.protocol import Opcode
    from pymax.types.domain import Message

    cid = int(app.api.messages._next_cid())
    frame = SendMessagePayload(
        chat_id=chat_id,
        message=SendMessagePayloadMessage(
            text=text,
            cid=cid,
            elements=[],
            attaches=[],
            link=None,
        ),
        notify=True,
    )
    response = await app.invoke(Opcode.MSG_SEND, frame.to_payload())
    message = require_payload_model(response, Message)
    # Несовпадающее подтверждение трактуем как неизвестный исход, а не как
    # успешную доставку: запрос мог дойти до MAX, и повторять его нельзя.
    if message.chat_id is not None and int(message.chat_id) != int(chat_id):
        raise RuntimeError("MAX вернул подтверждение для другого чата")
    if message.cid is not None and int(message.cid) != cid:
        raise RuntimeError("MAX вернул подтверждение с другим CID")
    return message


def silence_websocket_logging() -> None:
    """Keep third-party network diagnostics out of disk/root logs."""
    for name in ("websockets",):
        logger = logging.getLogger(name)
        logger.handlers.clear()
        logger.addHandler(logging.NullHandler())
        logger.setLevel(logging.CRITICAL)
        logger.propagate = False
