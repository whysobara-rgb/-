import '../../../core/network/api_client.dart';
import '../domain/ranking_models.dart';

/// 가치가차 - 랭킹 탭 데이터 저장소.
///
/// 백엔드 `GET /rankings/*` 3개 엔드포인트를 호출해 실제 랭킹 데이터를
/// 가져온다.
class RankingRepository {
  final ApiClient _apiClient;

  const RankingRepository({ApiClient apiClient = const ApiClient()})
    : _apiClient = apiClient;

  /// 유저 랭킹 (누적 뽑기/획득가치 기준 상위 목록).
  Future<List<UserRankingItem>> getUserRankings() async {
    final data = await _apiClient.get('/rankings/users');
    final map = data as Map<String, dynamic>;
    final items = map['items'] as List<dynamic>;
    return items
        .map((e) => UserRankingItem.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// 인기 박스 랭킹 (누적 뽑기 횟수 기준 상위 목록).
  Future<List<GachaRankingItem>> getGachaRankings() async {
    final data = await _apiClient.get('/rankings/gachas');
    final map = data as Map<String, dynamic>;
    final items = map['items'] as List<dynamic>;
    return items
        .map((e) => GachaRankingItem.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// 실시간 당첨 피드 (최근 당첨 목록).
  Future<List<WinFeedItem>> getWinFeed() async {
    final data = await _apiClient.get('/rankings/wins');
    final map = data as Map<String, dynamic>;
    final items = map['items'] as List<dynamic>;
    return items
        .map((e) => WinFeedItem.fromJson(e as Map<String, dynamic>))
        .toList();
  }
}
