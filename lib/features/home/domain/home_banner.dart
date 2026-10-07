import 'package:flutter/painting.dart';
import '../../../core/utils/format.dart';
import '../../gacha/domain/gacha_models.dart' show parseHexColor;

/// 배너 링크 종류(`GET /banners` items[].link.type).
enum BannerLinkType {
  gacha,
  attendance,
  topup,
  odds,
  url,
  none;

  static BannerLinkType fromCode(Object? code) =>
      switch (code is String ? code.toUpperCase() : null) {
        'GACHA' => BannerLinkType.gacha,
        'ATTENDANCE' => BannerLinkType.attendance,
        'TOPUP' => BannerLinkType.topup,
        'ODDS' => BannerLinkType.odds,
        'URL' => BannerLinkType.url,
        _ => BannerLinkType.none,
      };
}

/// 홈 히어로 배너. 서버가 활성·우선순위 순으로 걸러서 준다.
class HomeBanner {
  final int id;
  final String title;
  final String? subtitle;
  final String? badge;
  final String? imageUrl;
  final Color? accent;
  final BannerLinkType linkType;
  final String? linkTarget;
  final DateTime? startsAt;
  final DateTime? endsAt;

  const HomeBanner({
    required this.id,
    required this.title,
    this.subtitle,
    this.badge,
    this.imageUrl,
    this.accent,
    this.linkType = BannerLinkType.none,
    this.linkTarget,
    this.startsAt,
    this.endsAt,
  });

  factory HomeBanner.fromJson(Map<String, dynamic> json) {
    final link = asMap(json['link']);
    return HomeBanner(
      id: asInt(json['id']),
      title: asStringOrNull(json['title']) ?? '',
      subtitle: asStringOrNull(json['subtitle']),
      badge: asStringOrNull(json['badge']),
      imageUrl: asStringOrNull(json['imageUrl']),
      accent: parseHexColor(json['accentColorHex']),
      linkType: BannerLinkType.fromCode(link['type']),
      linkTarget: asStringOrNull(link['target']),
      startsAt: asDateOrNull(json['startsAt']),
      endsAt: asDateOrNull(json['endsAt']),
    );
  }

  bool get tappable {
    switch (linkType) {
      case BannerLinkType.none:
        return false;
      case BannerLinkType.gacha:
        return gachaId != null;
      case BannerLinkType.url:
        return url != null;
      case BannerLinkType.attendance:
      case BannerLinkType.topup:
      case BannerLinkType.odds:
        return true;
    }
  }

  /// GACHA·ODDS 링크의 박스 id.
  int? get gachaId => asIntOrNull(linkTarget);

  /// URL 링크(http/https만 연다).
  Uri? get url {
    if (linkType != BannerLinkType.url) return null;
    final u = Uri.tryParse(linkTarget ?? '');
    if (u == null || !(u.scheme == 'https' || u.scheme == 'http')) return null;
    return u;
  }

  /// "~10.21" (종료일이 있을 때만).
  String? get endLabel {
    final e = endsAt;
    return e == null ? null : '~${formatMonthDay(e)}';
  }
}
