import json
import threading
import unittest
import urllib.error
import urllib.request
from typing import Any

from http_api import BridgeHandler, BridgeServer
from sending import ResultStatus, SendResult
from state import AuthState

ORIGIN = "http://localhost:5173"


class FakeRuntime:
    connected = True


class FakeService:
    """Двойник BridgeService: HTTP-слой не должен зависеть от рантайма MAX."""

    def __init__(self) -> None:
        self.state = AuthState()
        self.runtime = FakeRuntime()
        self.calls: list[tuple[str, tuple[Any, ...]]] = []
        self.search_result = SendResult(ResultStatus.FOUND, recipient="Иван Петров")
        self.send_result = SendResult(ResultStatus.SENT, recipient="Иван Петров")

    def account_name(self) -> str:
        return "Оператор"

    def start_connection(self) -> None:
        self.calls.append(("start", ()))
        self.state.mark_connecting()

    def cancel_connection(self) -> None:
        self.calls.append(("cancel", ()))

    def submit_password(self, password: str) -> None:
        self.calls.append(("password", (password,)))

    def logout(self) -> None:
        self.calls.append(("logout", ()))

    def search(self, phone: str) -> SendResult:
        self.calls.append(("search", (phone,)))
        return self.search_result

    def send(self, phone: str, text: str) -> SendResult:
        self.calls.append(("send", (phone, text)))
        return self.send_result


class HttpContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.service = FakeService()
        self.server = BridgeServer(
            ("127.0.0.1", 0), BridgeHandler, self.service, frozenset({ORIGIN})
        )
        thread = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.05})
        thread.daemon = True
        thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"
        self.addCleanup(thread.join, 5)
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def call(
        self, path: str, body: dict[str, Any] | None = None, origin: str | None = ORIGIN, content_type: str = "application/json"
    ) -> tuple[int, dict[str, Any]]:
        headers = {}
        if origin is not None:
            headers["Origin"] = origin
        data = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = content_type
        request = urllib.request.Request(f"{self.base}{path}", data=data, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                return response.status, json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read().decode("utf-8"))

    def test_request_without_origin_is_rejected(self) -> None:
        status, body = self.call("/auth/state", origin=None)
        self.assertEqual(status, 403)
        self.assertFalse(body["ok"])

    def test_foreign_origin_is_rejected(self) -> None:
        status, _ = self.call("/auth/state", origin="https://evil.example")
        self.assertEqual(status, 403)

    def test_auth_state_reports_phase_and_account(self) -> None:
        self.service.state.apply_event("connected", True)
        status, body = self.call("/auth/state")
        self.assertEqual(status, 200)
        self.assertEqual(body["state"], "connected")
        self.assertEqual(body["account"], {"name": "Оператор"})

    def test_auth_start_launches_connection(self) -> None:
        status, body = self.call("/auth/start", {})
        self.assertEqual(status, 200)
        self.assertEqual(body["state"], "connecting")
        self.assertEqual(self.service.calls, [("start", ())])

    def test_password_is_passed_untouched(self) -> None:
        self.call("/auth/password", {"password": " пароль "})
        self.assertEqual(self.service.calls, [("password", (" пароль ",))])

    def test_form_content_type_is_rejected(self) -> None:
        # Форма со стороннего сайта не может выставить application/json, поэтому
        # такой запрос всегда проходит предварительную проверку CORS.
        status, _ = self.call("/send", {"phone": "+79093228700"}, content_type="text/plain")
        self.assertEqual(status, 415)

    def test_unknown_phone_format_is_rejected(self) -> None:
        status, body = self.call("/send", {"phone": "123", "text": "КП"})
        self.assertEqual(status, 400)
        self.assertIn("номер", body["error"])

    def test_empty_text_is_rejected(self) -> None:
        status, _ = self.call("/send", {"phone": "+79093228700", "text": "   "})
        self.assertEqual(status, 400)

    def test_search_normalizes_phone_before_lookup(self) -> None:
        status, body = self.call("/search", {"phone": "8 (909) 322-87-00"})
        self.assertEqual(status, 200)
        self.assertTrue(body["found"])
        self.assertEqual(self.service.calls, [("search", ("+79093228700",))])

    def test_successful_send_is_marked_delivered(self) -> None:
        status, body = self.call("/send", {"phone": "+79093228700", "text": "КП"})
        self.assertEqual(status, 200)
        self.assertTrue(body["delivered"])
        self.assertFalse(body["uncertain"])

    def test_unknown_status_is_marked_uncertain(self) -> None:
        self.service.send_result = SendResult(ResultStatus.UNKNOWN, detail="обрыв связи")
        _, body = self.call("/send", {"phone": "+79093228700", "text": "КП"})
        self.assertFalse(body["delivered"])
        self.assertTrue(body["uncertain"])
        self.assertIn("повтор", body["detail"].lower())

    def test_unknown_path_is_not_found(self) -> None:
        status, _ = self.call("/no-such-route", {})
        self.assertEqual(status, 404)


if __name__ == "__main__":
    unittest.main()
