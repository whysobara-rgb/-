import '../../../core/utils/grade_mapper.dart';
import 'gacha_grade.dart';

/// 가치가차 - 뽑기(가챠) 1회 결과로 획득한 상품 정보.
///
/// 등급([grade], "B"/"A"/"S"/"SSS")에 따라 CLOVE 오리파 스타일 연출/색상이
/// 결정되며, [price]는 해당 상품의 추정 가치(원화 = marketPriceGP 상당)를
/// 나타낸다. 백엔드 응답의 rarity(N/R/SR/SSR)는 [GradeMapper]를 통해
/// UI 등급(B/A/S/SSS)으로 매핑된다.
class DrawResult {
  final String id;
  final String name;
  final String grade;

  /// 상품 추정 가치 (정가, GP/원화 단위 그대로 사용).
  final int price;

  /// 프리미엄(고가/한정) 상품 여부. 결과 화면 강조 표시 등에 활용.
  final bool isPremium;

  /// Server snapshot only; absent means a quote is still required.
  final int? conversionGp;

  /// 실제 상품 이미지 URL (있으면 실사진, 없으면 로컬 3D 폴백 사용).
  final String? imageUrl;

  /// 상품 카테고리 (백엔드가 제공하지 않으면 빈 문자열).
  final String category;

  const DrawResult({
    required this.id,
    required this.name,
    required this.grade,
    required this.price,
    this.isPremium = false,
    this.conversionGp,
    this.imageUrl,
    this.category = '',
  });

  /// CLOVE 등급 enum 표현.
  GachaGrade get gradeEnum => GachaGrade.fromCode(grade);

  /// Premium results first, then the highest retail value, then grade.
  static int compareForReveal(DrawResult a, DrawResult b) {
    if (a.isPremium != b.isPremium) return a.isPremium ? -1 : 1;
    final priceOrder = b.price.compareTo(a.price);
    return priceOrder != 0
        ? priceOrder
        : b.gradeEnum.rank.compareTo(a.gradeEnum.rank);
  }

  /// 백엔드 `POST /draws` 응답의 results[] 항목 1개를 [DrawResult]로 변환한다.
  factory DrawResult.fromJson(Map<String, dynamic> json) {
    final grade = GradeMapper.toUiGrade(json['rarity'] as String?);
    final price = (json['estimatedValue'] as num?)?.toInt() ?? 0;
    return DrawResult(
      id: 'draw_${json['drawId']}',
      name: json['name'] as String? ?? '',
      grade: grade,
      price: price,
      isPremium: json['isPremium'] as bool? ?? false,
      conversionGp: json['conversionGp'] as int?,
      imageUrl: json['imageUrl'] as String?,
      category: json['category'] as String? ?? '',
    );
  }

  /// 화면 표시용 가격 포맷 (예: "1,200,000원")
  String get formattedPrice => '${_formatNumber(price)}원';

  /// 화면 표시용 GP 포맷 (예: "1,200,000 GP")
  String get formattedGP => '${_formatNumber(price)} GP';

  String get formattedConversionGp =>
      conversionGp == null ? '견적 확인 필요' : '${_formatNumber(conversionGp!)} GP';

  static String _formatNumber(int value) {
    final str = value.toString();
    final buffer = StringBuffer();
    for (int i = 0; i < str.length; i++) {
      final posFromEnd = str.length - i;
      buffer.write(str[i]);
      if (posFromEnd > 1 && posFromEnd % 3 == 1) buffer.write(',');
    }
    return buffer.toString();
  }
}
