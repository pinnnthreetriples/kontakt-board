import sqlite3
import tempfile
import unittest
from pathlib import Path

from runtime import MaxRuntime


class FakeApiError(Exception):
    """Двойник PyMax ApiError: текст собирается так же, как в библиотеке."""

    def __init__(self, error: str) -> None:
        super().__init__(f"Ошибка входа [{error}]")
        self.error = error
        self.opcode = 19


class FakeApp:
    """Двойник PyMax App: мост спрашивает про токен именно у библиотеки."""

    @staticmethod
    def _is_invalid_login_token_error(exc: Exception) -> bool:
        return isinstance(exc, FakeApiError) and exc.error in ("FAIL_LOGIN_TOKEN", "FAIL_LOGOUT_ALL")


class FakeClient:
    _app = FakeApp()


class SavedSessionTests(unittest.TestCase):
    def setUp(self) -> None:
        self._dir = tempfile.TemporaryDirectory()
        self.addCleanup(self._dir.cleanup)
        self.events: list[tuple[str, object]] = []
        self.runtime = MaxRuntime(Path(self._dir.name), lambda name, payload: self.events.append((name, payload)))

    def _make_store(self, with_token: bool) -> None:
        self.runtime.session_dir.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.runtime.session_path)
        connection.execute("CREATE TABLE sessions (token TEXT NOT NULL PRIMARY KEY, device_id TEXT NOT NULL)")
        if with_token:
            connection.execute("INSERT INTO sessions VALUES ('token', 'device')")
        connection.commit()
        connection.close()

    def test_missing_file_means_no_session(self) -> None:
        self.assertFalse(self.runtime.has_saved_session())

    def test_empty_store_means_no_session(self) -> None:
        # PyMax создаёт файл уже при неудачной попытке входа.
        self._make_store(with_token=False)
        self.assertFalse(self.runtime.has_saved_session())

    def test_stored_token_means_session(self) -> None:
        self._make_store(with_token=True)
        self.assertTrue(self.runtime.has_saved_session())

    def test_broken_store_is_treated_as_no_session(self) -> None:
        self.runtime.session_dir.mkdir(parents=True, exist_ok=True)
        self.runtime.session_path.write_bytes(b"not a database")
        self.assertFalse(self.runtime.has_saved_session())

    def test_revoked_token_is_recognised_by_pymax(self) -> None:
        # Текст ошибки PyMax выглядит как «... [FAIL_LOGIN_TOKEN]», и разбирать
        # его самостоятельно нельзя: библиотека сверяет опкод и код ошибки.
        self.runtime.client = FakeClient()
        for code in ("FAIL_LOGIN_TOKEN", "FAIL_LOGOUT_ALL"):
            with self.subTest(code=code):
                self.assertTrue(self.runtime._is_invalid_token(FakeApiError(code)))

    def test_other_errors_do_not_wipe_the_session(self) -> None:
        self.runtime.client = FakeClient()
        self.assertFalse(self.runtime._is_invalid_token(FakeApiError("FAIL_RATE_LIMIT")))
        self.assertFalse(self.runtime._is_invalid_token(ConnectionError("обрыв")))

    def test_revoked_token_is_recognised_without_client(self) -> None:
        # Ошибка может прийти до того, как клиент создан: тогда остаётся текст.
        self.assertTrue(self.runtime._is_invalid_token(FakeApiError("FAIL_LOGIN_TOKEN")))

    def test_wipe_removes_session_files(self) -> None:
        self._make_store(with_token=True)
        self.runtime._wipe_session_files()
        self.assertFalse(self.runtime.session_path.exists())


if __name__ == "__main__":
    unittest.main()
