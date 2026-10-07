import '../../../core/network/api_client.dart';
import '../../../core/utils/format.dart';
import '../domain/ranking_models.dart';

class RankingRepository {
  final ApiClient _api;
  const RankingRepository({ApiClient apiClient = const ApiClient()})
    : _api = apiClient;

  Future<List<UserRankingItem>> users() async => asMapList(
    asMap(await _api.get('/rankings/users'))['items'],
  ).map(UserRankingItem.fromJson).toList();

  Future<List<GachaRankingItem>> gachas() async => asMapList(
    asMap(await _api.get('/rankings/gachas'))['items'],
  ).map(GachaRankingItem.fromJson).toList();

  Future<List<WinFeedItem>> wins() async => asMapList(
    asMap(await _api.get('/rankings/wins'))['items'],
  ).map(WinFeedItem.fromJson).toList();
}
