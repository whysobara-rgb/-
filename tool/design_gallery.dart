// 디자인 갤러리: 박스 패키지 8종과 상품 일러스트를 한 화면에 그린다.
// 실행: flutter build web -t tool/design_gallery.dart --output build/gallery
//       --base-href /gallery/ (또는 flutter run -t tool/design_gallery.dart)
import 'package:flutter/material.dart';
import 'package:gacha_vault/core/domain/product_category.dart';
import 'package:gacha_vault/core/domain/rarity.dart';
import 'package:gacha_vault/core/theme/app_theme.dart';
import 'package:gacha_vault/shared/widgets/pack_art.dart';
import 'package:gacha_vault/shared/widgets/product_art.dart';

void main() => runApp(const _Gallery());

/// 출시 박스 8종(서버 시드의 iconName·accentColorHex·badge).
const _boxes = <(String, String, Color, String?)>[
  ('그랜드 오픈 기념', 'celebration', Color(0xFFC9A227), 'OPEN 기념'),
  ('기프티콘', 'card_giftcard', Color(0xFF3D7BF7), null),
  ('뷰티', 'face_retouching_natural', Color(0xFFD6558C), null),
  ('테크 액세서리', 'headphones', Color(0xFF2A7DAF), 'NEW'),
  ('가전', 'devices', Color(0xFF4C8C4A), null),
  ('애플', 'phone_iphone', Color(0xFF3C3C3C), 'HOT'),
  ('명품 잡화', 'shopping_bag', Color(0xFF8A6D3B), null),
  ('드림', 'diamond', Color(0xFFB8862B), 'DREAM'),
];

const _items = <(String, Rarity)>[
  ('롤렉스 서브마리너 데이트', Rarity.ssr),
  ('샤넬 클래식 플랩백 미디엄', Rarity.ssr),
  ('애플 아이폰 프로 256GB', Rarity.ssr),
  ('애플 맥북 에어 13', Rarity.ssr),
  ('다이슨 V15 디텍트 무선청소기', Rarity.ssr),
  ('애플 에어팟 맥스', Rarity.ssr),
  ('다이슨 에어랩 멀티 스타일러', Rarity.ssr),
  ('신세계상품권 10만원', Rarity.ssr),
  ('애플 에어팟 프로', Rarity.sr),
  ('애플 워치 SE', Rarity.sr),
  ('조말론 런던 코롱 30ml', Rarity.sr),
  ('디올 어딕트 립 글로우', Rarity.sr),
  ('발뮤다 더 토스터', Rarity.sr),
  ('필립스 에어프라이어 XXL', Rarity.sr),
  ('로지텍 MX Master 3S', Rarity.sr),
  ('구찌 GG 마몬트 카드케이스', Rarity.sr),
  ('배달의민족 상품권 2만원', Rarity.sr),
  ('애플 아이패드 에어', Rarity.r),
  ('애플 에어태그 4팩', Rarity.r),
  ('애플 맥세이프 충전기', Rarity.r),
  ('앤커 나노 고속충전기 30W', Rarity.r),
  ('애플 정품 USB-C 케이블 1m', Rarity.r),
  ('라로슈포제 시카플라스트 밤 B5 100ml', Rarity.r),
  ('메종 키츠네 폭스헤드 반팔 티셔츠', Rarity.r),
  ('폴로 랄프로렌 베이스볼 캡', Rarity.r),
  ('필립스 소닉케어 전동칫솔', Rarity.r),
  ('스타벅스 카페 아메리카노 T', Rarity.r),
  ('배스킨라빈스 싱글레귤러', Rarity.r),
  ('스타벅스 e카드 1만원', Rarity.r),
  ('GS25 모바일상품권 1천원', Rarity.n),
  ('메가MGC커피 아메리카노', Rarity.n),
  ('휴대용 미니 선풍기', Rarity.n),
  ('무선 미니 가습기', Rarity.n),
  ('스마트폰 강화유리 필름 2매', Rarity.n),
  ('브랜드 핸드크림 미니 30ml', Rarity.n),
  ('명품 브랜드 향수 미니어처', Rarity.n),
];

class _Gallery extends StatelessWidget {
  const _Gallery();

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light,
      home: Scaffold(
        body: ListView(
          padding: const EdgeInsets.all(12),
          children: [
            GridView.count(
              crossAxisCount: 2,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              mainAxisSpacing: 10,
              crossAxisSpacing: 10,
              children: [
                for (final (title, icon, color, badge) in _boxes)
                  ClipRRect(
                    borderRadius: BorderRadius.circular(16),
                    child: Stack(
                      fit: StackFit.expand,
                      children: [
                        PackScene(
                          style: PackStyle.of(
                            category: ProductCategory.fromIconName(icon),
                            accent: color,
                            badge: badge,
                          ),
                        ),
                        Positioned(
                          left: 8,
                          top: 6,
                          child: Text(
                            title,
                            style: const TextStyle(fontSize: 11),
                          ),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 12),
            GridView.count(
              crossAxisCount: 3,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              mainAxisSpacing: 8,
              crossAxisSpacing: 8,
              children: [
                for (final (name, rarity) in _items)
                  ClipRRect(
                    borderRadius: BorderRadius.circular(12),
                    child: ProductArt(
                      category: ProductCategory.fromName(name),
                      rarity: rarity,
                      name: name,
                    ),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
