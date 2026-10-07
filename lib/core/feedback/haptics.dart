import 'dart:async';
import 'package:flutter/services.dart';
import '../domain/rarity.dart';

enum HapticKind { selection, light, medium, heavy }

/// 진동 패턴: (앞 진동부터의 지연 ms, 세기) 목록.
class HapticPattern {
  final List<(int, HapticKind)> steps;
  const HapticPattern(this.steps);

  int get durationMs => steps.fold(0, (s, e) => s + e.$1);

  /// 승급 한 단계(실제 등급까지만 호출된다). 높을수록 무겁고 길다.
  static HapticPattern ascend(Rarity to) => switch (to) {
    Rarity.n => const HapticPattern([(0, HapticKind.selection)]),
    Rarity.r => const HapticPattern([
      (0, HapticKind.light),
      (70, HapticKind.light),
    ]),
    Rarity.sr => const HapticPattern([
      (0, HapticKind.medium),
      (80, HapticKind.light),
      (80, HapticKind.medium),
    ]),
    Rarity.ssr => const HapticPattern([
      (0, HapticKind.heavy),
      (70, HapticKind.medium),
      (70, HapticKind.heavy),
    ]),
  };

  /// SR/SSR 클라이맥스(섬광·충격파 순간). 짧은 연타 후 긴 여운.
  static HapticPattern climax(Rarity r) => r == Rarity.ssr
      ? const HapticPattern([
          (0, HapticKind.heavy),
          (60, HapticKind.heavy),
          (60, HapticKind.heavy),
          (140, HapticKind.medium),
          (180, HapticKind.light),
          (220, HapticKind.light),
        ])
      : const HapticPattern([
          (0, HapticKind.heavy),
          (70, HapticKind.medium),
          (160, HapticKind.light),
        ]);

  /// 카드가 뒤집히는 순간 / 등급 도장이 찍히는 순간.
  static HapticPattern reveal(Rarity r) => switch (r) {
    Rarity.n => const HapticPattern([(0, HapticKind.selection)]),
    Rarity.r => const HapticPattern([(0, HapticKind.light)]),
    Rarity.sr => const HapticPattern([(0, HapticKind.medium)]),
    Rarity.ssr => const HapticPattern([
      (0, HapticKind.heavy),
      (90, HapticKind.medium),
    ]),
  };

  /// 차지가 시작될 때.
  static const HapticPattern charge = HapticPattern([(0, HapticKind.light)]);
}

/// 패턴 재생기. 화면을 떠나거나 건너뛰면 [cancelAll]로 남은 진동을 끊는다.
class Haptics {
  final List<Timer> _timers = [];

  void play(HapticPattern pattern) {
    var at = 0;
    for (final (delay, kind) in pattern.steps) {
      at += delay;
      if (at == 0) {
        _fire(kind);
      } else {
        _timers.add(Timer(Duration(milliseconds: at), () => _fire(kind)));
      }
    }
  }

  void cancelAll() {
    for (final t in _timers) {
      t.cancel();
    }
    _timers.clear();
  }

  static void _fire(HapticKind kind) {
    switch (kind) {
      case HapticKind.selection:
        HapticFeedback.selectionClick();
      case HapticKind.light:
        HapticFeedback.lightImpact();
      case HapticKind.medium:
        HapticFeedback.mediumImpact();
      case HapticKind.heavy:
        HapticFeedback.heavyImpact();
    }
  }
}
