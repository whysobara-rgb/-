/// 가치가차 - 뽑기(가챠) 1회 결과로 획득한 상품 정보.
///
/// 등급([grade], "S"/"A"/"B"/"C")에 따라 UI 표시 색상/뱃지가 결정되며,
/// [price]는 해당 상품의 소비자가(원화)를 나타낸다.
class DrawResult {
  final String id;
  final String name;
  final String grade;

  /// 상품 소비자가 (원화)
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
