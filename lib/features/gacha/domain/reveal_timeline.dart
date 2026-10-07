import 'dart:math' as math;
import '../../../core/domain/rarity.dart';
import 'draw_result.dart';

/// 뽑기 연출의 순수 로직(타임라인·카드 순서·모두 뒤집기 일정).
///
/// 원칙
/// - 빛은 N → R → SR → SSR 순서로 **실제 최고 등급까지만** 올라가고 멈춘다.
///   더 높은 등급의 빛을 보여줬다가 낮추는 연출(니어미스)은 없다.
/// - 연출 강도(흔들림·파티클·길이)는 실제 결과 등급으로만 정한다.
/// - N만 나온 1회는 빠르게(≈1.5초), SSR은 6~8초.
enum RevealPhase { charge, ascend, tension, climax, emerge, stamp }

class RevealSegment {
  final RevealPhase phase;
  final int startMs;
  final int durationMs;

  /// ascend 구간이 새로 밝히는 등급. 그 외 구간은 null.
  final Rarity? rarity;

  const RevealSegment(this.phase, this.startMs, this.durationMs, [this.rarity]);

  int get endMs => startMs + durationMs;
}

/// 한 시점의 상태.
class RevealMoment {
  final RevealPhase phase;

  /// 구간 안 진행도 0~1.
  final double t;

  /// 빛 색: [from]에서 [to]로 [colorT]만큼.
  final Rarity from;
  final Rarity to;
  final double colorT;

  /// 몇 번째 승급 단계인지(1부터). 승급 전이면 0.
  final int step;

  const RevealMoment({
    required this.phase,
    required this.t,
    required this.from,
    required this.to,
    required this.colorT,
    required this.step,
  });

  /// 지금까지 밝혀진 가장 높은 등급(색 전환이 시작된 등급 포함).
  Rarity get lit => colorT > 0 ? to : from;
}

class RevealTimeline {
  /// 결과를 받기 전에 박스가 나타나는 시간(모든 등급 공통).
  static const int summonMs = 350;

  final Rarity highest;
  final List<RevealSegment> segments;

  /// true면 10+1 마지막 카드용 '포커스' 연출(승급 단계 없이 진짜 색으로 차지).
  final bool focus;

  const RevealTimeline._(this.highest, this.segments, {this.focus = false});

  /// 1회 뽑기.
  factory RevealTimeline.single(Rarity highest) {
    final d = _durations[highest]!;
    final segs = <RevealSegment>[];
    var at = 0;
    void add(RevealPhase p, int ms, [Rarity? r]) {
      if (ms <= 0) return;
      segs.add(RevealSegment(p, at, ms, r));
      at += ms;
    }

    add(RevealPhase.charge, d.charge);
    for (final r in ascensionFor(highest)) {
      add(RevealPhase.ascend, d.ascendEach, r);
    }
    add(RevealPhase.tension, d.tension);
    add(RevealPhase.climax, d.climax);
    add(RevealPhase.emerge, d.emerge);
    add(RevealPhase.stamp, d.stamp);
    return RevealTimeline._(highest, segs);
  }

  /// 10+1에서 가장 좋은 카드(SR 이상)를 화면 가운데로 끌어와 여는 연출.
  /// 카드가 이미 진짜 색으로 빛나고 있으므로 승급 단계를 다시 밟지 않는다.
  factory RevealTimeline.focus(Rarity rarity) {
    final ssr = rarity == Rarity.ssr;
    final segs = <RevealSegment>[];
    var at = 0;
    void add(RevealPhase p, int ms) {
      segs.add(RevealSegment(p, at, ms));
      at += ms;
    }

    add(RevealPhase.charge, ssr ? 900 : 700);
    add(RevealPhase.tension, ssr ? 400 : 300);
    add(RevealPhase.climax, ssr ? 900 : 700);
    add(RevealPhase.emerge, ssr ? 1100 : 800);
    add(RevealPhase.stamp, ssr ? 520 : 420);
    return RevealTimeline._(rarity, segs, focus: true);
  }

  static const Map<Rarity, _Durations> _durations = {
    Rarity.n: _Durations(charge: 520, emerge: 420, stamp: 260),
    Rarity.r: _Durations(charge: 760, ascendEach: 480, emerge: 560, stamp: 320),
    Rarity.sr: _Durations(
      charge: 980,
      ascendEach: 520,
      tension: 320,
      climax: 700,
      emerge: 1000,
      stamp: 460,
    ),
    Rarity.ssr: _Durations(
      charge: 1180,
      ascendEach: 560,
      tension: 460,
      climax: 900,
      emerge: 1380,
      stamp: 560,
    ),
  };

  /// 승급 단계: N 다음부터 실제 최고 등급까지. N이면 빈 목록.
  static List<Rarity> ascensionFor(Rarity highest) => [
    for (final r in Rarity.values)
      if (r.rank > 0 && r.rank <= highest.rank) r,
  ];

  /// 클라이맥스(섬광·충격파·빛줄기·파티클 폭발)가 있는 등급.
  static bool hasClimax(Rarity r) => r.isFoil;

  /// 공개 후 머무는 시간(자동으로 결과 화면에 넘어가기 전).
  static int holdMs(Rarity r) => switch (r) {
    Rarity.n => 900,
    Rarity.r => 1200,
    Rarity.sr => 2000,
    Rarity.ssr => 2400,
  };

  /// 등급별 최대 흔들림(px).
  static double shakeScale(Rarity r) => switch (r) {
    Rarity.n => 0.8,
    Rarity.r => 1.6,
    Rarity.sr => 3.0,
    Rarity.ssr => 4.4,
  };

  /// 등급별 파티클 상한(성능 보호).
  static int sparkCount(Rarity r) => switch (r) {
    Rarity.n => 0,
    Rarity.r => 24,
    Rarity.sr => 64,
    Rarity.ssr => 110,
  };

