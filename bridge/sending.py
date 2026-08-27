from __future__ import annotations

"""Поиск получателя в MAX и отправка одного КП.

Главное правило: автоматического повтора здесь нет. Обрыв связи после запроса
неотличим от отказа, а MAX не даёт спросить, дошло ли сообщение. Поэтому
неопределённый исход честно возвращается как UNKNOWN, а журнал блокирует
повторную попытку с тем же текстом, пока оператор не разберётся вручную.
"""

import asyncio
import logging
from dataclasses import dataclass
from enum import Enum
from typing import Any

from history import STATE_SENT, SendLedger
from phones import message_fingerprint

LOG = logging.getLogger("kontakt_bridge")

SEARCH_TIMEOUT = 15.0
SEND_TIMEOUT = 20.0
SEARCH_RETRIES = 2
RETRY_DELAY = 1.0


class ResultStatus(str, Enum):
    SENT = "Отправлено"
    FOUND = "Найден"
    NOT_FOUND = "Не найден по номеру"
    SKIPPED_DUPLICATE = "Уже отправляли"
    UNKNOWN = "Статус отправки неизвестен"
    ERROR = "Ошибка"
    RATE_LIMITED = "Ограничение MAX"


@dataclass(frozen=True, slots=True)
class SendResult:
    status: ResultStatus
    recipient: str = ""
    detail: str = ""


def _value(source: Any, attr: str) -> Any:
    if isinstance(source, dict):
        return source.get(attr)
    return getattr(source, attr, None)


def recipient_name(contact: Any) -> str:
    """Имя получателя из ответа MAX. Пустая строка, если имени нет."""
    names = _value(contact, "names")
    records: tuple[Any, ...]
    if names is None:
        records = ()
    elif isinstance(names, (list, tuple)):
        records = tuple(item for item in names if item is not None)
    else:
        records = (names,)

    for source in (*records, contact):
        for attr in ("name", "full_name", "fullName", "first_name", "firstName"):
            value = _value(source, attr)
            if value:
                return str(value)[:120]
    return ""


def _is_not_found_error(exc: BaseException) -> bool:
    """PyMax 2.4.0 отвечает ошибкой, а не пустым результатом, когда номера нет."""
    return exc.__class__.__name__ == "PyMaxError" and "missing `contact` in response" in str(exc).lower()


def _is_retryable(exc: BaseException) -> bool:
    return isinstance(exc, (ConnectionError, OSError, TimeoutError, asyncio.TimeoutError))


def _is_rate_limit(exc: BaseException) -> bool:
    parts = [str(exc)]
    for attr in ("error", "message", "localized_message", "title"):
        value = getattr(exc, attr, None)
        if value:
            parts.append(str(value))
    text = " ".join(parts).lower()
    return any(signal in text for signal in ("rate limit", "too many", "flood", "429", "лимит"))


def _is_rejection(exc: BaseException) -> bool:
    """ApiError означает явный отказ MAX: сообщение точно не принято."""
    return exc.__class__.__name__ == "ApiError" and hasattr(exc, "opcode")


def _brief(exc: BaseException, limit: int = 140) -> str:
    return f"{type(exc).__name__}: {str(exc)[:limit]}"


async def _search(client: Any, phone: str) -> Any | None:
    last_error: BaseException | None = None
    for attempt in range(SEARCH_RETRIES):
        try:
            result = await asyncio.wait_for(client.search_by_phone(phone), timeout=SEARCH_TIMEOUT)
        except Exception as exc:  # noqa: BLE001 - разбираем ошибку ниже
            if _is_not_found_error(exc):
                return None
            last_error = exc
            if not _is_retryable(exc):
                break
            if attempt + 1 < SEARCH_RETRIES:
                await asyncio.sleep(RETRY_DELAY * (attempt + 1))
            continue
        # MAX отдаёт то сам контакт, то обёртку с полем contact.
        nested = _value(result, "contact")
        return nested if nested is not None else result
    raise last_error if last_error else RuntimeError("Неизвестная ошибка поиска в MAX")


async def find_recipient(client: Any, phone: str) -> SendResult:
    """Проверка номера без отправки: есть ли такой пользователь в MAX."""
    try:
        contact = await _search(client, phone)
    except Exception as exc:  # noqa: BLE001 - ответ оператору важнее трассировки
        status = ResultStatus.RATE_LIMITED if _is_rate_limit(exc) else ResultStatus.ERROR
        return SendResult(status, detail=f"Ошибка поиска: {_brief(exc)}")
    if contact is None:
        return SendResult(ResultStatus.NOT_FOUND, detail="MAX не вернул пользователя по этому номеру")
    return SendResult(ResultStatus.FOUND, recipient=recipient_name(contact))


