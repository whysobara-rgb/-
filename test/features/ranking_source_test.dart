import 'package:flutter_test/flutter_test.dart';
import 'package:gacha_vault/core/network/api_client.dart';
import 'package:gacha_vault/features/ranking/data/ranking_repository.dart';
import 'package:gacha_vault/features/ranking/domain/ranking_models.dart';

class RankingApi extends ApiClient {
  dynamic data;
  @override
  Future<dynamic> get(String path, {bool withAuth = true}) async => data;
}

void main() {
  test(
    'legacy ranking payload cannot be displayed as verified activity',
    () async {
      final api = RankingApi()..data = {'items': []};
      final repository = RankingRepository(apiClient: api);
      await expectLater(repository.getWinFeed(), throwsA(isA<ApiException>()));
      await expectLater(
        repository.getUserRankings(),
        throwsA(isA<ApiException>()),
      );
      await expectLater(
        repository.getGachaRankings(),
        throwsA(isA<ApiException>()),
      );
      api.data = {'source': 'CONFIRMED_CAPSULE_OPENINGS_V1', 'items': []};
      expect(await repository.getWinFeed(), isEmpty);
    },
  );
  test('an invalid win timestamp cannot appear as a new win', () {
    expect(
      () => WinFeedItem.fromJson({
        'inventoryItemId': 1,
        'nickname': '테스트',
        'gachaTitle': '박스',
        'itemName': '상품',
        'wonAt': 'invalid',
      }),
      throwsA(isA<ApiException>()),
    );
  });
}
