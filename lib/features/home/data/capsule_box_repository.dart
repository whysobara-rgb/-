import '../../../core/network/api_client.dart';
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
    final data = await _apiClient.get('/gachas?page=1&limit=50');
    final map = data as Map<String, dynamic>;
    final items = map['items'] as List<dynamic>;
    return items
        .map((e) => CapsuleBox.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// 카테고리로 필터링된 캡슐 박스 목록.
  ///
  /// 현재 백엔드는 카테고리 필드를 제공하지 않아 항상 전체 목록을
  /// 반환한다. (추후 백엔드에 category 필드가 추가되면 쿼리 파라미터로
  /// 필터링하도록 교체)
  Future<List<CapsuleBox>> getByCategory(CapsuleCategory category) => getAll();

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