def _chat_target(client: Any, contact: Any) -> tuple[int, int]:
    """ID собеседника и чата с ним. Бросает RuntimeError с текстом для оператора."""
    raw_id = _value(contact, "id")
    try:
        target_id = int(raw_id)
    except (TypeError, ValueError):
        raise RuntimeError("MAX вернул неполные данные пользователя") from None
    if target_id <= 0:
        raise RuntimeError("MAX вернул некорректные данные пользователя")

    me = getattr(client, "me", None)
    my_id = _value(_value(me, "contact") or me, "id")
    if my_id is None:
        raise RuntimeError("MAX не вернул ID подключённого аккаунта")
    if int(my_id) == target_id:
        raise RuntimeError("Номер принадлежит подключённому аккаунту MAX, отправка себе заблокирована")

    return target_id, int(client.get_chat_id(first_user_id=int(my_id), second_user_id=target_id))


async def send_proposal(client: Any, ledger: SendLedger, phone: str, text: str) -> SendResult:
    """Отправить текст одному получателю, не допуская повтора того же КП."""
    fingerprint = message_fingerprint(text)

    previous = ledger.blocks_resend(phone, fingerprint)
    if previous is not None:
        detail = (
            "Такой же текст уже успешно отправлялся этому номеру"
            if previous == STATE_SENT
            else "У предыдущей попытки неизвестный статус, автоповтор заблокирован"
        )
        return SendResult(ResultStatus.SKIPPED_DUPLICATE, detail=detail)

    try:
        contact = await _search(client, phone)
    except Exception as exc:  # noqa: BLE001 - ответ оператору важнее трассировки
        status = ResultStatus.RATE_LIMITED if _is_rate_limit(exc) else ResultStatus.ERROR
        return SendResult(status, detail=f"Ошибка поиска: {_brief(exc)}")
    if contact is None:
        return SendResult(ResultStatus.NOT_FOUND, detail="MAX не вернул пользователя по этому номеру")

    recipient = recipient_name(contact)
    try:
        target_id, chat_id = _chat_target(client, contact)
    except RuntimeError as exc:
        return SendResult(ResultStatus.ERROR, recipient=recipient, detail=str(exc))
    except Exception as exc:  # noqa: BLE001 - PyMax может ответить чем угодно
        return SendResult(ResultStatus.ERROR, recipient=recipient, detail=f"Не удалось определить чат: {_brief(exc)}")

    user_id = str(target_id)
    if ledger.blocks_recipient_resend(user_id, fingerprint):
        return SendResult(
            ResultStatus.SKIPPED_DUPLICATE,
            recipient=recipient,
            detail="Такое же КП уже отправлялось этому пользователю MAX, возможно с другого номера",
        )

    # Точка невозврата: запись о попытке делается до сетевого запроса. Если мост
    # умрёт после отправки, но до ответа, следующая попытка увидит бронь.
    if not ledger.reserve_attempt(phone, fingerprint, user_id):
        return SendResult(
            ResultStatus.SKIPPED_DUPLICATE,
            recipient=recipient,
            detail="Попытка с этим текстом уже зарегистрирована",
        )

    try:
        await asyncio.wait_for(client.send_text_exact(chat_id=chat_id, text=text), timeout=SEND_TIMEOUT)
    except Exception as exc:  # noqa: BLE001 - различаем отказ и неизвестность
        if _is_rejection(exc):
            ledger.release_rejected_attempt(phone, fingerprint)
            status = ResultStatus.RATE_LIMITED if _is_rate_limit(exc) else ResultStatus.ERROR
            return SendResult(status, recipient=recipient, detail=f"MAX отклонил отправку: {_brief(exc)}")
        ledger.mark_unknown(phone, fingerprint)
        return SendResult(
            ResultStatus.UNKNOWN,
            recipient=recipient,
            detail=f"Статус неизвестен, автоповтор заблокирован: {_brief(exc)}",
        )

    try:
        ledger.mark_sent(phone, fingerprint)
    except Exception as exc:  # noqa: BLE001 - сообщение уже ушло, это не ошибка отправки
        # Бронь остаётся незакрытой, и это безопасно: повтор того же текста
        # заблокирован, а оператор увидит «отправлено», как оно и есть.
        LOG.warning("Журнал не обновлён после отправки: %s", type(exc).__name__)
    return SendResult(ResultStatus.SENT, recipient=recipient)
