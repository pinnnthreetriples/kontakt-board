from __future__ import annotations

"""Нормализация телефонов на стороне моста.

Браузер присылает номер таким, каким его сохранил оператор. MAX принимает только
E.164, поэтому мост приводит номер сам и отказывается угадывать: неизвестный
формат лучше вернуть ошибкой, чем отправить КП чужому человеку.
"""

import hashlib
import re

_PHONE_CHARS = re.compile(r"\+?[0-9\s().-]+")


def normalize_phone(value: str) -> str | None:
    """Вернуть номер в формате +7XXXXXXXXXX либо None, если формат непонятен."""
    raw = value.strip()
    if not raw or not _PHONE_CHARS.fullmatch(raw):
        return None

    digits = re.sub(r"\D", "", raw)

    if len(digits) == 10 and digits.startswith("9"):
        return "+7" + digits
    if len(digits) == 11 and digits.startswith("8"):
        return "+7" + digits[1:]
    if len(digits) == 11 and digits.startswith("7"):
        return "+" + digits

    # Код страны не додумываем: только явный международный формат.
    if raw.startswith("+") and 8 <= len(digits) <= 15 and not digits.startswith("0"):
        return "+" + digits

    return None


def mask_phone(phone: str) -> str:
    """Номер для логов: в консоль моста не должен попадать полный телефон."""
    if len(phone) < 7:
        return "***"
    return f"{phone[:3]}******{phone[-2:]}"


def message_fingerprint(text: str) -> str:
    """Отпечаток текста КП: по нему журнал ловит повторную отправку того же письма."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()
