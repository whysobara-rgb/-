import 'package:flutter/painting.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gacha_vault/core/domain/product_category.dart';
import 'package:gacha_vault/core/domain/rarity.dart';
import 'package:gacha_vault/features/gacha/domain/gacha_models.dart';
import 'package:gacha_vault/features/home/domain/home_banner.dart';
import 'package:gacha_vault/features/home/presentation/widgets/win_ticker.dart';
import 'package:gacha_vault/features/ranking/domain/ranking_models.dart';

void main() {
  test('GachaSummary: topPrize·accent·iconName 파싱, 없으면 null', () {
    final s = GachaSummary.fromJson({
      'id': 16,
      'title': '드림 박스',
      'price': 99000,
      'iconName': 'diamond',
      'accentColorHex': '#B8862B',
      'totalStock': 2000,
      'soldStock': 1500,
      'topPrize': {
        'itemId': 84,
        'name': '롤렉스 서브마리너 데이트',
        'rarity': 'SSR',
        'estimatedValue': 16000000,
        'imageUrl': null,
      },
    });
    expect(s.topPrize!.rarity, Rarity.ssr);
    expect(s.topPrize!.estimatedValue, 16000000);
    expect(s.accent, const Color(0xFFB8862B));
    expect(s.category, ProductCategory.jewel);
    expect(s.soldRatio, 0.75);
    expect(s.isEndingSoon(), isTrue);

    final old = GachaSummary.fromJson({'id': 1, 'title': 'a', 'price': 500});
    expect(old.topPrize, isNull);
    expect(old.accent, isNull);
    expect(old.isEndingSoon(), isFalse, reason: '재고 정보가 없으면 마감 임박 아님');
    expect(
      GachaSummary.fromJson({
        'id': 2,
        'title': 'b',
        'price': 1,
        'topPrize': 'oops',
        'accentColorHex': 'zz',
      }).topPrize,
      isNull,
    );
  });

  test('마감 임박: 70% 이상 판매 + 품절 아님', () {
    GachaSummary box(int sold, {bool soldOut = false}) => GachaSummary(
      id: 1,
      title: 't',
      price: 1,
      totalStock: 100,
      soldStock: sold,
      soldOut: soldOut,
    );
    expect(box(69).isEndingSoon(), isFalse);
    expect(box(70).isEndingSoon(), isTrue);
    expect(box(100, soldOut: true).isEndingSoon(), isFalse);
  });

  test('parseHexColor', () {
    expect(parseHexColor('#C9A227'), const Color(0xFFC9A227));
    expect(parseHexColor('80C9A227'), const Color(0x80C9A227));
    expect(parseHexColor(null), isNull);
    expect(parseHexColor('#12'), isNull);
  });

  group('HomeBanner', () {
    test('링크 종류별 탭 가능 여부와 종료일 라벨', () {
      final gacha = HomeBanner.fromJson({
        'id': 1,
        'title': '그랜드 오픈 기념 박스',
        'badge': 'OPEN 기념',
        'accentColorHex': '#C9A227',
        'link': {'type': 'GACHA', 'target': '9'},
        'endsAt': '2026-10-21T05:20:47.650Z',
      });
      expect(gacha.linkType, BannerLinkType.gacha);
      expect(gacha.gachaId, 9);
      expect(gacha.tappable, isTrue);
      expect(gacha.endLabel, startsWith('~10.2'));

      final none = HomeBanner.fromJson({
        'id': 2,
        'title': 'x',
        'link': {'type': 'NONE', 'target': null},
      });
      expect(none.tappable, isFalse);
      expect(none.endLabel, isNull);

      final odds = HomeBanner.fromJson({
        'id': 3,
        'title': '10회 뽑으면 1회 더',
        'link': {'type': 'ODDS', 'target': null},
      });
      expect(odds.tappable, isTrue, reason: 'target이 없으면 전체 확률 목록으로');
      expect(odds.gachaId, isNull);

      final badUrl = HomeBanner.fromJson({
        'id': 4,
        'title': 'x',
        'link': {'type': 'URL', 'target': 'javascript:alert(1)'},
      });
      expect(badUrl.tappable, isFalse, reason: 'http(s)만 연다');
      final url = HomeBanner.fromJson({
        'id': 5,
        'title': 'x',
        'link': {'type': 'URL', 'target': 'https://example.com/notice'},
      });
      expect(url.url.toString(), 'https://example.com/notice');
      expect(
        HomeBanner.fromJson({'id': 6, 'title': 'y'}).linkType,
        BannerLinkType.none,
      );
    });
  });

  test('당첨 티커는 SR 이상만', () {
    WinFeedItem w(String r) => WinFeedItem.fromJson({
      'inventoryItemId': r.hashCode,
      'nickname': '가**',
      'gachaTitle': 'g',
      'itemName': 'i',
      'rarity': r,
      'estimatedValue': 1,
      'wonAt': '2026-10-07T04:59:47.920Z',
    });
    final picked = WinTicker.pick([w('N'), w('R'), w('SR'), w('SSR')]);
    expect(picked.map((e) => e.rarity), [Rarity.sr, Rarity.ssr]);
    expect(WinTicker.pick([w('N'), w('R')]), isEmpty);
  });
}
