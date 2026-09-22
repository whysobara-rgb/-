import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gacha_vault/core/config/app_config.dart';

void main() {
  test('release constants keep every preview transaction gate closed', () {
    const legacy = bool.fromEnvironment('ENABLE_LEGACY_TRANSACTIONS');
    const allowed = !kReleaseMode && !legacy;
    expect(
      AppConfig.orderPreviewEnabled,
      allowed && const bool.fromEnvironment('ENABLE_GP_ORDER_PREVIEW'),
    );
    expect(
      AppConfig.conversionPreviewEnabled,
      allowed && const bool.fromEnvironment('ENABLE_GP_CONVERSION_PREVIEW'),
    );
    expect(
      AppConfig.shippingPreviewEnabled,
      allowed && const bool.fromEnvironment('ENABLE_SHIPPING_PREVIEW'),
    );
    expect(
      AppConfig.refundPreviewEnabled,
      allowed && const bool.fromEnvironment('ENABLE_ORDER_REFUND_PREVIEW'),
    );
    expect(AppConfig.legacyTransactionsEnabled, !kReleaseMode && legacy);
    if (kReleaseMode) {
      expect([
        AppConfig.orderPreviewEnabled,
        AppConfig.conversionPreviewEnabled,
        AppConfig.shippingPreviewEnabled,
        AppConfig.refundPreviewEnabled,
        AppConfig.legacyTransactionsEnabled,
      ], everyElement(isFalse));
    }
  });
}
