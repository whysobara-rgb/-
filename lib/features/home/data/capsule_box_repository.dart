import '../../../core/network/api_client.dart';
import '../../../shared/data/activity_page.dart';
import '../domain/capsule_box.dart';
import '../domain/capsule_category.dart';
import '../domain/gacha_detail.dart';

/// 가치가차 - 캡슐(랜덤박스) 저장소.
///
/// 백엔드 `GET /gachas`를 호출해 실제 랜덤박스 목록을 가져온다.
/// (과거 더미 리스트는 백엔드 seed 데이터로 완전히 이전되었다.)
class CapsuleBoxRepository {
  final ApiClient _apiClient;

  const CapsuleBoxRepository({ApiClient apiClient = const ApiClient()})
    : _apiClient = apiClient;

  /// 전체 캡슐 박스 목록을 서버에서 조회한다.
  Future<List<CapsuleBox>> getAll() async {
    final all = <CapsuleBox>[];
    final ids = <int>{};
    int? expectedTotal;
    for (int p = 1; p <= 100; p++) {
      final data = await _apiClient.get(
        '/gachas?page=$p&limit=100',
        withAuth: false,
      );
      final result = ActivityPage.parse(
        data,
        page: p,
        limit: 100,
        parse: CapsuleBox.fromJson,
        id: (b) => b.id.toString(),
      );
      if (expectedTotal != null && result.total != expectedTotal) {
        invalidActivity();
      }
      expectedTotal = result.total;
      for (final box in result.items) {
        if (!ids.add(box.id)) {
          invalidActivity();
        }
        all.add(box);
      }
      if (!result.hasMore) {
        return List.unmodifiable(all);
      }
    }
    throw ApiException(statusCode: 0, message: '상품이 많습니다. 목록 조회 범위를 확인해주세요');
  }

  Future<List<CapsuleBox>> getByCategory(CapsuleCategory category) async {
    final all = await getAll();
    final code = switch (category) {
      CapsuleCategory.luxury => 'luxury',
      CapsuleCategory.fashion => 'fashion',
      _ => null,
    };
    return code == null ? all : all.where((b) => b.category == code).toList();
  }

  /// 캡슐 박스 상세 정보 (실시간 재고 + 럭키 라인업 포함)를 조회한다.
  ///
  /// 백엔드 `GET /gachas/:id` 응답에는 목록 API에 없는 `totalStock`,
  /// `soldStock`(실시간 계산), `lineup`(등급별 실제 구성 아이템)이
  /// 추가로 포함되어 있어, 상세 화면에서는 반드시 이 메서드를 통해
  /// 최신 데이터를 가져와야 한다.
  Future<GachaDetail> getById(int id) async {
    final data = await _apiClient.get('/gachas/$id');
    return GachaDetail.fromJson(data as Map<String, dynamic>);
  }
}
