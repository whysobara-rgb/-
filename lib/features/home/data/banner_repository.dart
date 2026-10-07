import '../../../core/network/api_client.dart';
import '../../../core/utils/format.dart';
import '../domain/home_banner.dart';

class BannerRepository {
  final ApiClient _api;
  const BannerRepository({ApiClient apiClient = const ApiClient()})
    : _api = apiClient;

  /// 활성 배너. 엔드포인트가 없거나(404 등) 실패하면 빈 목록.
  Future<List<HomeBanner>> list() async {
    try {
      final data = asMap(await _api.get('/banners', withAuth: false));
      return asMapList(
        data['items'],
      ).map(HomeBanner.fromJson).where((b) => b.title.isNotEmpty).toList();
    } catch (_) {
      return const [];
    }
  }
}
