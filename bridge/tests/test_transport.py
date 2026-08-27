import hashlib
import unittest

from transport import EXTRA_ROOT_PATH, EXTRA_ROOT_SHA256, build_tls_context


class TrustAnchorTests(unittest.TestCase):
    """Якорь доверия проверяется здесь, а не на машине оператора.

    `build_tls_context` намеренно останавливает соединение, если отпечаток файла
    разошёлся с закреплённым. Расхождение возможно от одного неаккуратного
    пересохранения сертификата, и без этого теста оно всплыло бы только в момент,
    когда оператор пытается отправить КП.
    """

    def test_certificate_matches_pinned_fingerprint(self) -> None:
        self.assertTrue(EXTRA_ROOT_PATH.is_file(), "Файл корневого сертификата пропал из репозитория")
        digest = hashlib.sha256(EXTRA_ROOT_PATH.read_bytes()).hexdigest()
        self.assertEqual(digest, EXTRA_ROOT_SHA256)

    def test_context_loads_with_full_verification(self) -> None:
        import ssl

        context = build_tls_context()
        self.assertTrue(context.check_hostname)
        self.assertIs(context.verify_mode, ssl.CERT_REQUIRED)
        self.assertGreaterEqual(context.minimum_version, ssl.TLSVersion.TLSv1_2)


if __name__ == "__main__":
    unittest.main()
