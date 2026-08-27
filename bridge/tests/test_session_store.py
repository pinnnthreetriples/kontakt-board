import sqlite3
import tempfile
import unittest
from pathlib import Path

from session_store import MODE_QR, MODE_SMS, SessionFiles


class SessionFilesTests(unittest.TestCase):
    def setUp(self) -> None:
        self._dir = tempfile.TemporaryDirectory()
        self.addCleanup(self._dir.cleanup)
        self.session = SessionFiles(Path(self._dir.name))

    def _make_store(self, with_token: bool) -> None:
        connection = sqlite3.connect(self.session.db)
        connection.execute("CREATE TABLE sessions (token TEXT NOT NULL PRIMARY KEY, device_id TEXT NOT NULL)")
        if with_token:
            connection.execute("INSERT INTO sessions VALUES ('token', 'device')")
        connection.commit()
        connection.close()

    def test_missing_file_means_no_session(self) -> None:
        self.assertFalse(self.session.has_token())

    def test_empty_store_means_no_session(self) -> None:
        # PyMax создаёт файл уже при неудачной попытке входа.
        self._make_store(with_token=False)
        self.assertFalse(self.session.has_token())

    def test_stored_token_means_session(self) -> None:
        self._make_store(with_token=True)
        self.assertTrue(self.session.has_token())

    def test_broken_store_is_treated_as_no_session(self) -> None:
        self.session.db.write_bytes(b"not a database")
        self.assertFalse(self.session.has_token())

    def test_login_mode_defaults_to_qr(self) -> None:
        self.assertEqual(self.session.saved_login(), (MODE_QR, ""))

    def test_sms_login_remembers_phone(self) -> None:
        # Мобильный токен не примет web-клиент, поэтому способ входа надо знать
        # до подключения, а телефон нужен самому клиенту PyMax.
        self.session.remember(MODE_SMS, "+79093228700")
        self.assertEqual(self.session.saved_login(), (MODE_SMS, "+79093228700"))

    def test_damaged_mode_file_falls_back_to_qr(self) -> None:
        self.session.mode_path.write_text("не json", encoding="utf-8")
        self.assertEqual(self.session.saved_login(), (MODE_QR, ""))

    def test_wipe_removes_session_and_mode(self) -> None:
        self._make_store(with_token=True)
        self.session.remember(MODE_SMS, "+79093228700")
        self.session.wipe()
        self.assertFalse(self.session.db.exists())
        self.assertFalse(self.session.mode_path.exists())
        self.assertEqual(self.session.saved_login(), (MODE_QR, ""))


if __name__ == "__main__":
    unittest.main()
