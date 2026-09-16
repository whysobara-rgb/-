import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gacha_vault/core/network/api_client.dart';
import 'package:gacha_vault/features/customer_updates/customer_content.dart';
import 'package:gacha_vault/features/customer_updates/customer_updates_page.dart';
import 'package:gacha_vault/features/customer_updates/support_repository.dart';
import 'package:gacha_vault/features/home/data/capsule_box_repository.dart';
import 'package:gacha_vault/features/home/presentation/home_page.dart';
import 'package:gacha_vault/features/orders/order_repository.dart';
import 'package:gacha_vault/features/shipping/domain/shipping_request.dart';

const id = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
Map<String, dynamic> campaign({int sort = 1}) => {
  'id': id,
  'title': '관리자 공개 배너',
  'body': '공개한 안내 내용',
  'kind': 'NOTICE',
  'gachaId': null,
  'imageUrl': null,
  'homeVisible': true,
  'sortOrder': sort,
  'startsAt': '2026-09-14T00:00:00Z',
  'endsAt': '2026-10-01T00:00:00Z',
};

class Memory extends OrderStore {
  final values = <String, String>{};
  bool fail = false;
  @override
  Future<String?> read(String key) async => values[key];
  @override
  Future<void> write(String key, String value) async {
    if (fail) {
      throw Exception('storage full');
    }
    values[key] = value;
  }

  @override
  Future<void> remove(String key) async {
    values.remove(key);
  }
}

class Api extends ApiClient {
  final paths = <String>[];
  final keys = <String?>[];
  final payloads = <Map<String, dynamic>?>[];
  Future<dynamic> Function(String)? read;
  Future<dynamic> Function(String, Map<String, dynamic>?)? write;
  @override
  Future<dynamic> get(String path, {bool withAuth = true}) async {
    paths.add(path);
    return read!(path);
  }

  @override
  Future<dynamic> post(
    String path, {
    Map<String, dynamic>? body,
    bool withAuth = true,
    String? idempotencyKey,
  }) async {
    paths.add(path);
    keys.add(idempotencyKey);
    payloads.add(body);
    return write!(path, body);
  }
}

