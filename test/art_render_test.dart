import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gacha_vault/core/domain/product_category.dart';
import 'package:gacha_vault/core/domain/rarity.dart';
import 'package:gacha_vault/core/theme/app_theme.dart';
import 'package:gacha_vault/shared/widgets/pack_art.dart';
import 'package:gacha_vault/shared/widgets/product_art.dart';
import 'package:gacha_vault/shared/widgets/rarity_tag.dart';

/// 그림 위젯을 디버그 모드로 실제로 칠해 본다. 페인터 안의 TextStyle
/// (color와 foreground 동시 지정 등) assert는 릴리스 빌드에서는 조용히
/// 지나가므로 여기서 잡는다.
Widget _grid(List<Widget> children) => MaterialApp(
  theme: AppTheme.light,
  home: Scaffold(
    body: SingleChildScrollView(
      child: Wrap(
        children: [
          for (final c in children) SizedBox(width: 96, height: 96, child: c),
        ],
      ),
    ),
  ),
);

void main() {
  testWidgets('모든 분류·배지의 박스 패키지가 오류 없이 그려진다', (tester) async {
    await tester.binding.setSurfaceSize(const Size(1200, 4000));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    const badges = <String?>[null, 'NEW', 'HOT', 'DREAM', 'OPEN 기념', 'SPECIAL'];
    await tester.pumpWidget(
      _grid([
        for (final c in ProductCategory.values)
          for (final b in badges)
            PackScene(
              style: PackStyle.of(
                category: c,
                accent: const Color(0xFF3D7BF7),
                badge: b,
              ),
              scale: 0.7,
              centerY: 0.54,
              rays: b == 'DREAM',
            ),
      ]),
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('모든 분류·등급의 상품 일러스트가 오류 없이 그려진다', (tester) async {
    await tester.binding.setSurfaceSize(const Size(1200, 4000));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    // 이름으로 고르는 변형(헤드폰/이어폰, 맥세이프, 청소기, 립 등)도 지나가게 한다.
    const names = <String?>[
      null,
      '에어팟 맥스',
      '맥세이프 충전기',
      '에어태그',
      '청소기',
      '토스터',
      '선풍기',
      '가습기',
      '전동칫솔',
      '립스틱',
      '핸드크림',
      '볼캡',
      '신세계상품권 10만원',
      '아이패드 프로 B5',
    ];
    await tester.pumpWidget(
      _grid([
        for (final c in ProductCategory.values)
          for (final r in Rarity.values)
            for (final n in names.take(r == Rarity.n ? names.length : 2))
              ProductArt(category: c, rarity: r, name: n),
      ]),
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('배지와 등급 표식이 오류 없이 그려진다', (tester) async {
    await tester.pumpWidget(
      _grid([
        for (final b in ['NEW', 'HOT', 'DREAM', 'SPECIAL', 'OPEN 기념'])
          Center(child: BoxBadge(b)),
        for (final r in Rarity.values) ...[
          Center(child: RarityTag(r)),
          Center(child: RarityTag(r, large: true, holo: true)),
          Center(child: RarityPill(r, '1,000원')),
        ],
      ]),
    );
    expect(tester.takeException(), isNull);
  });
}
