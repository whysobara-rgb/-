import 'package:flutter/foundation.dart';

/// Public build configuration only. Never put PG or OAuth secrets here.
abstract final class AppConfig {
  static const apiBaseUrl = String.fromEnvironment('API_BASE_URL');

  // The legacy API buys and opens in one step and uses an unconfirmed flat
  // delivery fee. It must never be enabled in a production build.
  static const legacyTransactionsEnabled =
      !kReleaseMode && bool.fromEnvironment('ENABLE_LEGACY_TRANSACTIONS');
}
