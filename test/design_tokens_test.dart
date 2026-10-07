import 'package:flutter/painting.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gacha_vault/core/domain/product_category.dart';
import 'package:gacha_vault/core/domain/rarity.dart';
import 'package:gacha_vault/core/theme/app_colors.dart';
import 'package:gacha_vault/core/theme/rarity_style.dart';
import 'package:gacha_vault/features/gacha/presentation/widgets/gacha_fx_painters.dart';
import 'package:gacha_vault/shared/widgets/pack_art.dart';
import 'package:gacha_vault/shared/widgets/product_art.dart';

double _contrast(Color a, Color b) {
  final la = a.computeLuminance();
  final lb = b.computeLuminance();
  final hi = la > lb ? la : lb;
  final lo = la > lb ? lb : la;
  return (hi + 0.05) / (lo + 0.05);
}

void main() {
  test('캡슐 레드는 흰 바탕 글자로도, 흰 글자 바탕으로도 4.5:1 이상이다', () {
    expect(
      _contrast(AppColors.brand, AppColors.canvas),
      greaterThanOrEqualTo(4.5),
    );
    expect(
      _contrast(AppColors.onBrand, AppColors.brand),
      greaterThanOrEqualTo(4.5),
    );
  });

  test('본문·보조 글자와 레어도 잉크는 흰 바탕에서 4.5:1 이상이다', () {
    for (final c in [AppColors.text, AppColors.textSecondary]) {
      expect(_contrast(c, AppColors.canvas), greaterThanOrEqualTo(4.5));
    }
    for (final r in Rarity.values) {
      expect(
        _contrast(r.ink, AppColors.canvas),
        greaterThanOrEqualTo(4.5),
        reason: '${r.code} ink',
      );
    }
  });

  test('무대 색면은 등급이 오를수록 가운데가 밝아지고 SSR이 가장 밝다', () {
    double lum(Rarity r) => r.field.center.computeLuminance();
    expect(lum(Rarity.ssr), greaterThan(lum(Rarity.sr)));
    expect(lum(Rarity.ssr), greaterThan(lum(Rarity.r)));
    expect(lum(Rarity.ssr), greaterThan(lum(Rarity.n)));
    // 검정에 가까운 무대는 쓰지 않는다.
    for (final r in Rarity.values) {
      expect(r.field.mid.computeLuminance(), greaterThan(0.02), reason: r.code);
    }
  });

  test('승급 색면은 양 끝에서 정확히 이전/새 등급이고, 중간은 밝은 섬광을 거친다', () {
    expect(stageFieldStep(Rarity.sr, Rarity.ssr, 0), Rarity.sr.field);
    expect(stageFieldStep(Rarity.sr, Rarity.ssr, 1), Rarity.ssr.field);
    final mid = stageFieldStep(Rarity.r, Rarity.sr, 0.4);
    expect(
      mid.center.computeLuminance(),
      greaterThan(Rarity.sr.field.center.computeLuminance()),
    );
  });

  test('금 색면(SSR) 위 글자는 어두운 색, 나머지 색면 위는 흰색', () {
    expect(stageInk(Rarity.ssr).computeLuminance(), lessThan(0.1));
    for (final r in [Rarity.n, Rarity.r, Rarity.sr]) {
      expect(stageInk(r), const Color(0xFFFFFFFF));
    }
  });

  test('출시 박스 8종은 서로 다른 패키지 워드마크·무늬를 받는다', () {
    const launch = <(String, Color, String?)>[
      ('celebration', Color(0xFFC9A227), 'OPEN 기념'),
      ('card_giftcard', Color(0xFF3D7BF7), null),
      ('face_retouching_natural', Color(0xFFD6558C), null),
      ('headphones', Color(0xFF2A7DAF), 'NEW'),
      ('devices', Color(0xFF4C8C4A), null),
      ('phone_iphone', Color(0xFF3C3C3C), 'HOT'),
      ('shopping_bag', Color(0xFF8A6D3B), null),
      ('diamond', Color(0xFFB8862B), 'DREAM'),
    ];
    final styles = [
      for (final (icon, color, badge) in launch)
        PackStyle.of(
          category: ProductCategory.fromIconName(icon),
          accent: color,
          badge: badge,
        ),
    ];
    expect(styles.map((s) => s.word).toSet().length, 8);
    expect(styles.map((s) => s.motif).toSet().length, 8);
    expect(styles.first.word, 'OPEN');
    expect(styles.first.lid, AppColors.brand);
  });

  test('상품권 이름에서 사용처와 금액을 읽는다', () {
    expect(parseVoucher('신세계상품권 10만원'), ('신세계', '10만원'));
    expect(parseVoucher('스타벅스 e카드 1만원'), ('스타벅스', '1만원'));
    expect(parseVoucher('CU 모바일상품권 5천원'), ('CU', '5천원'));
    expect(parseVoucher('올리브영 기프트카드 2만원'), ('올리브영', '2만원'));
    expect(parseVoucher('상품권'), ('상품권', null));
  });
}
