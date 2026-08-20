/// 가치가차 - 백엔드 아이템 희귀도(N/R/SR/SSR)를
/// Flutter UI의 등급 표기(S/A/B/C)로 매핑하는 유틸리티.
///
/// 매핑 규칙 (희귀도가 높을수록 상위 등급):
///   SSR -> S (최고 등급)
///   SR  -> A
///   R   -> B
///   N   -> C (기본 등급)
class GradeMapper {
  GradeMapper._();

  static const Map<String, String> _map = {
    'SSR': 'S',
    'SR': 'A',
    'R': 'B',
    'N': 'C',
  };

  static String toUiGrade(String? backendRarity) {
    if (backendRarity == null) return 'C';
    return _map[backendRarity] ?? 'C';
  }
}
