import '../../../core/network/api_client.dart';
import '../../../core/utils/format.dart';
import '../domain/draw_result.dart';
import '../domain/gacha_models.dart';

/// 박스 목록·상세·확률·천장·뽑기 API.
class GachaRepository {
  final ApiClient _api;

  const GachaRepository({ApiClient apiClient = const ApiClient()})
    : _api = apiClient;

  Future<List<GachaSummary>> list() async {
    final data = asMap(
      await _api.get('/gachas?page=1&limit=50', withAuth: false),
    );
    return asMapList(data['items']).map(GachaSummary.fromJson).toList();
  }

  Future<GachaDetail> detail(int id) async => GachaDetail.fromJson(
    asMap(await _api.get('/gachas/$id', withAuth: false)),
  );

  Future<GachaOdds> odds(int id) async => GachaOdds.fromJson(
    asMap(await _api.get('/gachas/$id/odds', withAuth: false)),
  );

  Future<PityStatus> pity(int id) async =>
      PityStatus.fromJson(asMap(await _api.get('/gachas/$id/pity')));

  /// [count]는 유료 뽑기 횟수(1..100). 10회마다 보너스 1회가 붙는다.
  Future<DrawOutcome> draw({required int gachaId, required int count}) async {
    final data = await _api.post(
      '/draws',
      body: {'gachaId': gachaId, 'count': count},
    );
    return DrawOutcome.fromJson(asMap(data));
  }
}
