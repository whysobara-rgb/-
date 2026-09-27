import unittest

import check_configuration as config


GOOD_WORKFLOW = '''
      - name: Build staging debug APK with explicit origin and GP order preview only
        run: flutter build apk --debug --dart-define="API_BASE_URL=$API_BASE_URL" --dart-define=ENABLE_GP_ORDER_PREVIEW=true
'''

GOOD_IOS = """
subprocess.run(['flutter', 'build', 'ios', '--profile', '--flavor', 'staging',
                '--dart-define=API_BASE_URL=' + os.environ['API_BASE_URL'],
                '--dart-define=ENABLE_GP_ORDER_PREVIEW=true'], check=True)
"""


class PhysicalTransactionPreviewScopeTest(unittest.TestCase):
    def test_gp_order_preview_only_is_accepted(self):
        config.check_physical_transaction_preview_scope(GOOD_WORKFLOW, GOOD_IOS)

    def test_android_requires_gp_order_preview(self):
        with self.assertRaises(ValueError):
            config.check_physical_transaction_preview_scope(
                GOOD_WORKFLOW.replace(' --dart-define=ENABLE_GP_ORDER_PREVIEW=true', ''),
                GOOD_IOS,
            )

    def test_android_rejects_other_transaction_previews(self):
        for flag in ('ENABLE_GP_CONVERSION_PREVIEW', 'ENABLE_SHIPPING_PREVIEW',
                     'ENABLE_ORDER_REFUND_PREVIEW', 'ENABLE_LEGACY_TRANSACTIONS'):
            with self.subTest(flag=flag), self.assertRaises(ValueError):
                config.check_physical_transaction_preview_scope(
                    GOOD_WORKFLOW.replace(
                        ' --dart-define=ENABLE_GP_ORDER_PREVIEW=true',
                        f' --dart-define=ENABLE_GP_ORDER_PREVIEW=true --dart-define={flag}=true',
                    ),
                    GOOD_IOS,
                )

    def test_ios_requires_gp_order_preview(self):
        with self.assertRaises(ValueError):
            config.check_physical_transaction_preview_scope(
                GOOD_WORKFLOW,
                GOOD_IOS.replace("'--dart-define=ENABLE_GP_ORDER_PREVIEW=true'", "''"),
            )

    def test_ios_rejects_other_transaction_previews(self):
        for flag in ('ENABLE_GP_CONVERSION_PREVIEW', 'ENABLE_SHIPPING_PREVIEW',
                     'ENABLE_ORDER_REFUND_PREVIEW', 'ENABLE_LEGACY_TRANSACTIONS'):
            with self.subTest(flag=flag), self.assertRaises(ValueError):
                config.check_physical_transaction_preview_scope(
                    GOOD_WORKFLOW,
                    GOOD_IOS + f"\n'--dart-define={flag}=true'\n",
                )


if __name__ == '__main__':
    unittest.main()
