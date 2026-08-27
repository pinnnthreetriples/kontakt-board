import unittest

from state import (
    PHASE_CONNECTED,
    PHASE_CONNECTING,
    PHASE_ERROR,
    PHASE_IDLE,
    PHASE_PASSWORD,
    PHASE_QR,
    PHASE_STOPPED,
    AuthState,
)


class AuthStateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.state = AuthState()

    def test_starts_idle(self) -> None:
        self.assertEqual(self.state.snapshot().phase, PHASE_IDLE)

    def test_full_login_path(self) -> None:
        self.state.mark_connecting()
        self.assertEqual(self.state.snapshot().phase, PHASE_CONNECTING)
        self.state.apply_event("qr", "https://max.ru/qr/abc")
        self.assertEqual(self.state.snapshot().phase, PHASE_QR)
        self.assertEqual(self.state.snapshot().qr_link, "https://max.ru/qr/abc")
        self.state.apply_event("password_required", "подсказка")
        self.assertEqual(self.state.snapshot().phase, PHASE_PASSWORD)
        self.state.apply_event("connected", True)
        self.assertEqual(self.state.snapshot().phase, PHASE_CONNECTED)
        self.assertEqual(self.state.snapshot().qr_link, "")

    def test_error_survives_later_shutdown_events(self) -> None:
        self.state.mark_connecting()
        self.state.apply_event("connection_error", "MAX недоступен")
        self.state.apply_event("connected", False)
        self.state.apply_event("runtime_stopped", None)
        snapshot = self.state.snapshot()
        self.assertEqual(snapshot.phase, PHASE_ERROR)
        self.assertEqual(snapshot.error, "MAX недоступен")

    def test_disconnect_after_connect_is_stopped_not_error(self) -> None:
        self.state.apply_event("connected", True)
        self.state.apply_event("connected", False)
        self.assertEqual(self.state.snapshot().phase, PHASE_STOPPED)

    def test_cancel_and_logout_return_to_idle(self) -> None:
        for event in ("connection_cancelled", "logged_out"):
            with self.subTest(event=event):
                self.state.mark_connecting()
                self.state.apply_event(event, None)
                self.assertEqual(self.state.snapshot().phase, PHASE_IDLE)

    def test_invalid_session_explains_next_step(self) -> None:
        self.state.apply_event("session_invalid", None)
        self.assertEqual(self.state.snapshot().phase, PHASE_ERROR)
        self.assertIn("QR", self.state.snapshot().error)

    def test_qr_svg_cache_is_dropped_with_its_link(self) -> None:
        self.state.apply_event("qr", "https://max.ru/qr/abc")
        self.state.store_qr_svg("https://max.ru/qr/abc", "<svg/>")
        self.assertEqual(self.state.cached_qr_svg("https://max.ru/qr/abc"), "<svg/>")
        self.state.apply_event("qr", "https://max.ru/qr/next")
        self.assertEqual(self.state.cached_qr_svg("https://max.ru/qr/abc"), "")

    def test_unknown_event_does_not_change_state(self) -> None:
        self.state.apply_event("connected", True)
        self.state.apply_event("что-то новое", {"payload": 1})
        self.assertEqual(self.state.snapshot().phase, PHASE_CONNECTED)


if __name__ == "__main__":
    unittest.main()
