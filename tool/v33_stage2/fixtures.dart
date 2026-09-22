// Explicit synthetic fixtures. Never imported by production lib/.
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:gacha_vault/core/network/api_client.dart';
import 'package:gacha_vault/core/network/token_storage.dart';
import 'package:gacha_vault/features/orders/order_models.dart';
import 'package:gacha_vault/features/orders/order_repository.dart';
import 'package:gacha_vault/features/orders/batch_opening.dart';
import 'package:gacha_vault/features/inventory/domain/inventory_item.dart';
import 'package:gacha_vault/shared/models/app_user.dart';
import 'package:gacha_vault/shared/providers/auth_provider.dart';

String capsuleId(int n) =>
    '00000000-0000-4000-8000-${n.toRadixString(16).padLeft(12, '0')}';
const fixtureName = '취향을 담은 컬렉션 상품';
const longName = '긴 상품명도 끝까지 확인할 수 있는 나만의 소중한 컬렉션 상품 옵션과 구성 안내';
Map<String, dynamic> prizeData({String name = fixtureName, String? image}) => {
  'itemId': 101,
  'name': name,
  'rarity': 'SR',
  'conversionGP': 100,
  'probabilityPpm': 1000000,
  'isPremium': false,
  'imageUrl': image,
};
Map<String, dynamic> openingData(
  int n, {
  String name = fixtureName,
  String? image,
}) => {
  'capsuleId': capsuleId(n),
  'inventoryItemId': n,
  'prize': prizeData(name: name, image: image),
};
BatchOpening batchFixture({
  int completed = 2,
  int total = 2,
  bool pending = false,
  String name = fixtureName,
}) => BatchOpening(
  id: capsuleId(999),
  capsuleIds: List.generate(total, (i) => capsuleId(i + 1)),
  results: List.generate(
    completed,
    (i) => Opening(openingData(i + 1, name: name)),
  ),
  inFlight: pending ? capsuleId(completed + 1) : null,
);
List<InventoryItem> inventoryFixtures({int count = 4, bool long = false}) =>
    List.generate(
      count,
      (i) => InventoryItem(
        id: '${i + 1}',
        name: long ? '$longName ${i + 1}' : '$fixtureName ${i + 1}',
        grade: 'S',
        price: 1000,
        conversionGP: 100,
        icon: Icons.inventory_2_outlined,
        status: InventoryStatus.values[i % InventoryStatus.values.length],
        shippingEnabled: true,
        fulfillmentType: 'PHYSICAL',
        acquiredAt: DateTime(2026, 9, 20),
      ),
    );

class FixtureAuth extends AuthProvider {
  int? userId = 10;
  @override
  AppUser? get currentUser => userId == null
      ? null
      : AppUser(
          id: userId!,
          email: 'synthetic@example.invalid',
          nickname: '가치가차 테스트 계정',
          coinBalance: 9900,
        );
  void switchAccount(int? id) {
    userId = id;
    notifyListeners();
  }

  @override
  Future<void> refreshProfile() async {}
  @override
  Future<void> logout() async {
    switchAccount(null);
  }
}

class FixtureStore implements OrderStore {
  final values = <String, String>{};
  @override
  Future<String?> read(String key) async => values[key];
  @override
  Future<void> write(String key, String value) async {
    values[key] = value;
  }

  @override
  Future<void> remove(String key) async {
    values.remove(key);
  }
}

class FixtureToken extends TokenStorage {
  @override
  Future<String?> readToken() async => 'synthetic-only';
}

http.Response fixtureOk(dynamic value) => http.Response(
  jsonEncode({'statusCode': 10000, 'data': value}),
  200,
  headers: {'content-type': 'application/json; charset=utf-8'},
);
OrderRepository fixtureRepository(
  Future<http.Response> Function(http.Request) handler, {
  FixtureStore? store,
  FixtureAuth? auth,
}) => OrderRepository(
  api: ApiClient(
    client: MockClient(
      (r) async => r.url.path == '/users/me'
          ? fixtureOk({'id': auth?.userId ?? 10})
          : handler(r),
    ),
    apiBaseUrl: 'https://stage2.invalid',
    tokenStorage: FixtureToken(),
    timeout: const Duration(seconds: 30),
  ),
  store: store ?? FixtureStore(),
  userId: 10,
  server: 'https://stage2.invalid',
  enabled: true,
);

class FixtureInventory extends InventoryRepository {
  final List<InventoryItem> items;
  const FixtureInventory(this.items);
  @override
  Future<List<InventoryItem>> getAll({InventoryStatus? status}) async => items;
  @override
  Future<void> setLock(InventoryItem item, {required bool locked}) async =>
      throw StateError('Read-only UI fixture');
}

OrderRepository readOnlyRepository({BatchOpening? batch}) {
  final store = FixtureStore();
  final repo = fixtureRepository((r) async {
    if (r.method != 'GET') throw StateError('UI capture cannot mutate');
    if (r.url.path == '/capsules') {
      return fixtureOk({
        'items': List.generate(
          3,
          (i) => {
            'id': capsuleId(i + 1),
            'orderId': capsuleId(800),
            'sequence': i + 1,
            'status': 'UNOPENED',
          },
        ),
        'totalCount': 3,
        'page': 1,
        'limit': 20,
      });
    }
    throw StateError('Unmapped fixture route');
  }, store: store);
  if (batch != null) {
    store.values['${repo.scope}_batch'] = jsonEncode(batch.toJson());
  }
  return repo;
}