  int get totalMs => segments.last.endMs;

  /// 박스 등장까지 포함한 길이(1회 연출의 체감 길이).
  int get revealMs => totalMs + (focus ? 0 : summonMs);

  RevealSegment? segment(RevealPhase p) {
    for (final s in segments) {
      if (s.phase == p) return s;
    }
    return null;
  }

  int startOf(RevealPhase p) => segment(p)?.startMs ?? totalMs;

  RevealMoment at(double ms) {
    final clamped = ms.clamp(0, totalMs.toDouble()).toDouble();
    var seg = segments.last;
    for (final s in segments) {
      if (clamped < s.endMs) {
        seg = s;
        break;
      }
    }
    final t = seg.durationMs == 0
        ? 1.0
        : ((clamped - seg.startMs) / seg.durationMs).clamp(0.0, 1.0);

    if (focus) {
      return RevealMoment(
        phase: seg.phase,
        t: t,
        from: highest,
        to: highest,
        colorT: 1,
        step: 0,
      );
    }
    final steps = segments.where((s) => s.phase == RevealPhase.ascend).toList();
    if (seg.phase == RevealPhase.charge) {
      return RevealMoment(
        phase: seg.phase,
        t: t,
        from: Rarity.n,
        to: Rarity.n,
        colorT: 0,
        step: 0,
      );
    }
    if (seg.phase == RevealPhase.ascend) {
      final i = steps.indexOf(seg);
      final from = i == 0 ? Rarity.n : steps[i - 1].rarity!;
      // 색은 단계 앞부분 35% 동안 바뀌고, 남은 시간은 그 색으로 머문다.
      return RevealMoment(
        phase: seg.phase,
        t: t,
        from: from,
        to: seg.rarity!,
        colorT: math.min(1.0, t / 0.35),
        step: i + 1,
      );
    }
    return RevealMoment(
      phase: seg.phase,
      t: t,
      from: highest,
      to: highest,
      colorT: 1,
      step: steps.length,
    );
  }

  /// 연출 중 소리·진동을 낼 시점.
  List<RevealCue> get cues => [
    for (final s in segments)
      RevealCue(s.startMs, s.phase, s.rarity ?? highest),
  ];
}

class RevealCue {
  final int atMs;
  final RevealPhase phase;
  final Rarity rarity;
  const RevealCue(this.atMs, this.phase, this.rarity);
}

class _Durations {
  final int charge;
  final int ascendEach;
  final int tension;
  final int climax;
  final int emerge;
  final int stamp;

  const _Durations({
    required this.charge,
    this.ascendEach = 0,
    this.tension = 0,
    this.climax = 0,
    required this.emerge,
    required this.stamp,
  });
}

/// 10+1 카드 배치와 뒤집기 순서.
class RevealDeck {
  RevealDeck._();

  /// 펼칠 순서: 낮은 등급부터(같은 등급은 받은 순서), 가장 좋은 카드는 맨 끝.
  /// 가장 좋은 카드 = 가장 희귀하고, 같은 등급이면 정가가 높은 것.
  static List<DrawResult> order(List<DrawResult> results) {
    if (results.length <= 1) return [...results];
    var bestIndex = 0;
    for (var i = 1; i < results.length; i++) {
      final a = results[i];
      final b = results[bestIndex];
      final better =
          a.rarity.rank > b.rarity.rank ||
          (a.rarity == b.rarity && a.estimatedValue > b.estimatedValue);
      if (better) bestIndex = i;
    }
    final others =
        <(int, DrawResult)>[
          for (var i = 0; i < results.length; i++)
            if (i != bestIndex) (i, results[i]),
        ]..sort((x, y) {
          final byRank = x.$2.rarity.rank.compareTo(y.$2.rarity.rank);
          return byRank != 0 ? byRank : x.$1.compareTo(y.$1);
        });
    return [for (final o in others) o.$2, results[bestIndex]];
  }

  /// 뒤집기 전에 진짜 등급 색으로 빛나는 카드(SR 이상). 정직한 기대감.
  static bool glowsBeforeFlip(Rarity r) => r.isFoil;

  /// 마지막(가장 좋은) 카드가 포커스 연출을 받는지.
  static bool bestGetsFocus(List<DrawResult> ordered) =>
      ordered.isNotEmpty && RevealTimeline.hasClimax(ordered.last.rarity);

  /// 직전 카드를 뒤집은 뒤 다음 카드까지 기다리는 시간.
  static int flipGapMs(Rarity previous) => switch (previous) {
    Rarity.n => 90,
    Rarity.r => 150,
    Rarity.sr => 420,
    Rarity.ssr => 520,
  };

  /// '모두 뒤집기' 일정: 아직 안 뒤집힌 카드들의 (위치, 시작 ms).
  /// 포커스 대상(마지막 카드, SR 이상)은 일정에서 빼고, 대신
  /// [focusDelayMs]만큼 쉰 뒤 포커스 연출을 시작한다.
  static List<(int, int)> flipAllSchedule(
    List<Rarity> ordered,
    Set<int> alreadyFlipped,
  ) {
    final focusLast =
        ordered.isNotEmpty && RevealTimeline.hasClimax(ordered.last);
    final schedule = <(int, int)>[];
    var at = 0;
    for (var i = 0; i < ordered.length; i++) {
      if (alreadyFlipped.contains(i)) continue;
      if (focusLast && i == ordered.length - 1) continue;
      schedule.add((i, at));
      at += flipGapMs(ordered[i]);
    }
    return schedule;
  }

  /// 모두 뒤집기 후 포커스 연출까지 쉬는 시간.
  static const int focusDelayMs = 450;
}
