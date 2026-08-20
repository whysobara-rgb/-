import '../../../core/utils/grade_mapper.dart';

/// 가치가차 - 뽑기(가챠) 1회 결과로 획득한 상품 정보.
///
/// 등급([grade], "S"/"A"/"B"/"C")에 따라 UI 표시 색상/뱃지가 결정되며,
/// [price]는 해당 상품의 추정 가치(원화)를 나타낸다.
/// 백엔드 응답의 rarity(N/R/SR/SSR)는 [GradeMapper]를 통해
/// UI 등급(S/A/B/C)으로 매핑된다.
class DrawResult {
  final String id;
  final String name;
  final String grade;

  /// 상품 추정 가치 (원화)
  final int price;

  /// 프리미엄(고가/한정) 상품 여부. 결과 화면 강조 표시 등에 활용.
  final bool isPremium;

  const DrawResult({
    required this.id,
    required this.name,
    required this.grade,
    required this.price,
    this.isPremium = false,
  });

  /// 백엔드 `POST /draws` 응답의 results[] 항목 1개를 [DrawResult]로 변환한다.
  factory DrawResult.fromJson(Map<String, dynamic> json) {
    final grade = GradeMapper.toUiGrade(json['rarity'] as String?);
    final price = (json['estimatedValue'] as num?)?.toInt() ?? 0;
    return DrawResult(
      id: 'draw_${json['drawId']}',
      name: json['name'] as String? ?? '',
      grade: grade,
      price: price,
      isPremium: grade == 'S',
    );
  }

  /// 화면 표시용 가격 포맷 (예: "1,200,000원")
  String get formattedPrice {
    final str = price.toString();
    final buffer = StringBuffer();
    for (int i = 0; i < str.length; i++) {
      final posFromEnd = str.length - i;
      buffer.write(str[i]);
      if (posFromEnd > 1 && posFromEnd % 3 == 1) buffer.write(',');
    }
    return '${buffer.toString()}원';
  }
}
