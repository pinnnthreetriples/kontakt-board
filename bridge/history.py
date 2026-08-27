from __future__ import annotations

"""Журнал отправок: единственная защита от повторного КП одному человеку.

Запись о попытке делается ДО обращения к MAX. Если мост упадёт между запросом и
ответом, следующая попытка увидит незакрытую строку и не отправит дубль: MAX не
даёт способа спросить «дошло ли моё предыдущее сообщение».

Файл лежит рядом с сессией, в папке данных приложения. Номера хранятся как есть:
то же самое приложение держит их в браузерной базе, шифровать здесь нечего.
"""

import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from types import TracebackType

STATE_PENDING = "pending"
STATE_SENT = "sent"
STATE_UNKNOWN = "unknown"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS send_ledger (
    phone TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    user_id TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (phone, fingerprint)
)
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class SendLedger:
    """Соединение sqlite3 привязано к создавшему потоку, поэтому журнал живёт
    только внутри одной операции отправки и закрывается вместе с ней."""

    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(path, isolation_level=None)
        self._conn.execute("PRAGMA busy_timeout = 5000")
        self._conn.execute("PRAGMA journal_mode = WAL")
        # Дубль КП дороже пары миллисекунд: запись о попытке должна пережить
        # выключение питания, иначе гарантия «не отправим дважды» пустая.
        self._conn.execute("PRAGMA synchronous = FULL")
        self._conn.execute(_SCHEMA)

    def blocks_resend(self, phone: str, fingerprint: str) -> str | None:
        """Состояние предыдущей попытки с тем же текстом или None."""
        row = self._conn.execute(
            "SELECT state FROM send_ledger WHERE phone = ? AND fingerprint = ?",
            (phone, fingerprint),
        ).fetchone()
        return str(row[0]) if row else None

    def blocks_recipient_resend(self, user_id: str, fingerprint: str) -> bool:
        """Тот же текст этому же пользователю MAX, но заявленный другим номером."""
        if not user_id:
            return False
        row = self._conn.execute(
            "SELECT 1 FROM send_ledger WHERE user_id = ? AND fingerprint = ? AND state != ?",
            (user_id, fingerprint, STATE_PENDING),
        ).fetchone()
        return row is not None

    def reserve_attempt(self, phone: str, fingerprint: str, user_id: str) -> bool:
        """Забронировать попытку до сетевого запроса. False — бронь уже занята."""
        cursor = self._conn.execute(
            "INSERT OR IGNORE INTO send_ledger (phone, fingerprint, user_id, state, updated_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (phone, fingerprint, user_id, STATE_PENDING, _now()),
        )
        return cursor.rowcount == 1

    def mark_sent(self, phone: str, fingerprint: str) -> None:
        self._set_state(phone, fingerprint, STATE_SENT)

    def mark_unknown(self, phone: str, fingerprint: str) -> None:
        self._set_state(phone, fingerprint, STATE_UNKNOWN)

    def release_rejected_attempt(self, phone: str, fingerprint: str) -> None:
        """Снять бронь: MAX явно отказал, сообщение точно не ушло."""
        self._conn.execute(
            "DELETE FROM send_ledger WHERE phone = ? AND fingerprint = ? AND state = ?",
            (phone, fingerprint, STATE_PENDING),
        )

    def _set_state(self, phone: str, fingerprint: str, state: str) -> None:
        self._conn.execute(
            "UPDATE send_ledger SET state = ?, updated_at = ? WHERE phone = ? AND fingerprint = ?",
            (state, _now(), phone, fingerprint),
        )

    def close(self) -> None:
        self._conn.close()

    def __enter__(self) -> "SendLedger":
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        self.close()
