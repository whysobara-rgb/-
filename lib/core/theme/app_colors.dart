import 'package:flutter/material.dart';

/// 가치가차 컬러 토큰 — 3차 방향 "캡슐 레드(Capsule Red)".
///
/// ## 방향
/// 흰 캔버스 위에 잉크처럼 또렷한 글자, 그리고 단 하나의 확신 있는 색.
/// 화면의 화려함은 UI 크롬이 아니라 **그림(배너 포스터·박스 패키지·상품
/// 카드)과 레어도**에서 나온다. 크롬은 흰색·잉크·브랜드 레드 세 가지뿐.
///
/// ## 시그니처 색: 캡슐 레드 [brand] `#E32D1A`
/// - 실물 경품 뽑기라는 장르가 원래 가진 색이다. 캡슐 토이 머신의 빨강,
///   경품 추첨권(쿠지)의 빨강, 그리고 진품을 보증하는 도장 인주(印朱)의
///   주홍. 가치가차의 약속(확률 공개·실물 보장)을 '도장 찍는' 색으로 쓴다.
/// - 레어도 팔레트(N 회색·R 파랑·SR 보라·SSR 금)와 색상환에서 모두 멀다.
///   그래서 CTA 버튼이 등급처럼 읽히지 않고, 등급 색이 버튼처럼 보이지 않는다.
/// - 흰 바탕 위 글자로 4.5:1, 흰 글자를 얹어도 4.5:1(WCAG AA)이 되도록
///   명도를 맞췄다. 코랄(분홍기)도, 보라로 넘어가는 그라데이션도 아닌
///   순수한 주홍 계열이다.
/// - 쓰는 곳: 주요 CTA, 활성 탭, 워드마크 점, 가격 강조 한두 군데. 넓은 면을
///   칠하지 않는다(배너 포스터와 박스 패키지는 박스 고유 색을 쓴다).
///
/// ## 표면
/// 캔버스는 흰색. 리듬은 옅은 회색 섹션 띠([section])와 그림자로 만든다.
/// [surface]는 "캔버스와 한 단 다른 채움 면"(시트 안 정보 묶음, 입력창,
/// 아이콘 원)이고, 떠 있는 카드·시트는 [raised](흰색) + `Shadows`를 쓴다.
///
/// ## 레어도
/// N 스틸 · R 블루 · SR 퍼플 · SSR 골드. 각 등급은 base(테두리·막대),
/// light(포일 하이라이트·옅은 바탕), deep(포일 그림자), ink(흰 바탕 위
/// 글자) 네 단계를 가진다. 포일·홀로 효과는 SR/SSR에만 쓴다.
///
/// ## 호환
/// 2차(나이트 볼트)와 1차(페이퍼)의 토큰 이름은 모두 남겨 두고 값만 밝은
/// 테마에 맞게 바꿨다. 다른 화면이 쓰는 이름(canvas, surface, text, brand…)의
/// 의미는 그대로다.
class AppColors {
  AppColors._();

  // ── Signature ───────────────────────────────────────────
  /// 캡슐 레드. CTA·활성 상태·브랜드 점.
  static const Color brand = Color(0xFFE32D1A);

  /// 눌림 상태.
  static const Color brandPressed = Color(0xFFC42412);

  /// 큰 CTA 그라데이션의 아래쪽, 패키지 그림자 쪽.
  static const Color brandDeep = Color(0xFFA81B0D);

  /// 큰 CTA 그라데이션의 위쪽 하이라이트.
  static const Color brandBright = Color(0xFFFF4F33);

  /// 레드 위 글씨.
  static const Color onBrand = Color(0xFFFFFFFF);

  /// 선택 행·오늘 출석 칸 같은 아주 옅은 레드(투명도 8%).
  static const Color brandTint = Color(0x14E32D1A);

  /// 불투명한 옅은 레드 바탕(마감 임박 띠 등).
  static const Color brandSoft = Color(0xFFFFF2EF);

  // ── Canvas & surfaces ───────────────────────────────────
  /// 앱 바탕. 흰색.
  static const Color canvas = Color(0xFFFFFFFF);

  /// 캔버스와 한 단 다른 채움 면: 시트 안 정보 묶음, 입력창, 아이콘 원.
  static const Color surface = Color(0xFFF4F5F7);

  /// 떠 있는 면(카드·시트·다이얼로그). 흰색 + 그림자.
  static const Color raised = Color(0xFFFFFFFF);

