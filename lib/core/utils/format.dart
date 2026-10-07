/// 숫자·금액·확률 표시 포맷. 화면마다 직접 포맷하지 않고 이 함수만 쓴다.
///
/// - 금액: 천 단위 콤마 + 단위 접미사를 한 칸 띄워 붙인다("12,500 GP").
///   원화는 붙여 쓴다("20,000원").
/// - 확률: 백엔드가 소수점 넷째 자리까지 주는 퍼센트 값을 그대로 보여주되
///   의미 없는 0은 뗀다("0.6867%", "60%").
library;

String formatNumber(num value) {
  final negative = value < 0;
  final digits = value.abs().round().toString();
  final buffer = StringBuffer();
  for (var i = 0; i < digits.length; i++) {
    final fromEnd = digits.length - i;
    buffer.write(digits[i]);
    if (fromEnd > 1 && fromEnd % 3 == 1) buffer.write(',');
  }
  return negative ? '-$buffer' : buffer.toString();
}

/// "12,500 GP"
String formatGp(num value) => '${formatNumber(value)} GP';

/// "+1,000 GP" / "-500 GP"
String formatSignedGp(num value) =>
    '${value > 0
        ? '+'
        : value < 0
        ? '-'
        : ''}${formatNumber(value.abs())} GP';

/// "20,000원"
String formatWon(num value) => '${formatNumber(value)}원';

/// 좁은 자리용 원화 축약: "2,000원", "36.9만원", "1,600만원", "1.2억원".
String formatWonShort(num value) {
  final v = value.abs();
  final sign = value < 0 ? '-' : '';
  String trim(double x) {
    var t = x.toStringAsFixed(1);
    if (t.endsWith('.0')) t = t.substring(0, t.length - 2);
    final parts = t.split('.');
    final head = formatNumber(int.parse(parts[0]));
    return parts.length > 1 ? '$head.${parts[1]}' : head;
  }

  if (v >= 100000000) return '$sign${trim(v / 100000000)}억원';
  if (v >= 10000) {
    final man = v / 10000;
    return '$sign${man >= 100 ? formatNumber(man.floor()) : trim(man)}만원';
  }
  return '$sign${formatNumber(v)}원';
}

/// 백엔드 퍼센트 값(0.6867 = 0.6867%)을 소수점 최대 [maxDecimals]자리로.
String formatPercent(num percent, {int maxDecimals = 4}) {
  var text = percent.toDouble().toStringAsFixed(maxDecimals);
  if (text.contains('.')) {
    text = text.replaceFirst(RegExp(r'0+$'), '');
    text = text.replaceFirst(RegExp(r'\.$'), '');
  }
  return '$text%';
}

/// 고정 소수점 퍼센트("2.00%"). 표의 열 정렬이 중요할 때.
String formatPercentFixed(num percent, {int decimals = 2}) =>
    '${percent.toDouble().toStringAsFixed(decimals)}%';

/// "10.07" 같은 월.일 표기.
String formatMonthDay(DateTime date) {
  final local = date.toLocal();
  return '${local.month.toString().padLeft(2, '0')}.'
      '${local.day.toString().padLeft(2, '0')}';
}

/// "10.07 14:03" (올해) / "2025.10.07 14:03" (다른 해)
String formatDateTime(DateTime date, {DateTime? now}) {
  final d = date.toLocal();
  final current = (now ?? DateTime.now()).toLocal();
  String two(int v) => v.toString().padLeft(2, '0');
  final day = '${two(d.month)}.${two(d.day)} ${two(d.hour)}:${two(d.minute)}';
  return d.year == current.year ? day : '${d.year}.$day';
}

/// 한국어 문단이 단어 중간에서 줄바꿈되지 않게 한다(CSS `word-break: keep-all`).
///
/// 단어 안의 글자 사이에 WORD JOINER(U+2060)를 넣어, 공백에서만 줄이 바뀌게 한다.
String keepAll(String text) {
  final runes = text.runes.toList();
  final buffer = StringBuffer();
  for (var i = 0; i < runes.length; i++) {
    buffer.writeCharCode(runes[i]);
    if (i + 1 < runes.length &&
        !_isSpace(runes[i]) &&
        !_isSpace(runes[i + 1])) {
      buffer.writeCharCode(0x2060);
    }
  }
  return buffer.toString();
}

bool _isSpace(int rune) =>
    rune == 0x20 || rune == 0x0A || rune == 0x09 || rune == 0xA0;

/// 방어적 JSON 파싱 헬퍼. 구버전 백엔드에서 필드가 없거나 타입이 달라도
/// 앱이 죽지 않도록 null/기본값으로 떨어뜨린다.
int asInt(Object? value, [int fallback = 0]) {
  if (value is num) return value.toInt();
  if (value is String) {
    return int.tryParse(value) ?? num.tryParse(value)?.toInt() ?? fallback;
  }
  return fallback;
}

int? asIntOrNull(Object? value) {
  if (value is num) return value.toInt();
  if (value is String) {
    return int.tryParse(value) ?? num.tryParse(value)?.toInt();
  }
  return null;
}

double asDouble(Object? value, [double fallback = 0]) {
  if (value is num) return value.toDouble();
  if (value is String) return double.tryParse(value) ?? fallback;
  return fallback;
}

double? asDoubleOrNull(Object? value) {
  if (value is num) return value.toDouble();
  if (value is String) return double.tryParse(value);
  return null;
}

String? asStringOrNull(Object? value) {
  if (value == null) return null;
  final text = value.toString();
  return text.isEmpty ? null : text;
}

bool asBool(Object? value, [bool fallback = false]) {
  if (value is bool) return value;
  if (value is num) return value != 0;
  if (value is String) return value == 'true';
  return fallback;
}

Map<String, dynamic> asMap(Object? value) =>
    value is Map<String, dynamic> ? value : const <String, dynamic>{};

List<Map<String, dynamic>> asMapList(Object? value) => value is List
    ? value.whereType<Map<String, dynamic>>().toList()
    : const <Map<String, dynamic>>[];

DateTime? asDateOrNull(Object? value) =>
    value is String ? DateTime.tryParse(value) : null;
