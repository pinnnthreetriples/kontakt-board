import tempfile
import unittest
from pathlib import Path

from auth_flow import is_expired_qr
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


class ExpiredQrTests(unittest.TestCase):
    def test_expired_qr_is_recognised(self) -> None:
        self.assertTrue(is_expired_qr(RuntimeError("QR authentication expired")))

    def test_other_runtime_errors_are_not_expired_qr(self) -> None:
        self.assertFalse(is_expired_qr(RuntimeError("Клиент MAX не создан")))
        self.assertFalse(is_expired_qr(ConnectionError("обрыв")))


class RuntimeTests(unittest.TestCase):
    def setUp(self) -> None:
        self._dir = tempfile.TemporaryDirectory()
        self.addCleanup(self._dir.cleanup)
        self.events: list[tuple[str, object]] = []
        self.runtime = MaxRuntime(Path(self._dir.name), lambda name, payload: self.events.append((name, payload)))

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

    def test_sms_login_requires_a_phone(self) -> None:
        # Без номера MAX некуда слать код, и поток запускать незачем.
        with self.assertRaises(RuntimeError):
            self.runtime.start_connection("sms", "")

    def test_answers_are_refused_when_login_is_not_running(self) -> None:
        for answer in (self.runtime.submit_sms_code, self.runtime.submit_password):
            with self.subTest(answer=answer.__name__):
                with self.assertRaises(RuntimeError):
                    answer("1234")


if __name__ == "__main__":
    unittest.main()