  /// 진행 막대 트랙, 눌림, 비활성 채움.
  static const Color high = Color(0xFFE8EAEE);

  /// 1px 헤어라인.
  static const Color hairline = Color(0xFFEBEDF0);

  /// 입력창 테두리·선택 테두리.
  static const Color hairlineStrong = Color(0xFFD6D9DF);

  /// 섹션 리듬용 옅은 회색 띠 바탕.
  static const Color section = Color(0xFFF6F7F9);

  /// 상품 사진을 올리는 아주 옅은 바탕(커머스 상품 사진 배경).
  static const Color well = Color(0xFFF5F6F8);

  // ── Ink ─────────────────────────────────────────────────
  /// 본문 잉크. 순흑이 아니라 아주 살짝 푸른 먹색.
  static const Color text = Color(0xFF111216);

  /// 보조 텍스트(흰 바탕 6:1).
  static const Color textSecondary = Color(0xFF5D6370);

  /// 메타 정보만(흰 바탕 3.2:1). 문장에는 쓰지 않는다.
  static const Color textTertiary = Color(0xFF8C919C);
  static const Color textDisabled = Color(0xFFB9BDC5);

  // ── Semantic ────────────────────────────────────────────
  /// 오류·품절. 브랜드(주홍)보다 붉은 크림슨이라 나란히 있어도 구분된다.
  static const Color danger = Color(0xFFC8102E);

  /// 완료·출석 완료 등 긍정 상태.
  static const Color success = Color(0xFF0E8A5F);

  // ── Rarity: base / light / deep / ink ───────────────────
  static const Color rarityN = Color(0xFF9BA3AF);
  static const Color rarityNLight = Color(0xFFEEF0F3);
  static const Color rarityNDeep = Color(0xFF5E6672);
  static const Color rarityNInk = Color(0xFF5E6672);

  static const Color rarityR = Color(0xFF2E7BFF);
  static const Color rarityRLight = Color(0xFFDDE9FF);
  static const Color rarityRDeep = Color(0xFF1652D9);
  static const Color rarityRInk = Color(0xFF1A5FE0);

  static const Color raritySR = Color(0xFF9442FF);
  static const Color raritySRLight = Color(0xFFEFE4FF);
  static const Color raritySRDeep = Color(0xFF5F1FD1);
  static const Color raritySRInk = Color(0xFF7A2EEA);

  static const Color raritySSR = Color(0xFFF2B01E);
  static const Color raritySSRLight = Color(0xFFFFF2C4);
  static const Color raritySSRDeep = Color(0xFFB47A00);
  static const Color raritySSRInk = Color(0xFF9A6500);

  /// SSR 홀로 포일의 무지개 결. 금 바탕 위에 낮은 불투명도로만 얹는다
  /// (큰 면을 그대로 칠하지 않는다).
  static const List<Color> holoSpectrum = [
    Color(0xFFFFF4D2),
    Color(0xFF9BF2FF),
    Color(0xFFC9B4FF),
    Color(0xFFFFB8E6),
    Color(0xFFFFE59A),
  ];

  // ── Reveal stage ────────────────────────────────────────
  /// 뽑기 연출 무대의 기본(N) 색면 가장자리. 검정이 아니라 깊은 남색.
  /// 등급별 색면은 `RarityStyle.field`가 정한다.
  static const Color stage = Color(0xFF0E1838);

  // ── Deprecated aliases (1차 페이퍼 이름) ────────────────
  // 3차부터 앱 전체가 한 벌의 밝은 테마라 아래 이름은 위 토큰의 별칭이다.
  // 새 코드에서는 위 이름을 쓴다.

  /// Deprecated: [canvas]와 같다.
  static const Color bg = canvas;

  /// Deprecated: [surface]와 같다.
  static const Color bgSubtle = surface;

  /// Deprecated: [hairline]과 같다.
  static const Color line = hairline;

  /// Deprecated: [text]와 같다.
  static const Color ink = text;

  /// Deprecated: [textSecondary]와 같다.
  static const Color inkSecondary = textSecondary;

  /// Deprecated: [textTertiary]와 같다.
  static const Color inkTertiary = textTertiary;

  /// 잉크(먹색) 면 위 글씨.
  static const Color onInk = Color(0xFFFFFFFF);

  /// Deprecated: [brand]와 같다.
  static const Color accent = brand;
}
