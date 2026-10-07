import 'package:flutter/material.dart';
import 'app_colors.dart';

/// 가치가차 타입 스케일 (Pretendard).
///
/// 2차: 히어로·큰 숫자에 쓰는 굵은 디스플레이 단계([hero], [numeral])를
/// 더했다. 한글 헤드라인은 자간을 좁히고(-0.4 ~ -1.4), 가격·수량처럼
/// 정렬이 필요한 숫자는 [AppText.num]으로 tabular figures를 켠다.
///
/// 색: 본문 계열(hero~bodyStrong)은 색을 지정하지 않아 테마(볼트=오프화이트,
/// 페이퍼=먹색)를 따른다. 보조 계열(callout/caption/micro)은 두 테마에서
/// 모두 읽히는 [AppColors.textSecondary]를 쓴다.
class AppText {
  AppText._();

  static const String family = 'Pretendard';

  static const List<FontFeature> tabular = [FontFeature.tabularFigures()];

  /// 34 / 900 — 배너 헤드라인, 결과 화면 상품명 등 화면당 한 번.
  static const TextStyle hero = TextStyle(
    fontFamily: family,
    fontSize: 34,
    height: 1.12,
    fontWeight: FontWeight.w900,
    letterSpacing: -1.4,
  );

  /// 40 / 900 tabular — 잔액·확정까지 남은 횟수 같은 큰 숫자.
  static const TextStyle numeral = TextStyle(
    fontFamily: family,
    fontSize: 40,
    height: 1.0,
    fontWeight: FontWeight.w900,
    letterSpacing: -1.2,
    fontFeatures: tabular,
  );

  /// 28 / 800 — 페이지 대표 수치·요약.
  static const TextStyle display = TextStyle(
    fontFamily: family,
    fontSize: 28,
    height: 1.22,
    fontWeight: FontWeight.w800,
    letterSpacing: -0.8,
  );

  /// 22 / 800 — 페이지 타이틀, 상세 상품명.
  static const TextStyle title1 = TextStyle(
    fontFamily: family,
    fontSize: 22,
    height: 1.28,
    fontWeight: FontWeight.w800,
    letterSpacing: -0.6,
  );

  /// 18 / 800 — 섹션 타이틀, 앱바 타이틀.
  static const TextStyle title2 = TextStyle(
    fontFamily: family,
    fontSize: 18,
    height: 1.33,
    fontWeight: FontWeight.w800,
    letterSpacing: -0.45,
  );

  /// 16 / 700 — 카드 타이틀, 버튼.
  static const TextStyle headline = TextStyle(
    fontFamily: family,
    fontSize: 16,
    height: 1.38,
    fontWeight: FontWeight.w700,
    letterSpacing: -0.3,
  );

  /// 14 / 400 — 기본 본문.
  static const TextStyle body = TextStyle(
    fontFamily: family,
    fontSize: 14,
    height: 1.5,
    fontWeight: FontWeight.w400,
    letterSpacing: -0.1,
  );

  /// 14 / 600 — 리스트 항목명, 강조 본문.
  static const TextStyle bodyStrong = TextStyle(
    fontFamily: family,
    fontSize: 14,
    height: 1.45,
    fontWeight: FontWeight.w600,
    letterSpacing: -0.2,
  );

  /// 13 / 500 — 보조 설명.
  static const TextStyle callout = TextStyle(
    fontFamily: family,
    fontSize: 13,
    height: 1.45,
    fontWeight: FontWeight.w500,
    letterSpacing: -0.1,
    color: AppColors.textSecondary,
  );

  /// 12 / 500 — 메타 정보, 캡션.
  static const TextStyle caption = TextStyle(
    fontFamily: family,
    fontSize: 12,
    height: 1.4,
    fontWeight: FontWeight.w500,
    letterSpacing: 0,
    color: AppColors.textSecondary,
  );

  /// 11 / 600 — 배지, 탭 라벨, 아주 작은 라벨.
  static const TextStyle micro = TextStyle(
    fontFamily: family,
    fontSize: 11,
    height: 1.3,
    fontWeight: FontWeight.w600,
    letterSpacing: 0,
    color: AppColors.textSecondary,
  );

  /// 10.5 / 800, 넓은 자간 — 섹션 위 영문 아이브로("ENDING SOON").
  /// 한 화면에 두세 번까지만.
  static const TextStyle eyebrow = TextStyle(
    fontFamily: family,
    fontSize: 10.5,
    height: 1.2,
    fontWeight: FontWeight.w800,
    letterSpacing: 1.6,
    color: AppColors.textTertiary,
  );

  /// 숫자용: 주어진 스타일에 tabular figures를 켠다.
  static TextStyle num(TextStyle base) =>
      base.copyWith(fontFeatures: tabular, letterSpacing: -0.2);
}
