import 'package:flutter_test/flutter_test.dart';
import 'package:gacha_vault/core/utils/format.dart';

void main() {
  test('천 단위 콤마와 단위', () {
    expect(formatNumber(0), '0');
    expect(formatNumber(999), '999');
    expect(formatNumber(1000), '1,000');
    expect(formatNumber(1234567), '1,234,567');
    expect(formatNumber(-5000), '-5,000');
    expect(formatGp(207728), '207,728 GP');
    expect(formatWon(20000), '20,000원');
    expect(formatSignedGp(500), '+500 GP');
    expect(formatSignedGp(-3000), '-3,000 GP');
  });

  test('확률은 서버 정밀도(소수 넷째 자리)까지, 꼬리 0은 뗀다', () {
    expect(formatPercent(0.5265), '0.5265%');
    expect(formatPercent(21.058), '21.058%');
    expect(formatPercent(80), '80%');
    expect(formatPercent(75.25680), '75.2568%');
    expect(formatPercent(88.0, maxDecimals: 1), '88%');
    expect(formatPercentFixed(2), '2.00%');
  });

  test('방어적 파싱 헬퍼', () {
    expect(asInt('12'), 12);
    expect(asInt(null, 7), 7);
    expect(asIntOrNull('x'), isNull);
    expect(asDouble(3), 3.0);
    expect(asBool(1), isTrue);
    expect(
      asMapList([
        {'a': 1},
        'x',
        null,
      ]).length,
      1,
    );
  });

  test('keepAll은 공백에서만 줄이 바뀌게 단어 안에 WORD JOINER를 넣는다', () {
    expect(keepAll('배송 신청'), '배\u2060송 신\u2060청');
    expect(keepAll('a b').contains('\u2060'), isFalse);
    expect(keepAll('배송 신청').replaceAll('\u2060', ''), '배송 신청');
  });

  test('formatWonShort는 좁은 칸에 맞게 만/억 단위로 줄인다', () {
    expect(formatWonShort(2000), '2,000원');
    expect(formatWonShort(10000), '1만원');
    expect(formatWonShort(369000), '36.9만원');
    expect(formatWonShort(1700000), '170만원');
    expect(formatWonShort(16000000), '1,600만원');
    expect(formatWonShort(150000000), '1.5억원');
  });
}
