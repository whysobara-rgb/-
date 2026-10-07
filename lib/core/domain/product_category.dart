import 'package:flutter/material.dart';

/// 상품 사진이 없을 때 그리는 엠블럼의 분류.
///
/// 서버 아이템에는 분류 필드가 없어서 상품명 키워드와 박스 아이콘 이름으로
/// 추정한다. 표시용일 뿐이라 틀려도 기능에는 영향이 없다.
enum ProductCategory {
  watch(Icons.watch_outlined, '시계'),
  bag(Icons.shopping_bag_outlined, '가방'),
  leather(Icons.wallet_outlined, '가죽 소품'),
  phone(Icons.phone_iphone, '스마트폰'),
  laptop(Icons.laptop_mac, '노트북'),
  tablet(Icons.tablet_mac, '태블릿'),
  audio(Icons.headphones_outlined, '오디오'),
  wearable(Icons.watch, '웨어러블'),
  charger(Icons.bolt_outlined, '충전·케이블'),
  gadget(Icons.mouse_outlined, '주변기기'),
  appliance(Icons.blender_outlined, '가전'),
  hair(Icons.air, '헤어 기기'),
  beauty(Icons.face_retouching_natural, '뷰티'),
  fragrance(Icons.water_drop_outlined, '향수'),
  fashion(Icons.checkroom, '패션'),
  giftCard(Icons.card_giftcard_outlined, '상품권'),
  cafe(Icons.local_cafe_outlined, '카페'),
  dessert(Icons.icecream_outlined, '디저트'),
  food(Icons.restaurant_outlined, '식품'),
  jewel(Icons.diamond_outlined, '프리미엄'),
  box(Icons.inventory_2_outlined, '박스');

  const ProductCategory(this.icon, this.label);

  final IconData icon;
  final String label;

  /// 키워드 → 분류. 위에서부터 먼저 맞는 것을 쓴다(구체적인 것이 먼저).
  static const List<(List<String>, ProductCategory)> _rules = [
    (['에어랩', '드라이어', '고데기'], ProductCategory.hair),
    (['애플 워치', '애플워치', '갤럭시 워치', '스마트워치'], ProductCategory.wearable),
    (['롤렉스', '오메가', '까르띠에', '시계', '워치'], ProductCategory.watch),
    (['카드케이스', '지갑', '키링'], ProductCategory.leather),
    (['숄더백', '플랩백', '토트', '포쉐트', '가방', '백팩', '클러치'], ProductCategory.bag),
    (['충전기', '케이블', '맥세이프', '보조배터리'], ProductCategory.charger),
    (['에어태그', '마우스', 'mx master', '키보드', '필름', '홀더'], ProductCategory.gadget),
    (['아이폰', '갤럭시 s', '갤럭시s', '스마트폰'], ProductCategory.phone),
    (['맥북', '노트북', '그램'], ProductCategory.laptop),
    (['아이패드', '태블릿', '갤럭시 탭'], ProductCategory.tablet),
    (['에어팟', '헤드폰', '이어폰', '버즈', '스피커'], ProductCategory.audio),
    (
      ['청소기', '토스터', '에어프라이어', '선풍기', '가습기', '전동칫솔', '면도기', '가전', '다이슨', '발뮤다'],
      ProductCategory.appliance,
    ),
    (['향수', '코롱', '뚜왈렛', '퍼퓸', '디퓨저'], ProductCategory.fragrance),
    (['배스킨', '아이스크림', '싱글레귤러', '케이크', '디저트'], ProductCategory.dessert),
    (['립', '크림', '밤 ', '시카', '세럼', '쿠션', '뷰티'], ProductCategory.beauty),
    (['티셔츠', '캡', '모자', '스니커즈', '후디', '반팔', '패션'], ProductCategory.fashion),
    (['아메리카노', '커피', '라떼', '카페'], ProductCategory.cafe),
    (['상품권', '기프트카드', 'e카드', '기프티콘', '모바일상품권'], ProductCategory.giftCard),
    (['간식', '정찬', '식품', '도시락', '과자'], ProductCategory.food),
  ];

  /// 상품명으로 분류를 추정한다. 못 맞추면 [fallback].
  static ProductCategory fromName(
    String name, {
    ProductCategory fallback = ProductCategory.jewel,
  }) {
    final lower = '${name.toLowerCase()} ';
    for (final (words, category) in _rules) {
      for (final w in words) {
        if (lower.contains(w)) return category;
      }
    }
    return fallback;
  }

  /// 박스의 서버 아이콘 이름(Material 아이콘 이름)으로 분류를 고른다.
  static ProductCategory fromIconName(String? iconName) => switch (iconName) {
    'watch' || 'watch_rounded' => ProductCategory.watch,
    'shopping_bag' => ProductCategory.bag,
    'phone_iphone' || 'smartphone' => ProductCategory.phone,
    'headphones' => ProductCategory.audio,
    'devices' || 'kitchen' => ProductCategory.appliance,
    'face_retouching_natural' || 'spa' => ProductCategory.beauty,
    'checkroom' => ProductCategory.fashion,
    'card_giftcard' => ProductCategory.giftCard,
    'restaurant' => ProductCategory.food,
    'diamond' => ProductCategory.jewel,
    _ => ProductCategory.box,
  };
}
