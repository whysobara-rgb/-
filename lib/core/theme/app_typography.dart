import 'package:flutter/material.dart';
import 'app_colors.dart';

/// 가치가차 타입 스케일 (Pretendard).
///
/// 28 / 22 / 18 / 16 / 14 / 13 / 12 / 11. 한글 헤드라인은 자간을 살짝
/// 좁히고(-0.3 ~ -0.5), 본문은 기본 자간에 가깝게 둔다. 가격·수량처럼
/// 숫자가 정렬돼야 하는 곳은 [AppText.num]으로 tabular figures를 켠다.
class AppText {
  AppText._();

  static const String family = 'Pretendard';

  static const List<FontFeature> tabular = [FontFeature.tabularFigures()];

  /// 28 / 800 — 잔액, 결과 요약 등 화면당 한 번.
  static const TextStyle display = TextStyle(
    fontFamily: family,
    fontSize: 28,
    height: 1.25,
    fontWeight: FontWeight.w800,
    letterSpacing: -0.5,
    color: AppColors.ink,
  );

  /// 22 / 700 — 페이지 타이틀, 상품명(상세).
  static const TextStyle title1 = TextStyle(
    fontFamily: family,
    fontSize: 22,
    height: 1.3,
    fontWeight: FontWeight.w700,
    letterSpacing: -0.45,
    color: AppColors.ink,
  );

  /// 18 / 700 — 섹션 타이틀, 앱바 타이틀.
  static const TextStyle title2 = TextStyle(
    fontFamily: family,
    fontSize: 18,
    height: 1.35,
    fontWeight: FontWeight.w700,
    letterSpacing: -0.35,
    color: AppColors.ink,
  );

  /// 16 / 600 — 카드 타이틀, 버튼.
  static const TextStyle headline = TextStyle(
    fontFamily: family,
    fontSize: 16,
    height: 1.4,
    fontWeight: FontWeight.w600,
    letterSpacing: -0.3,
    color: AppColors.ink,
  );

  /// 14 / 400 — 기본 본문.
  static const TextStyle body = TextStyle(
    fontFamily: family,
    fontSize: 14,
    height: 1.5,
    fontWeight: FontWeight.w400,
    letterSpacing: -0.1,
    color: AppColors.ink,
  );

  /// 14 / 600 — 리스트 항목명, 강조 본문.
  static const TextStyle bodyStrong = TextStyle(
    fontFamily: family,
    fontSize: 14,
    height: 1.45,
    fontWeight: FontWeight.w600,
    letterSpacing: -0.2,
    color: AppColors.ink,
  );

  /// 13 / 500 — 보조 설명.
  static const TextStyle callout = TextStyle(
    fontFamily: family,
    fontSize: 13,
    height: 1.45,
    fontWeight: FontWeight.w500,
    letterSpacing: -0.1,
    color: AppColors.inkSecondary,
  );

  /// 12 / 500 — 메타 정보, 캡션.
  static const TextStyle caption = TextStyle(
    fontFamily: family,
    fontSize: 12,
    height: 1.4,
    fontWeight: FontWeight.w500,
    letterSpacing: 0,
    color: AppColors.inkSecondary,
  );

  /// 11 / 600 — 배지, 탭 라벨, 아주 작은 라벨.
  static const TextStyle micro = TextStyle(
    fontFamily: family,
    fontSize: 11,
    height: 1.3,
    fontWeight: FontWeight.w600,
    letterSpacing: 0,
    color: AppColors.inkSecondary,
  );

  /// 숫자용: 주어진 스타일에 tabular figures를 켠다.
  static TextStyle num(TextStyle base) =>
      base.copyWith(fontFeatures: tabular, letterSpacing: -0.2);
}
