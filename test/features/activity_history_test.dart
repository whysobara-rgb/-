import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gacha_vault/core/network/api_client.dart';
import 'package:gacha_vault/shared/data/activity_page.dart';
import 'package:gacha_vault/shared/widgets/activity_feed.dart';
import 'package:gacha_vault/features/wallet/domain/point_history.dart';
import 'package:gacha_vault/features/shipping/domain/shipping_request.dart';

Map<String, dynamic> entry(int id) => {
  'id': id,
  'type': 'USE',
  'amount': -100,
  'description': '캡슐 구매',
  'createdAt': '2026-09-14T12:00:00Z',
};
Map<String, dynamic> page(
  int number,
  List<dynamic> items,
  int total, {
  int limit = 20,
}) => {'page': number, 'limit': limit, 'totalCount': total, 'items': items};

class HistoryApi extends ApiClient {
  final paths = <String>[];
  dynamic data;
  @override
  Future<dynamic> get(String path, {bool withAuth = true}) async {
    paths.add(path);
    return data;
  }
}

void main() {
  test('wallet fetches page six with the same server-side filter', () async {
    final api = HistoryApi()..data = page(6, [entry(101)], 101);
    final result = await PointHistoryRepository(
      apiClient: api,
    ).getPage(page: 6, type: PointHistoryType.use);
    expect(result.items.single.id, '101');
    expect(result.hasMore, isFalse);
    expect(api.paths.single, '/wallet/point-history?page=6&limit=20&type=USE');
  });
  test(
    'unknown types, invalid dates and wrong signs are never invented credits',
    () {
      for (final malformed in [
        {...entry(1), 'type': 'UNKNOWN'},
        {...entry(1), 'createdAt': 'invalid'},
        {...entry(1), 'amount': 100},
        {...entry(1), 'amount': -1.5},
      ]) {
        expect(
          () => PointHistoryEntry.fromJson(malformed),
          throwsA(isA<ApiException>()),
        );
      }
    },
  );
  test(
    'page corruption is rejected instead of hiding missing activity',
    () async {
      final api = HistoryApi();
      for (final data in [
        page(1, [entry(1)], 21),
        page(2, [], 0),
        page(1, [entry(1), entry(1)], 2),
        {'items': []},
      ]) {
        api.data = data;
        await expectLater(
          PointHistoryRepository(apiClient: api).getPage(),
          throwsA(isA<ApiException>()),
        );
      }
    },
  );
  test(
    'shipping remains a read-only authenticated request with exact status',
    () async {
      final api = HistoryApi()
        ..data = page(1, [
          {
            'fulfillmentId': '11111111-1111-4111-8111-111111111111',
            'feeGP': 100,
            'recipient': {
              'name': '테스트',
              'phone': '010-0000-0000',
              'postalCode': '00000',
              'address1': '샘플 주소',
              'address2': '',
              'notes': '',
            },
            'recipientName': '테스트',
            'phone': '010-0000-0000',
            'address': '샘플 주소',
            'notes': '',
            'status': 'SHIPPING',
            'createdAt': '2026-09-14T00:00:00Z',
            'items': [
              {
                'inventoryItemId': 9,
                'prize': {'name': '테스트 상품'},
              },
            ],
          },
        ], 1);
      final result = await ShippingRepository(apiClient: api).getPage();
      expect(result.items.single.status, ShippingStatus.shipping);
      expect(result.items.single.products.single.inventoryId, 9);
      expect(api.paths.single, '/fulfillments?page=1&limit=20');
    },
  );
  testWidgets('pagination failures preserve loaded rows and can be retried', (
    tester,
  ) async {
    var fail = true;
    final calls = <int>[];
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ActivityFeed<int>(
            header: const Text('활동'),
            id: (i) => '$i',
            itemBuilder: (i) => Text('내역 $i'),
            emptyTitle: '비어 있음',
            emptyDescription: '',
            emptyIcon: Icons.receipt,
            loadPage: (number) async {
              calls.add(number);
              if (number == 2 && fail) throw StateError('offline');
              return ActivityPage(
                items: [number],
                page: number,
                limit: 1,
                total: 2,
              );
            },
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('이전 내역 더 보기'));
    await tester.pumpAndSettle();
    expect(find.text('내역 1'), findsOneWidget);
    expect(find.text('모든 내역을 확인했어요'), findsNothing);
    fail = false;
    await tester.tap(find.text('다시 시도'));
    await tester.pumpAndSettle();
    expect(find.text('내역 2'), findsOneWidget);
    expect(calls, [1, 2, 2]);
  });
  testWidgets(
    'a response from a replaced filter cannot populate the new filter',
    (tester) async {
      final old = Completer<ActivityPage<int>>();
      Widget feed(String key, Future<ActivityPage<int>> result) => MaterialApp(
        home: Scaffold(
          body: ActivityFeed<int>(
            key: ValueKey(key),
            header: Text(key),
            id: (i) => '$i',
            itemBuilder: (i) => Text('내역 $i'),
            emptyTitle: '',
            emptyDescription: '',
            emptyIcon: Icons.receipt,
            loadPage: (_) => result,
          ),
        ),
      );
      await tester.pumpWidget(feed('전체', old.future));
      await tester.pumpWidget(
        feed(
          '사용',
          Future.value(ActivityPage(items: [2], page: 1, limit: 20, total: 1)),
        ),
      );
      await tester.pumpAndSettle();
      old.complete(ActivityPage(items: [1], page: 1, limit: 20, total: 1));
      await tester.pumpAndSettle();
      expect(find.text('내역 1'), findsNothing);
      expect(find.text('내역 2'), findsOneWidget);
    },
  );
}
