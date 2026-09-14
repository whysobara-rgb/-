// CI-only entrypoint. The distributed app is built from lib/main.dart.
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:gacha_vault/core/network/api_client.dart';
import 'package:gacha_vault/core/network/token_storage.dart';
import 'package:gacha_vault/features/orders/order_models.dart';
import 'package:gacha_vault/features/orders/order_repository.dart';

const _orderId = 'd4b608db-b251-4616-8017-c1eea6a9c1a1';
const _capsuleId = 'a4b608db-b251-4616-8017-c1eea6a9c1a1';
const _userId = 2147483647;
const _server = 'https://storage-probe.invalid';
final _version = 'a' * 64;
final _prize = {
  'itemId': 1,
  'name': 'Storage probe',
  'rarity': 'N',
  'imageUrl': null,
  'estimatedValue': 1000,
  'isPremium': false,
  'conversionGP': 100,
  'probabilityPpm': 1000000,
};
http.Response _ok(dynamic data) => http.Response(
  jsonEncode({'statusCode': 10000, 'data': data}),
  200,
  headers: {'content-type': 'application/json; charset=utf-8'},
);
void _check(bool value, String message) {
  if (!value) throw StateError(message);
}

class _FixtureToken extends TokenStorage {
  @override
  Future<String?> readToken() async => 'isolated-probe-token';
}

Future<String> _probe() async {
  final store = SecureOrderStore();
  final reader = OrderRepository(
    api: const ApiClient(),
    store: store,
    userId: _userId,
    server: _server,
    enabled: true,
  );
  final pending = await reader.pendingPurchase();
  final opening = await reader.pendingOpening();
  final firstLaunch = pending == null && opening == null;
  final calls = <String>[];
  final client = MockClient((request) async {
    if (request.url.path == '/users/me') return _ok({'id': _userId});
    calls.add('${request.method} ${request.url.path}');
    if (firstLaunch) throw http.ClientException('simulated lost response');
    if (request.url.path == '/orders/gp') {
      _check(
        request.headers['idempotency-key'] == pending!.key,
        'request key changed after process restart',
      );
      _check(
        jsonEncode(jsonDecode(request.body)) == jsonEncode(pending.body),
        'purchase body changed',
      );
      return _ok({
        'orderId': _orderId,
        'title': 'Storage probe',
        'gachaId': 1,
        'quantity': 1,
        'unitPrice': 100,
        'total': 100,
        'currency': 'GP',
        'status': 'PAID',
        'probabilityVersion': _version,
        'capsules': [
          {
            'id': _capsuleId,
            'orderId': _orderId,
            'sequence': 1,
            'status': 'UNOPENED',
          },
        ],
      });
    }
    _check(
      request.method == 'GET' &&
          request.url.path == '/capsules/$_capsuleId/result',
      'unexpected opening mutation',
    );
    return _ok({
      'capsuleId': _capsuleId,
      'inventoryItemId': 7,
      'prize': _prize,
    });
  });
  final repo = OrderRepository(
    api: ApiClient(
      client: client,
      apiBaseUrl: _server,
      tokenStorage: _FixtureToken(),
    ),
    store: store,
    userId: _userId,
    server: _server,
    enabled: true,
  );
  try {
    if (firstLaunch) {
      final odds = Odds({
        'gachaId': 1,
        'unitPrice': 100,
        'currency': 'GP',
        'version': _version,
        'snapshot': {
          'schemaVersion': 1,
          'mode': 'FIXED_PPM',
          'entries': [_prize],
        },
      });
      try {
        await repo.purchase(odds, 1, 'Storage probe');
        throw StateError('expected lost purchase response');
      } on ApiException {
        /* Expected transport failure. */
      }
      try {
        await repo.open(_capsuleId);
        throw StateError('expected lost opening response');
      } on ApiException {
        /* Expected transport failure. */
      }
      _check(
        await repo.pendingPurchase() != null &&
            await repo.pendingOpening() == _capsuleId,
        'native secure storage did not persist pending operations',
      );
      _check(calls.length == 2, 'mutations were not attempted');
      return 'GACHA_STORAGE_PROBE_WRITTEN';
    }
    _check(
      pending != null && opening == _capsuleId,
      'incomplete persisted state',
    );
    _check(
      (await repo.retryPurchase()).id == _orderId,
      'receipt recovery failed',
    );
    _check(
      (await repo.result(opening!)).inventoryId == 7,
      'result recovery failed',
    );
    await repo.acknowledgeOpening(opening);
    _check(
      await repo.pendingPurchase() == null &&
          await repo.pendingOpening() == null,
      'acknowledged state not cleared',
    );
    _check(
      calls.join(',') == 'POST /orders/gp,GET /capsules/$_capsuleId/result',
      'unexpected replay requests',
    );
    return 'GACHA_STORAGE_PROBE_VERIFIED';
  } finally {
    client.close();
  }
}

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(
    const MaterialApp(
      home: Scaffold(body: Center(child: Text('Native storage verification'))),
    ),
  );
  try {
    final status = await _probe();
    debugPrint(status);
    runApp(
      MaterialApp(
        home: Scaffold(body: Center(child: Text(status))),
      ),
    );
  } catch (error) {
    debugPrint('GACHA_STORAGE_PROBE_FAILED: ${error.runtimeType}');
    if (error is PlatformException) {
      // The isolated fixture contains no customer credentials or transactions.
      debugPrint('GACHA_STORAGE_ERROR_CODE: ${error.code}');
      debugPrint('GACHA_STORAGE_ERROR_MESSAGE: ${error.message}');
    }
    runApp(
      const MaterialApp(
        home: Scaffold(
          body: Center(child: Text('Storage verification failed')),
        ),
      ),
    );
  }
}
