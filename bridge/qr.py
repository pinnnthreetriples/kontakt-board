from __future__ import annotations

"""Отрисовка QR-кода для входа в MAX."""

import io
import logging

LOG = logging.getLogger("kontakt_bridge")


def render_qr_svg(link: str) -> str:
    """Отрисовать QR локально. Пустая строка означает «не удалось».

    Используется чисто питоновская SVG-фабрика `qrcode` (внутри только
    xml.etree), поэтому Pillow и другие двоичные зависимости не нужны.
    """
    if not link:
        return ""
    try:
        import qrcode
        import qrcode.image.svg

        image = qrcode.make(link, image_factory=qrcode.image.svg.SvgPathImage)
        buffer = io.BytesIO()
        image.save(buffer)
        return buffer.getvalue().decode("utf-8")
    except Exception as exc:  # noqa: BLE001 - ссылка на вход всё равно уйдёт клиенту
        LOG.warning("Не удалось построить SVG для QR: %s", type(exc).__name__)
        return ""
