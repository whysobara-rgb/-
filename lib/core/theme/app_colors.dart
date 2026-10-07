import 'package:flutter/material.dart';

/// 가치가차 컬러 토큰.
///
/// 셸(홈·상세·보관함·충전·MY)은 거의 흰 화면에 잉크색 텍스트와 헤어라인만
/// 쓰고, 색은 두 군데에만 쓴다.
///
/// 1. 브랜드 액센트 [accent] — CTA, 활성 탭, 강조 가격에만.
///    딥 볼트 그린(#0B6E4F)을 고른 이유:
///    - "가치를 보관하는 금고(vault)"라는 이름과 맞고, 돈·신뢰를 연상시키는
///      색이라 확률 공개·충전 한도 같은 신뢰 기능과 결이 같다.
///    - 코랄/바이올렛 일색인 가챠 앱들 사이에서 바로 구분되고, 빨강처럼
///      '세일·긴급'을 연상시키지 않는다(긴박감 연출을 하지 않는 앱이다).
///    - 레어도 색(회색·파랑·보라·금색) 어느 것과도 겹치지 않고,
///      특히 SSR 금색과 나란히 놓였을 때 고급 시계 브랜드처럼 정돈돼 보인다.
/// 2. 레어도 스케일 [rarityN]…[raritySSR] — 오직 레어도 표시에만.
///
/// 셸에는 그라데이션을 쓰지 않는다. 화려함은 뽑기 연출 화면이 전담한다.
class AppColors {
  AppColors._();

  // ── Surface ──────────────────────────────────────────────
  /// 기본 화면 배경.
  static const Color bg = Color(0xFFFFFFFF);

  /// 섹션 구분용 오프화이트(살짝 따뜻한 중성 회색).
  static const Color bgSubtle = Color(0xFFF5F5F3);

  /// 이미지 플레이스홀더·눌림 상태 등 한 단계 더 진한 바탕.
  static const Color bgMuted = Color(0xFFEDEDEB);

  /// 헤어라인 보더/디바이더.
  static const Color line = Color(0xFFEBEBEB);

  /// 입력창 포커스 등 조금 더 진한 선.
  static const Color lineStrong = Color(0xFFD4D4D4);

  // ── Ink (text & icons) ───────────────────────────────────
  static const Color ink = Color(0xFF111111);
  static const Color inkSecondary = Color(0xFF6B6B6B);
  static const Color inkTertiary = Color(0xFFA3A3A3);
  static const Color inkDisabled = Color(0xFFC7C7C7);
  static const Color onInk = Color(0xFFFFFFFF);

  // ── Brand accent (sparingly) ─────────────────────────────
  static const Color accent = Color(0xFF0B6E4F);
  static const Color accentPressed = Color(0xFF085A40);

  /// 액센트 위 아주 옅은 틴트(선택 행, 오늘 출석 칸 등).
  static const Color accentTint = Color(0xFFE7F2ED);

  // ── Semantic ─────────────────────────────────────────────
  /// 오류·차감 금액. 브랜드 액센트와 구분되는 차분한 레드.
  static const Color negative = Color(0xFFD93A2B);

  /// 적립 금액 등 긍정 수치. 별도 색을 늘리지 않고 액센트를 재사용한다.
  static const Color positive = accent;

  // ── Rarity scale (rarity only) ───────────────────────────
  static const Color rarityN = Color(0xFF8A8A8E);
  static const Color rarityR = Color(0xFF2F6FEB);
  static const Color raritySR = Color(0xFF7A3FE0);
  static const Color raritySSR = Color(0xFFB8862B);

  /// SSR 금속 표현용 하이라이트/섀도 톤. SSR 배지와 연출에서만 쓴다.
  static const Color raritySSRLight = Color(0xFFE8C877);
  static const Color raritySSRDeep = Color(0xFF8A6116);

  /// 레어도 배지의 옅은 바탕.
  static const Color rarityNTint = Color(0xFFF1F1F2);
  static const Color rarityRTint = Color(0xFFEAF1FE);
  static const Color raritySRTint = Color(0xFFF2ECFD);
  static const Color raritySSRTint = Color(0xFFF8F1E2);

  // ── Reveal stage (dark) ──────────────────────────────────
  /// 뽑기 연출 화면 전용 배경. 셸과 대비되는 깊은 무채색.
  static const Color stage = Color(0xFF0A0A0B);
  static const Color stageRaised = Color(0xFF17171A);
}
