import unittest

from phones import mask_phone, message_fingerprint, normalize_phone


class NormalizePhoneTests(unittest.TestCase):
    def test_russian_formats_become_e164(self) -> None:
        for raw in ("9093228700", "89093228700", "+7 (909) 322-87-00", "7 909 322 87 00"):
            with self.subTest(raw=raw):
                self.assertEqual(normalize_phone(raw), "+79093228700")

    def test_explicit_international_number_is_kept(self) -> None:
        self.assertEqual(normalize_phone("+380 44 123 45 67"), "+380441234567")

    def test_unknown_formats_are_rejected(self) -> None:
        # Угадывание кода страны превратило бы опечатку в чужой номер.
        for raw in ("", "   ", "123", "8 (909) 322-87-0", "почта@example.com", "9093228700 доб. 5"):
            with self.subTest(raw=raw):
                self.assertIsNone(normalize_phone(raw))


class MaskPhoneTests(unittest.TestCase):
    def test_middle_digits_are_hidden(self) -> None:
        self.assertEqual(mask_phone("+79093228700"), "+79******00")

    def test_short_value_is_fully_hidden(self) -> None:
        self.assertEqual(mask_phone("+7909"), "***")


class FingerprintTests(unittest.TestCase):
    def test_same_text_gives_same_fingerprint(self) -> None:
        self.assertEqual(message_fingerprint("КП на монтаж"), message_fingerprint("КП на монтаж"))

    def test_different_text_gives_different_fingerprint(self) -> None:
        self.assertNotEqual(message_fingerprint("КП на монтаж"), message_fingerprint("КП на ремонт"))


if __name__ == "__main__":
    unittest.main()
