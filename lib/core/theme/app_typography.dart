import 'package:flutter/material.dart';
import 'app_colors.dart';

/// 가치가차 타입 스케일 (Pretendard).
///
/// 3차: 흰 바탕에서 위계가 숫자와 굵기로 바로 읽히게 했다.
/// - 헤드라인은 800, 큰 숫자·가격은 800 + tabular figures.
///   (900은 화면에서 뭉개져 보여 배너·워드마크 같은 그림 글자에만 쓴다.)
/// - 한글 헤드라인 자간은 크기에 비례해 좁힌다(-0.35 ~ -1.6).
/// - 섹션 제목은 [section](20/800) 하나로 통일한다.
///
/// 색: 본문 계열(hero~bodyStrong)은 색을 지정하지 않아 테마 잉크를 따른다.
/// 보조 계열(callout/caption/micro)은 [AppColors.textSecondary](6:1)로,
/// 회색 위 회색처럼 흐린 글자를 만들지 않는다.
class AppText {
  AppText._();

  static const String family = 'Pretendard';

  static const List<FontFeature> tabular = [FontFeature.tabularFigures()];

  /// 32 / 800 — 배너 헤드라인, 결과 화면 상품명 등 화면당 한 번.
  static const TextStyle hero = TextStyle(
    fontFamily: family,
    fontSize: 32,
    height: 1.18,
    fontWeight: FontWeight.w800,
    letterSpacing: -1.3,
  );

  /// 40 / 800 tabular — 잔액·확정까지 남은 횟수·가격 같은 큰 숫자.
  static const TextStyle numeral = TextStyle(
    fontFamily: family,
    fontSize: 40,
    height: 1.0,
    fontWeight: FontWeight.w800,
    letterSpacing: -1.6,
    fontFeatures: tabular,
  );

  /// 28 / 800 — 페이지 대표 수치·요약.
  static const TextStyle display = TextStyle(
    fontFamily: family,
    fontSize: 28,
    height: 1.22,
    fontWeight: FontWeight.w800,
    letterSpacing: -1.0,
  );

  /// 22 / 800 — 페이지 타이틀, 상세 상품명.
  static const TextStyle title1 = TextStyle(
    fontFamily: family,
    fontSize: 22,
    height: 1.3,
    fontWeight: FontWeight.w800,
    letterSpacing: -0.7,
  );

  /// 20 / 800 — 섹션 제목(홈·상세의 "인기 박스", "구성 상품").
  static const TextStyle section = TextStyle(
    fontFamily: family,
    fontSize: 20,
    height: 1.3,
    fontWeight: FontWeight.w800,
    letterSpacing: -0.7,
  );

  /// 18 / 800 — 앱바 타이틀, 카드 안 큰 제목.
  static const TextStyle title2 = TextStyle(
    fontFamily: family,
    fontSize: 18,
    height: 1.33,
    fontWeight: FontWeight.w800,
    letterSpacing: -0.5,
  );

  /// 16 / 700 — 카드 타이틀, 버튼.
  static const TextStyle headline = TextStyle(
    fontFamily: family,
    fontSize: 16,
    height: 1.38,
    fontWeight: FontWeight.w700,
    letterSpacing: -0.35,
  );

  /// 14 / 400 — 기본 본문.
  static const TextStyle body = TextStyle(
    fontFamily: family,
    fontSize: 14,
    height: 1.5,
    fontWeight: FontWeight.w400,
    letterSpacing: -0.15,
  );

  /// 14 / 600 — 리스트 항목명, 강조 본문.
  static const TextStyle bodyStrong = TextStyle(
    fontFamily: family,
    fontSize: 14,
    height: 1.45,
    fontWeight: FontWeight.w600,
    letterSpacing: -0.25,
  );

  /// 13 / 500 — 보조 설명.
  static const TextStyle callout = TextStyle(
    fontFamily: family,
    fontSize: 13,
    height: 1.45,
    fontWeight: FontWeight.w500,
    letterSpacing: -0.15,
    color: AppColors.textSecondary,
  );

  /// 12 / 500 — 메타 정보, 캡션.
  static const TextStyle caption = TextStyle(
    fontFamily: family,
    fontSize: 12,
    height: 1.4,
    fontWeight: FontWeight.w500,
    letterSpacing: -0.1,
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

  /// 11 / 800, 넓은 자간 — 섹션 위 작은 영문 라벨. 한 화면에 한두 번만.
  static const TextStyle eyebrow = TextStyle(
    fontFamily: family,
    fontSize: 11,
    height: 1.2,
    fontWeight: FontWeight.w800,
    letterSpacing: 1.2,
    color: AppColors.brand,
  );

  /// 18 / 800 tabular — 카드 가격.
  static const TextStyle price = TextStyle(
    fontFamily: family,
    fontSize: 18,
    height: 1.15,
    fontWeight: FontWeight.w800,
    letterSpacing: -0.6,
    fontFeatures: tabular,
  );

  /// 숫자용: 주어진 스타일에 tabular figures를 켠다.
  static TextStyle num(TextStyle base) =>
      base.copyWith(fontFeatures: tabular, letterSpacing: -0.2);
}
