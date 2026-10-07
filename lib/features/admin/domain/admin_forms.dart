import 'admin_models.dart';

/// 운영자 입력 검증. 서버 DTO(`admin.dto.ts`)와 같은 규칙을 먼저 확인해
/// 잘못된 요청을 보내기 전에 막는다. 서버도 다시 확인한다(10001).

/// 발송 처리: 택배사 + 송장번호.
class ShipForm {
  final String company;
  final String trackingNumber;

  const ShipForm({required this.company, required this.trackingNumber});

  static const companies = ['CJ대한통운', '롯데택배', '한진택배', '우체국택배', '로젠택배'];

  /// 필드별 오류. 비어 있으면 보낼 수 있다.
  Map<String, String> validate() {
    final errors = <String, String>{};
    final c = company.trim();
    final n = trackingNumber.trim();
    if (c.isEmpty) {
      errors['company'] = '택배사를 골라 주세요';
    } else if (c.length > 50) {
      errors['company'] = '택배사는 50자까지 입력할 수 있어요';
    }
    if (n.isEmpty) {
      errors['trackingNumber'] = '송장번호를 입력해 주세요';
    } else if (n.length > 50) {
      errors['trackingNumber'] = '송장번호는 50자까지 입력할 수 있어요';
    } else if (!RegExp(r'^[0-9A-Za-z-]+$').hasMatch(n)) {
      errors['trackingNumber'] = '송장번호는 숫자·영문·하이픈만 넣어 주세요';
    }
    return errors;
  }

  Map<String, dynamic> toJson() => {
    'status': 'SHIPPING',
    'trackingCompany': company.trim(),
    'trackingNumber': trackingNumber.trim(),
  };
}

/// 회차 수량 변경. 이미 판매된 수보다 작을 수 없다.
String? validateTotalStock(String input, {required int soldCount}) {
  final value = int.tryParse(input.trim());
  if (input.trim().isEmpty) return '수량을 입력해 주세요';
  if (value == null) return '숫자만 입력해 주세요';
  if (value < 0) return '0 이상이어야 해요';
  if (value < soldCount) return '이미 판매된 $soldCount개보다 적게 정할 수 없어요';
  return null;
}

/// 배너 생성·수정.
class BannerForm {
  String title;
  String subtitle;
  String badge;
  String accentColorHex;
  AdminLinkType linkType;
  String linkTarget;
  String priority;
  bool active;
  DateTime? startsAt;
  DateTime? endsAt;

  BannerForm({
    this.title = '',
    this.subtitle = '',
    this.badge = '',
    this.accentColorHex = '',
    this.linkType = AdminLinkType.none,
    this.linkTarget = '',
    this.priority = '0',
    this.active = true,
    this.startsAt,
    this.endsAt,
  });

  factory BannerForm.from(AdminBanner b) => BannerForm(
    title: b.title,
    subtitle: b.subtitle ?? '',
    badge: b.badge ?? '',
    accentColorHex: b.accentColorHex ?? '',
    linkType: b.linkType,
    linkTarget: b.linkTarget ?? '',
    priority: '${b.priority}',
    active: b.active,
    startsAt: b.startsAt,
    endsAt: b.endsAt,
  );

  static final _hex = RegExp(r'^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$');

  /// 박스 ID 목록을 주면 GACHA/ODDS 대상이 실제 박스인지도 본다.
  Map<String, String> validate({Set<int>? boxIds}) {
    final errors = <String, String>{};
    final t = title.trim();
    if (t.isEmpty) errors['title'] = '제목을 입력해 주세요';
    if (t.length > 100) errors['title'] = '제목은 100자까지예요';
    if (subtitle.trim().length > 200) errors['subtitle'] = '부제는 200자까지예요';
    if (badge.trim().length > 30) errors['badge'] = '배지는 30자까지예요';

    final hex = accentColorHex.trim();
    if (hex.isNotEmpty && !_hex.hasMatch(hex)) {
      errors['accentColorHex'] = '#RRGGBB 또는 #RRGGBBAA 형식으로 넣어 주세요';
    }

    final target = linkTarget.trim();
    switch (linkType) {
      case AdminLinkType.gacha:
        errors.addAll(_boxTarget(target, boxIds, required: true));
      case AdminLinkType.odds:
        if (target.isNotEmpty) errors.addAll(_boxTarget(target, boxIds));
      case AdminLinkType.url:
        if (!target.startsWith('https://')) {
          errors['linkTarget'] = 'https://로 시작하는 주소를 넣어 주세요';
        } else if (target.length > 500) {
          errors['linkTarget'] = '주소는 500자까지예요';
        }
      case AdminLinkType.none:
      case AdminLinkType.attendance:
      case AdminLinkType.topup:
        break;
    }

    if (int.tryParse(priority.trim()) == null) {
      errors['priority'] = '정수로 넣어 주세요(작을수록 앞)';
    }
    final s = startsAt;
    final e = endsAt;
    if (s != null && e != null && !e.isAfter(s)) {
      errors['endsAt'] = '종료 시각은 시작 시각보다 뒤여야 해요';
    }
    return errors;
  }

  Map<String, String> _boxTarget(
    String target,
    Set<int>? boxIds, {
    bool required = false,
  }) {
    if (target.isEmpty) {
      return required ? {'linkTarget': '연결할 박스를 골라 주세요'} : const {};
    }
    final id = int.tryParse(target);
    if (id == null || !RegExp(r'^\d+$').hasMatch(target)) {
      return {'linkTarget': '박스 번호(숫자)를 넣어 주세요'};
    }
    if (boxIds != null && !boxIds.contains(id)) {
      return {'linkTarget': '없는 박스예요'};
    }
    return const {};
  }

  /// 서버로 보낼 본문. 비운 선택 항목은 null로 보내 지운다.
  Map<String, dynamic> toJson() {
    String? orNull(String v) => v.trim().isEmpty ? null : v.trim();
    return {
      'title': title.trim(),
      'subtitle': orNull(subtitle),
      'badge': orNull(badge),
      'accentColorHex': orNull(accentColorHex)?.toUpperCase(),
      'linkType': linkType.code,
      'linkTarget': linkType.takesTarget ? orNull(linkTarget) : null,
      'priority': int.parse(priority.trim()),
      'active': active,
      'startsAt': startsAt?.toUtc().toIso8601String(),
      'endsAt': endsAt?.toUtc().toIso8601String(),
    };
  }
}

/// "#2FE0A2" / "#2FE0A2CC" → ARGB 정수. 형식이 아니면 null.
int? parseHexArgb(String hex) {
  final h = hex.trim();
  if (!RegExp(r'^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$').hasMatch(h)) return null;
  final rgb = int.parse(h.substring(1, 7), radix: 16);
  final alpha = h.length == 9 ? int.parse(h.substring(7, 9), radix: 16) : 0xFF;
  return (alpha << 24) | rgb;
}
