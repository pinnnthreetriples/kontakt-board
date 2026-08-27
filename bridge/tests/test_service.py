import asyncio
import tempfile
import threading
import unittest
from pathlib import Path
from typing import Any

from sending import ResultStatus
from service import BridgeError, BridgeService


class FakeContact:
    id = 200
    names = [type("Name", (), {"name": "Иван Петров"})()]


class FakeClient:
    """Клиент MAX, поиск которого можно задержать и отпустить из теста."""

    def __init__(self) -> None:
        self.release = threading.Event()
        self.entered = threading.Event()
        self.hold = False

    async def search_by_phone(self, phone: str) -> Any:
        if self.hold:
            self.entered.set()
            while not self.release.is_set():
                await asyncio.sleep(0.01)
        return FakeContact()


class FakeRuntime:
    def __init__(self, loop: asyncio.AbstractEventLoop, client: FakeClient) -> None:
        self.loop = loop
        self.client = client
        self.connected = True


class ServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self._dir = tempfile.TemporaryDirectory()
        self.addCleanup(self._dir.cleanup)
        self.loop = asyncio.new_event_loop()
        thread = threading.Thread(target=self.loop.run_forever, daemon=True)
        thread.start()
        # Уборка идёт в обратном порядке: сначала остановить loop, потом
        # дождаться потока и только потом закрывать. Закрытие работающего loop
        # роняет тест ошибкой, не относящейся к делу.
        self.addCleanup(self.loop.close)
        self.addCleanup(thread.join, 5)
        self.addCleanup(lambda: self.loop.call_soon_threadsafe(self.loop.stop))

        self.service = BridgeService(Path(self._dir.name))
        self.client = FakeClient()
        self.service.runtime = FakeRuntime(self.loop, self.client)  # type: ignore[assignment]

    def test_search_returns_recipient(self) -> None:
        result = self.service.search("+79093228700")
        self.assertIs(result.status, ResultStatus.FOUND)
        self.assertEqual(result.recipient, "Иван Петров")

    def test_lock_is_released_after_each_operation(self) -> None:
        # Лок снимает завершившаяся задача, а не выход из метода: если бы этого
        # не происходило, второй запрос вернул бы 409.
        self.service.search("+79093228700")
        self.assertIs(self.service.search("+79093228701").status, ResultStatus.FOUND)

    def test_second_operation_is_rejected_while_first_runs(self) -> None:
        self.client.hold = True
        worker = threading.Thread(target=lambda: self.service.search("+79093228700"), daemon=True)
        worker.start()
        self.addCleanup(worker.join, 5)
        self.addCleanup(self.client.release.set)
        self.assertTrue(self.client.entered.wait(5), "Поиск не начался")

        with self.assertRaises(BridgeError) as caught:
            self.service.search("+79093228701")
        self.assertEqual(caught.exception.status, 409)

    def test_operations_are_refused_without_connection(self) -> None:
        self.service.runtime.connected = False
        with self.assertRaises(BridgeError) as caught:
            self.service.send("+79093228700", "КП")
        self.assertEqual(caught.exception.status, 503)

    def test_closed_loop_is_reported_as_disconnect(self) -> None:
        # Поток рантайма мог закрыть loop сразу после проверки подключения.
        # Оператору это состояние надо показать как «нет связи», а не как
        # внутреннюю ошибку моста.
        closed = asyncio.new_event_loop()
        closed.close()
        self.service.runtime.loop = closed
        with self.assertRaises(BridgeError) as caught:
            self.service.send("+79093228700", "КП")
        self.assertEqual(caught.exception.status, 503)


if __name__ == "__main__":
    unittest.main()