void main() {
  test('published campaign metadata and unsafe images are validated', () async {
    final api = Api()
      ..read = (_) => Future.value({
        'contract': 'CAMPAIGNS_V1',
        'items': [campaign()],
      });
    final rows = await CustomerContentRepository(api: api).campaigns();
    expect(rows.single.homeVisible, isTrue);
    expect(api.paths.single, '/campaigns');
    for (final image in [
      'javascript:alert(1)',
      'http://example.invalid/a',
      'https://user:secret@example.invalid/a',
    ]) {
      expect(
        () => Campaign({...campaign(), 'imageUrl': image}),
        throwsA(isA<ApiException>()),
      );
    }
  });
  test('catalog fetches every page and reflects owner categories', () async {
    final api = Api()
      ..read = (p) async {
        final n = p.contains('page=2') ? 2 : 1;
        return {
          'page': n,
          'limit': 100,
          'totalCount': 101,
          'items': List.generate(
            n == 1 ? 100 : 1,
            (i) => {
              'id': n == 1 ? i + 1 : 101,
              'title': '박스',
              'category': n == 1 ? 'tech' : 'food',
              'price': 100,
            },
          ),
        };
      };
    final boxes = await CapsuleBoxRepository(apiClient: api).getAll();
    expect(boxes.length, 101);
    expect(boxes.last.category, 'food');
    expect(api.paths.length, 2);
  });
  test('current fulfillment states, ids and tracking survive parsing', () {
    for (final state in [
      'REQUESTED',
      'PREPARING',
      'COLLECTED',
      'SHIPPING',
      'DELIVERED',
      'CANCELLED',
    ]) {
      final r = ShippingRequest.fromJson({
        'fulfillmentId': id,
        'status': state,
        'feeGP': 100,
        'carrier': 'CJ',
        'trackingNumber': 'TEST12345',
        'recipient': {
          'name': '테스트',
          'phone': '01000000000',
          'postalCode': '00000',
          'address1': '테스트 주소',
          'address2': '',
          'notes': '',
        },
        'createdAt': '2026-09-15T00:00:00Z',
        'items': [
          {
            'inventoryItemId': 7,
            'prize': {'name': '확정 상품'},
          },
        ],
      });
      expect(r.id, id);
      expect(r.trackingNumber, 'TEST12345');
      expect(r.status.name.toUpperCase(), state);
    }
  });
  test(
    'lost support response recovers original request across repository recreation',
    () async {
      final store = Memory(), api = Api();
      final body = {
        'subject': '상품 문의',
        'body': '확인을 부탁드립니다',
        'category': 'OTHER',
      };
      bool committed = false;
      api.read = (path) async {
        if (path == '/users/me') {
          return {'id': 1};
        }
        if (committed) {
          return {'ticketId': id, 'subject': body['subject'], 'orderId': null};
        }
        throw ApiException(
          statusCode: 10004,
          httpStatusCode: 404,
          message: 'not found',
        );
      };
      api.write = (path, payload) async {
        committed = true;
        throw ApiException(statusCode: 0, message: 'lost response');
      };
      SupportRepository repo() => SupportRepository(
        OrderRepository(
          api: api,
          store: store,
          userId: 1,
          server: 'https://example.invalid',
        ),
      );
      await expectLater(repo().send(body: body), throwsA(isA<ApiException>()));
      expect(store.values.length, 1);
      final key = jsonDecode(store.values.values.single)['key'];
      expect(await repo().recover(), id);
      expect(api.keys, [key]);
      expect(store.values, isEmpty);
    },
  );
  test(
    'missing original request retries identical content and account mismatch blocks replay',
    () async {
      final store = Memory(), api = Api();
      bool lost = true;
      int user = 1;
      api.read = (path) async {
        if (path == '/users/me') {
          return {'id': user};
        }
        throw ApiException(
          statusCode: 10004,
          httpStatusCode: 404,
          message: 'not found',
        );
      };
      api.write = (path, p) async {
        if (lost) {
          lost = false;
          throw ApiException(statusCode: 0, message: 'no response');
        }
        return {'ticketId': id, 'messageId': other};
      };
      final session = OrderRepository(
            api: api,
            store: store,
            userId: 1,
            server: 'https://example.invalid',
          ),
          r = SupportRepository(session);
      await expectLater(
        r.send(ticketId: id, body: {'body': '추가 내용'}),
        throwsA(isA<ApiException>()),
      );
      user = 2;
      await expectLater(r.recover(), throwsA(isA<ApiException>()));
      expect(api.keys.length, 1);
      expect(store.values.length, 1);
      user = 1;
      expect(await r.recover(), id);
      expect(api.keys[0], api.keys[1]);
      expect(api.payloads[0], api.payloads[1]);
      expect(store.values, isEmpty);
    },
  );
  test(
    'storage failure prevents sending and wrong receipt retains recovery data',
    () async {
      final store = Memory()..fail = true,
          api = Api()..read = (_) async => {'id': 1};
      api.write = (_, p) async => {'ticketId': other, 'messageId': id};
      final r = SupportRepository(
        OrderRepository(
          api: api,
          store: store,
          userId: 1,
          server: 'https://example.invalid',
        ),
      );
      await expectLater(
        r.send(ticketId: id, body: {'body': '추가 내용'}),
        throwsException,
      );
      expect(api.keys, isEmpty);
      store.fail = false;
      await expectLater(
        r.send(ticketId: id, body: {'body': '추가 내용'}),
        throwsA(isA<ApiException>()),
      );
      expect(store.values.length, 1);
    },
  );
  testWidgets(
    'owner content and customer case view render without internal fields',
    (tester) async {
      final api = Api()
        ..read = (path) async => {
          'page': 1,
          'limit': 20,
          'totalCount': 1,
          'items': [
            {
              'id': id,
              'orderId': other,
              'kind': 'DAMAGE',
              'status': 'IN_PROGRESS',
              'summary': '확인하고 있습니다',
              'updatedAt': '2026-09-15T00:00:00Z',
            },
          ],
        };
      await tester.pumpWidget(
        MaterialApp(
          home: CustomerUpdatesPage(
            initial: 'cases',
            repository: CustomerContentRepository(api: api),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('확인하고 있습니다'), findsOneWidget);
      expect(find.text('처리 중'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(
        MaterialApp(
          home: CatalogScreen(
            boxes: const [],
            campaigns: [Campaign(campaign())],
            balance: '0',
            onRefresh: () async {},
            onOpen: (_) {},
            onWallet: () {},
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('관리자 공개 배너'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
}
