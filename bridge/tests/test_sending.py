import asyncio
import tempfile
import unittest
from pathlib import Path
from typing import Any

from history import SendLedger
from sending import ResultStatus, find_recipient, send_proposal


class FakeApiError(Exception):
    """Двойник PyMax ApiError: явный отказ MAX опознаётся по имени и opcode."""

    opcode = 64


class FakeNotFoundError(Exception):
    """Двойник PyMaxError: так PyMax сообщает, что номера нет в MAX."""


# Мост опознаёт эти ошибки по имени класса: импортировать PyMax в тестах не нужно.
FakeApiError.__name__ = "ApiError"
FakeNotFoundError.__name__ = "PyMaxError"

_DEFAULT_CONTACT = object()


class FakeContact:
    def __init__(self, contact_id: int, name: str) -> None:
        self.id = contact_id
        self.names = [type("Name", (), {"name": name})()]


class FakeClient:
    def __init__(self, contact: Any = _DEFAULT_CONTACT, send_error: Exception | None = None) -> None:
        self.contact = FakeContact(200, "Иван Петров") if contact is _DEFAULT_CONTACT else contact
        self.send_error = send_error
        self.sent: list[tuple[int, str]] = []
        self.me = type("Profile", (), {"contact": FakeContact(100, "Оператор")})()

    async def search_by_phone(self, phone: str) -> Any:
        if self.contact is None:
            raise FakeNotFoundError("missing `contact` in response")
        return self.contact

    def get_chat_id(self, first_user_id: int, second_user_id: int) -> int:
        return first_user_id * 1000 + second_user_id

    async def send_text_exact(self, chat_id: int, text: str) -> Any:
        if self.send_error is not None:
            raise self.send_error
        self.sent.append((chat_id, text))
        return object()


class SendingTests(unittest.TestCase):
    def setUp(self) -> None:
        self._dir = tempfile.TemporaryDirectory()
        self.ledger = SendLedger(Path(self._dir.name) / "ledger.sqlite3")
        self.addCleanup(self._dir.cleanup)
        self.addCleanup(self.ledger.close)

    def send(self, client: FakeClient, text: str = "КП на монтаж", phone: str = "+79093228700") -> Any:
        return asyncio.run(send_proposal(client, self.ledger, phone, text))

    def test_search_reports_found_recipient(self) -> None:
        result = asyncio.run(find_recipient(FakeClient(), "+79093228700"))
        self.assertIs(result.status, ResultStatus.FOUND)
        self.assertEqual(result.recipient, "Иван Петров")

    def test_search_reports_missing_user(self) -> None:
        result = asyncio.run(find_recipient(FakeClient(contact=None), "+79093228700"))
        self.assertIs(result.status, ResultStatus.NOT_FOUND)

    def test_successful_send(self) -> None:
        client = FakeClient()
        result = self.send(client)
        self.assertIs(result.status, ResultStatus.SENT)
        self.assertEqual(client.sent, [(100200, "КП на монтаж")])

    def test_same_text_is_not_sent_twice(self) -> None:
        client = FakeClient()
        self.send(client)
        repeat = self.send(client)
        self.assertIs(repeat.status, ResultStatus.SKIPPED_DUPLICATE)
        self.assertEqual(len(client.sent), 1)

    def test_same_text_to_same_user_via_other_phone_is_blocked(self) -> None:
        client = FakeClient()
        self.send(client)
        repeat = self.send(client, phone="+79093228701")
        self.assertIs(repeat.status, ResultStatus.SKIPPED_DUPLICATE)

    def test_unfinished_attempt_blocks_the_second_phone_of_the_same_person(self) -> None:
        # Мост убили между бронью и ответом MAX: исход неизвестен. Второй номер
        # того же человека в карточке не должен превратиться в дубль КП.
        self.send(FakeClient(send_error=ConnectionError("обрыв")))
        repeat = self.send(FakeClient(), phone="+79093228701")
        self.assertIs(repeat.status, ResultStatus.SKIPPED_DUPLICATE)

    def test_recipient_name_reads_pymax_name_record(self) -> None:
        # У PyMax в записи имени поля необязательные: имя может лежать в
        # first_name, а `name` быть пустым.
        record = type("Name", (), {"name": None, "first_name": "Иван", "last_name": "Петров"})()
        contact = type("Contact", (), {"id": 300, "names": [record]})()
        result = asyncio.run(find_recipient(FakeClient(contact=contact), "+79093228700"))
        self.assertEqual(result.recipient, "Иван")

    def test_rejected_send_releases_reservation(self) -> None:
        rejected = self.send(FakeClient(send_error=FakeApiError("отказ")))
        self.assertIs(rejected.status, ResultStatus.ERROR)
        # Отказ означает, что сообщение точно не ушло, поэтому повтор разрешён.
        retry = self.send(FakeClient())
        self.assertIs(retry.status, ResultStatus.SENT)

    def test_broken_connection_leaves_unknown_and_blocks_retry(self) -> None:
        unknown = self.send(FakeClient(send_error=ConnectionError("обрыв")))
        self.assertIs(unknown.status, ResultStatus.UNKNOWN)
        retry = self.send(FakeClient())
        self.assertIs(retry.status, ResultStatus.SKIPPED_DUPLICATE)

    def test_rate_limit_is_reported_separately(self) -> None:
        result = self.send(FakeClient(send_error=FakeApiError("Too many requests")))
        self.assertIs(result.status, ResultStatus.RATE_LIMITED)

    def test_sending_to_own_account_is_blocked(self) -> None:
        result = self.send(FakeClient(contact=FakeContact(100, "Оператор")))
        self.assertIs(result.status, ResultStatus.ERROR)
        self.assertIn("себе", result.detail)


if __name__ == "__main__":
    unittest.main()
