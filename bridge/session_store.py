from __future__ import annotations

"""Файлы MAX-сессии на диске и способ, которым её получили.

Сессию хранит сам PyMax, в SQLite рядом с настройками приложения. Мост добавляет
к ней один факт, которого библиотека не помнит: каким входом сессия открыта.
QR-сессия принадлежит web-клиенту, SMS-сессия мобильному, и подключаться после
перезапуска надо тем же клиентом, иначе MAX не примет токен.
"""

import json
import logging
import sqlite3
from contextlib import closing
from pathlib import Path

LOG = logging.getLogger("kontakt_bridge")

SESSION_FILE = "session.db"
SESSION_MODE_FILE = "session_mode.json"

MODE_QR = "qr"
MODE_SMS = "sms"


class SessionFiles:
    def __init__(self, directory: Path) -> None:
        self.directory = directory

    @property
    def db(self) -> Path:
        return self.directory / SESSION_FILE

    @property
    def mode_path(self) -> Path:
        return self.directory / SESSION_MODE_FILE

    def has_token(self) -> bool:
        """Есть ли сохранённый токен MAX.

        Проверяется именно запись в файле: PyMax заводит пустое хранилище уже при
        первой попытке входа, поэтому по наличию файла мост считал бы вход
        выполненным и на каждом запуске молча просил новый код.
        """
        if not self.db.is_file():
            return False
        try:
            with closing(sqlite3.connect(self.db)) as connection:
                return connection.execute("SELECT 1 FROM sessions LIMIT 1").fetchone() is not None
        except sqlite3.Error as exc:
            LOG.warning("Не удалось прочитать сессию MAX: %s", type(exc).__name__)
            return False

    def saved_login(self) -> tuple[str, str]:
        """Способ входа и телефон прошлой сессии. QR — если файла нет."""
        try:
            saved = json.loads(self.mode_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return MODE_QR, ""
        if saved.get("mode") != MODE_SMS:
            return MODE_QR, ""
        return MODE_SMS, str(saved.get("phone", ""))

    def remember(self, mode: str, phone: str) -> None:
        try:
            self.mode_path.write_text(
                json.dumps({"mode": mode, "phone": phone}, ensure_ascii=False), encoding="utf-8"
            )
        except OSError as exc:
            # Не критично: без файла следующий запуск просто предложит QR-код.
            LOG.warning("Не удалось запомнить способ входа: %s", type(exc).__name__)

    def wipe(self) -> None:
        journals = [self.db.with_name(self.db.name + suffix) for suffix in ("", "-wal", "-shm")]
        for candidate in (*journals, self.mode_path):
            try:
                candidate.unlink(missing_ok=True)
            except OSError as exc:
                LOG.error("Не удалось удалить файл сессии MAX: %s", type(exc).__name__)
