import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:gacha_vault/core/network/api_client.dart';
import 'package:gacha_vault/features/orders/order_repository.dart';
import 'package:gacha_vault/features/shipping/fulfillment_repository.dart';
import 'customer_updates_test.dart' as f;

final recipient = {
  'name': '검증 고객',
  'phone': '01000000000',
  'postalCode': '00000',
  'address1': '검증 주소',
  'address2': '101',
  'notes': '',
  'country': 'KR',
};
Map<String, dynamic> quote() => {
  'quoteId': f.id,
  'feeGP': 730,
  'balance': 1000,
  'expiresAt': DateTime.now()
      .add(const Duration(minutes: 10))
      .toUtc()
      .toIso8601String(),
  'recipient': recipient,
  'items': [
    {
      'inventoryItemId': 7,
      'prize': {'name': '확정 상품'},
    },
  ],
};
Map<String, dynamic> receipt({int fee = 730, String status = 'REQUESTED'}) => {
  'fulfillmentId': f.other,
  'feeGP': fee,
  'recipient': recipient,
  'items': [
    {
      'inventoryItemId': 7,
      'prize': {'name': '확정 상품'},
    },
  ],
  'status': status,
  'createdAt': '2026-09-15T00:00:00Z',
};
void main() {
  FulfillmentRepository repo(
    f.Api api,
    f.Memory store, {
    bool enabled = true,
  }) => FulfillmentRepository(
    OrderRepository(
      api: api,
      store: store,
      userId: 1,
      server: 'https://example.invalid',
    ),
    enabled: enabled,
  );
  test(
    'server quoted shipping fee is used and no legacy endpoint is called',
    () async {
      final api = f.Api(), store = f.Memory();
      api.read = (p) async => p == '/users/me'
          ? {'id': 1}
          : {'contract': 'FULFILLMENT_V1', 'enabled': true};
      api.write = (p, body) async =>
          p == '/fulfillments/quotes' ? quote() : receipt();
      final r = repo(api, store), q = await r.quote([7], recipient);
      expect(q.fee, 730);
      final result = await r.submit(q);
      expect(result.feeGP, 730);
      expect(api.payloads.last, {'quoteId': f.id});
      expect(api.paths.any((p) => p.contains('shipping-requests')), isFalse);
      expect(store.values, isEmpty);
    },
  );
  test(
    'lost create response is recovered after restart without a second charge request',
    () async {
      final api = f.Api(), store = f.Memory();
      api.read = (p) async => p == '/users/me' ? {'id': 1} : receipt();
      api.write = (_, body) async =>
          throw ApiException(statusCode: 0, message: 'lost receipt');
      await expectLater(
        repo(api, store).submit(ShippingQuote(quote())),
        throwsA(isA<ApiException>()),
      );
      expect(store.values.length, 1);
      expect((await repo(api, store).recover())!.id, f.other);
      expect(api.keys.length, 1);
      expect(store.values, isEmpty);
    },
  );
  test(
    'missing create retries original quote and key; mismatched fee never clears pending',
    () async {
      final api = f.Api(), store = f.Memory();
      bool first = true;
      api.read = (p) async {
        if (p == '/users/me') {
          return {'id': 1};
        }
        throw ApiException(
          statusCode: 10004,
          httpStatusCode: 404,
          message: 'missing',
        );
      };
      api.write = (_, body) async {
        if (first) {
          first = false;
          throw ApiException(statusCode: 0, message: 'no response');
        }
        return receipt(fee: 999);
      };
      final r = repo(api, store);
      await expectLater(
        r.submit(ShippingQuote(quote())),
        throwsA(isA<ApiException>()),
      );
      final key = jsonDecode(store.values.values.single)['key'];
      await expectLater(r.recover(), throwsA(isA<ApiException>()));
      expect(api.keys, [key, key]);
      expect(store.values.length, 1);
    },
  );
  test(
    'disabled shipping and failed persistence cannot create requests',
    () async {
      final api = f.Api()..read = (_) async => {'id': 1},
          store = f.Memory()..fail = true;
      await expectLater(
        repo(api, store, enabled: false).submit(ShippingQuote(quote())),
        throwsA(isA<ApiException>()),
      );
      expect(api.paths, isEmpty);
      await expectLater(
        repo(api, store).submit(ShippingQuote(quote())),
        throwsException,
      );
      expect(api.keys, isEmpty);
    },
  );
  test(
    'unknown cancellation result survives restart and resolves from current receipt',
    () async {
      final api = f.Api(), store = f.Memory();
      api.read = (p) async =>
          p == '/users/me' ? {'id': 1} : receipt(status: 'CANCELLED');
      api.write = (_, body) async =>
          throw ApiException(statusCode: 0, message: 'lost cancel result');
      await expectLater(
        repo(api, store).cancel(f.other),
        throwsA(isA<ApiException>()),
      );
      expect(store.values.length, 1);
      expect((await repo(api, store).recover())!.status.name, 'cancelled');
      expect(api.keys.length, 1);
      expect(store.values, isEmpty);
    },
  );
}
