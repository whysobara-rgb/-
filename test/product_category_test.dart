import 'package:flutter_test/flutter_test.dart';
import 'package:gacha_vault/core/domain/product_category.dart';
import 'package:gacha_vault/core/domain/rarity.dart';

void main() {
  test('상품명으로 엠블럼 분류를 고른다(구체적인 규칙이 먼저)', () {
    final cases = <String, ProductCategory>{
      '롤렉스 서브마리너 데이트': ProductCategory.watch,
      '애플 워치 SE': ProductCategory.wearable,
      '샤넬 클래식 플랩백 미디엄': ProductCategory.bag,
      '구찌 GG 마몬트 카드케이스': ProductCategory.leather,
      '애플 아이폰 프로 256GB': ProductCategory.phone,
      '스마트폰 강화유리 필름 2매': ProductCategory.gadget,
      '애플 맥북 에어 13': ProductCategory.laptop,
      '애플 에어팟 맥스': ProductCategory.audio,
      '애플 정품 USB-C 케이블 1m': ProductCategory.charger,
      '로지텍 MX Master 3S': ProductCategory.gadget,
      '다이슨 에어랩 멀티 스타일러': ProductCategory.hair,
      '다이슨 V15 디텍트 무선청소기': ProductCategory.appliance,
      '필립스 에어프라이어 XXL': ProductCategory.appliance,
      '조말론 런던 코롱 30ml': ProductCategory.fragrance,
      '브랜드 핸드크림 미니 30ml': ProductCategory.beauty,
      '배스킨라빈스 싱글레귤러': ProductCategory.dessert,
      '메가MGC커피 아메리카노': ProductCategory.cafe,
      '신세계상품권 10만원': ProductCategory.giftCard,
      '스타벅스 e카드 1만원': ProductCategory.giftCard,
      '폴로 랄프로렌 베이스볼 캡': ProductCategory.fashion,
    };
    cases.forEach((name, expected) {
      expect(ProductCategory.fromName(name), expected, reason: name);
    });
    expect(
      ProductCategory.fromName('알 수 없는 상품', fallback: ProductCategory.box),
      ProductCategory.box,
    );
  });

  test('박스 아이콘 이름 → 분류', () {
    expect(ProductCategory.fromIconName('diamond'), ProductCategory.jewel);
    expect(ProductCategory.fromIconName('headphones'), ProductCategory.audio);
    expect(ProductCategory.fromIconName(null), ProductCategory.box);
  });

  test('레어도 포일: SR 이상만 금속성, 그라데이션 길이 = stops 길이', () {
    expect(Rarity.n.isFoil, isFalse);
    expect(Rarity.r.isFoil, isFalse);
    expect(Rarity.sr.isFoil, isTrue);
    expect(Rarity.ssr.isFoil, isTrue);
    for (final r in Rarity.values) {
      final stops = r.foilStops;
      if (stops != null) expect(stops.length, r.foil.length, reason: r.code);
    }
  });
}
