// Review entrypoint only. Synthetic reads, no transport and no mutations.
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:gacha_vault/core/network/api_client.dart';
import 'package:gacha_vault/features/home/domain/capsule_box.dart';
import 'package:gacha_vault/features/home/domain/gacha_detail.dart';
import 'package:gacha_vault/features/orders/order_repository.dart';
import '../unified_ux/fixture_data.dart';
import '../unified_ux/review_order_fixtures.dart';
import '../v33_stage2/fixtures.dart';
import 'fixture.dart';

const applicationSourceSha = 'f58a075c18c77c644efd2c2b14a6d1c39a65b2a9';
const mutationBlockedMessage = '검토용 화면에서는 거래를 실행하지 않습니다.';

Map<String, dynamic> browserOdds(CapsuleBox box) => {
  ...Map<String, dynamic>.from(jsonDecode(unifiedFixtureJson)['odds']),
  'gachaId': box.id,
  'unitPrice': box.priceWon,
};

GachaDetail browserDetail(CapsuleBox box) => GachaDetail(
  id: box.id,
  title: box.name,
  description: '구성 상품과 확률을 확인하고 선택하세요.',
  price: box.priceWon,
  icon: box.icon,
  accentColor: box.accentColor,
  imageUrl: box.imageUrl,
  totalStock: 100,
  soldStock: 0,
  lineup: const [],
);

/// All calls stay in MockClient. Unknown reads and every write fail closed.
class BrowserFixture {
  final calls = <String>[];
  late final OrderRepository repository = fixtureRepository(handle);

  Future<http.Response> handle(http.Request request) async {
    calls.add('${request.method} ${request.url.path}');
    if (request.method != 'GET') {
      throw ApiException(
        statusCode: 10001,
        httpStatusCode: 400,
        message: mutationBlockedMessage,
      );
    }
    for (final box in r2Boxes) {
      if (request.url.path == '/gachas/${box.id}/odds') {
        return fixtureOk(browserOdds(box));
      }
    }
    // Existing unopened/result catalog has its own separately labelled fixture.
    if (request.url.path == '/gachas/901/odds') {
      return fixtureOk(jsonDecode(unifiedFixtureJson)['odds']);
    }
    if (request.url.path == '/capsules') {
      return fixtureOk({
        'items': reviewReceiptData()['capsules'],
        'totalCount': 3,
        'page': 1,
        'limit': 20,
      });
    }
    if (request.url.path == '/orders/${capsuleId(800)}') {
      return fixtureOk(reviewReceiptData());
    }
    throw ApiException(statusCode: 0, message: '이 조회는 검토 데이터에 없습니다.');
  }
}
