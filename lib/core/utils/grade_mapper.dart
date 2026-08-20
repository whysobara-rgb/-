/// 가치가차 - 백엔드 rarity 코드를 CLOVE 오리파 스타일 UI 등급으로 매핑.
///
/// 백엔드 `Item.rarity`(N/R/SR/SSR, 낮은순)를 프론트 4등급 체계
/// (B/A/S/SSS, 낮은순)로 변환한다.
///   N   -> B   (기본/꽝)
///   R   -> A   (선방)
///   SR  -> S   (대박, 상위 1%)
///   SSR -> SSS (초대박/잭팟)
class GradeMapper {
  static const Map<String, String> _map = {
    'N': 'B',
    'R': 'A',
    'SR': 'S',
    'SSR': 'SSS',
  };

  static String toUiGrade(String? backendRarity) {
    if (backendRarity == null) return 'B';
    return _map[backendRarity] ?? 'B';
  }
}
