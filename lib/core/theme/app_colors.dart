import 'package:flutter/material.dart';

/// 가치가차 컬러 토큰 — 2차 방향 "나이트 볼트(Night Vault)".
///
/// ## 방향
/// 실물 명품·전자기기를 모아 두는 **수집가의 금고**. 셸은 거의 검정에 가까운
/// 먹색 표면을 3단으로 쌓아 깊이를 만들고(그림자 대신 밝기 차이와 1px 헤어라인),
/// 텍스트는 따뜻한 오프화이트로 또렷하게 둔다. 화려함은 두 군데에서만 나온다.
///
/// 1. **레어도가 주인공 팔레트.** N 스틸 · R 코발트 · SR 자수정 · SSR 금.
///    SR은 금속성 그라데이션, SSR은 금박 + 움직이는 홀로 포일까지 허용한다.
///    레어도 색은 레어도를 뜻할 때만 쓴다(장식용 금지).
/// 2. **브랜드 액센트 하나: 볼트 제이드([brand]).** CTA·활성 탭·주요 수치에만.
///    1차의 딥 그린(#0B6E4F)을 어두운 바탕에서 읽히게 밝힌 같은 계열이다.
///    회색·파랑·보라·금 어느 레어도와도 색상환에서 멀리 떨어져 있어,
///    "버튼"과 "등급"이 헷갈리지 않는다. 제이드 버튼 위 글씨는 먹색.
///
/// 그라데이션은 배너·레어도 효과에서만 쓰고, 흔한 코랄→보라→하늘색 조합은
/// 쓰지 않는다. 배경 장식은 지폐·시계 다이얼의 기요셰(guilloché) 각인처럼
/// 실제 '금고·귀중품'에서 온 모티프만 쓴다.
///
/// ## 페이퍼(로그인) 섬
/// 로그인·가입 화면(`lib/features/auth/`)은 이번 범위 밖이라 1차의 밝은
/// 페이퍼 테마를 그대로 쓴다. 아래 "Paper" 블록의 이름(bg, ink, line…)은
/// 그 화면들이 직접 참조하므로 값과 의미를 유지한다. **볼트 셸 코드에서는
/// Paper 토큰을 쓰지 않는다.** 테마는 로그인 상태에 따라 바뀐다(main.dart).
class AppColors {
  AppColors._();

  // ── Vault surfaces (어두운 순 → 밝은 순) ─────────────────────
  /// 앱 바탕. 순흑이 아니라 아주 살짝 푸른 먹색.
  static const Color canvas = Color(0xFF09090B);

  /// 카드·리스트 블록.
  static const Color surface = Color(0xFF121215);

  /// 시트·입력창·칩처럼 한 단 떠 있는 면.
  static const Color raised = Color(0xFF1A1A1F);

  /// 눌림, 진행 막대 트랙, 플레이스홀더 안쪽.
  static const Color high = Color(0xFF24242B);

  /// 1px 헤어라인.
  static const Color hairline = Color(0xFF26262D);

  /// 포커스·선택 테두리.
  static const Color hairlineStrong = Color(0xFF3B3B45);

  // ── Vault text ──────────────────────────────────────────
  static const Color text = Color(0xFFF5F4F0);

  /// 보조 텍스트. 페이퍼(흰 바탕)에서도 읽히는 중간 회색이라
  /// [AppText]의 보조 스타일(callout/caption/micro)이 두 섬에서 함께 쓴다.
  static const Color textSecondary = Color(0xFF94949C);
  static const Color textTertiary = Color(0xFF6A6A74);
  static const Color textDisabled = Color(0xFF47474F);

  // ── Brand accent ────────────────────────────────────────
  static const Color brand = Color(0xFF2FE0A2);
  static const Color brandPressed = Color(0xFF22B984);

  /// 제이드 버튼·배지 위 글씨.
  static const Color onBrand = Color(0xFF04140D);

  /// 선택 행, 오늘 출석 칸 등 아주 옅은 제이드 틴트.
  static const Color brandTint = Color(0x1A2FE0A2);

  // ── Semantic ────────────────────────────────────────────
  static const Color danger = Color(0xFFFF6157);

  // ── Rarity: base / light / deep ─────────────────────────
  static const Color rarityN = Color(0xFFA3A9B4);
  static const Color rarityNLight = Color(0xFFDCE0E6);
  static const Color rarityNDeep = Color(0xFF5B616B);

  static const Color rarityR = Color(0xFF4D8DFF);
  static const Color rarityRLight = Color(0xFFA3C3FF);
  static const Color rarityRDeep = Color(0xFF1E4EC2);

  static const Color raritySR = Color(0xFFB073FF);
  static const Color raritySRLight = Color(0xFFDDC4FF);
  static const Color raritySRDeep = Color(0xFF6A2BD4);

  static const Color raritySSR = Color(0xFFF3C24F);
  static const Color raritySSRLight = Color(0xFFFFEBB0);
  static const Color raritySSRDeep = Color(0xFFA6731A);

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
  static const Color stage = Color(0xFF050506);

  // ── Paper (auth island only) ────────────────────────────
  /// 로그인 화면 바탕(흰색).
  static const Color bg = Color(0xFFFFFFFF);
  static const Color bgSubtle = Color(0xFFF5F5F3);
  static const Color line = Color(0xFFEBEBEB);
  static const Color ink = Color(0xFF111111);
  static const Color inkSecondary = Color(0xFF6B6B6B);
  static const Color inkTertiary = Color(0xFFA3A3A3);
  static const Color onInk = Color(0xFFFFFFFF);

  /// 1차 브랜드 그린. 페이퍼 섬의 워드마크 점에만 남아 있다.
  static const Color accent = Color(0xFF0B6E4F);
}
