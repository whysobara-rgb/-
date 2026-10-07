import 'package:flutter_test/flutter_test.dart';
import 'package:gacha_vault/core/domain/rarity.dart';
import 'package:gacha_vault/core/feedback/haptics.dart';
import 'package:gacha_vault/features/gacha/domain/draw_result.dart';
import 'package:gacha_vault/features/gacha/domain/reveal_timeline.dart';
import 'package:gacha_vault/features/gacha/presentation/widgets/gacha_fx_painters.dart';
import 'package:flutter/painting.dart';

DrawResult _r(int id, Rarity rarity, {int value = 1000}) => DrawResult(
  drawId: id,
  itemId: id,
  name: 'item$id',
  rarity: rarity,
  estimatedValue: value,
  exchangeValue: value * 8 ~/ 10,
);

void main() {
  group('RevealTimeline.single', () {
    test('승급은 실제 최고 등급에서 멈춘다 (더 높은 빛을 보여주지 않음)', () {
      expect(RevealTimeline.ascensionFor(Rarity.n), isEmpty);
      expect(RevealTimeline.ascensionFor(Rarity.r), [Rarity.r]);
      expect(RevealTimeline.ascensionFor(Rarity.sr), [Rarity.r, Rarity.sr]);
      expect(RevealTimeline.ascensionFor(Rarity.ssr), [
        Rarity.r,
        Rarity.sr,
        Rarity.ssr,
      ]);
    });

    test('어느 시점에도 밝혀진 빛은 실제 등급 이하이고, 내려가지 않는다', () {
      for (final highest in Rarity.values) {
        final tl = RevealTimeline.single(highest);
        var maxSoFar = -1;
        for (var ms = 0; ms <= tl.totalMs; ms += 10) {
          final m = tl.at(ms.toDouble());
          expect(m.to.rank, lessThanOrEqualTo(highest.rank));
          expect(m.from.rank, lessThanOrEqualTo(m.to.rank));
          expect(m.lit.rank, greaterThanOrEqualTo(maxSoFar));
          maxSoFar = m.lit.rank;
        }
        expect(tl.at(tl.totalMs.toDouble()).lit, highest);
      }
    });

    test('페이싱: N은 약 1.5초, SSR은 6~8초', () {
      final n = RevealTimeline.single(Rarity.n);
      final ssr = RevealTimeline.single(Rarity.ssr);
      expect(n.revealMs, inInclusiveRange(1200, 1600));
      expect(ssr.revealMs, inInclusiveRange(6000, 8000));
      final lengths = Rarity.values
          .map((r) => RevealTimeline.single(r).revealMs)
          .toList();
      for (var i = 1; i < lengths.length; i++) {
        expect(lengths[i], greaterThan(lengths[i - 1]));
      }
    });

    test('클라이맥스·긴장 구간은 SR/SSR에만 있다', () {
      for (final r in Rarity.values) {
        final tl = RevealTimeline.single(r);
        final hasClimax = tl.segment(RevealPhase.climax) != null;
        expect(hasClimax, r.isFoil, reason: r.code);
        expect(tl.segment(RevealPhase.tension) != null, r.isFoil);
        expect(tl.segment(RevealPhase.emerge), isNotNull);
        expect(tl.segment(RevealPhase.stamp), isNotNull);
      }
    });

    test('구간은 이어져 있고 신호(cue)는 시간 순서다', () {
      for (final r in Rarity.values) {
        final tl = RevealTimeline.single(r);
        for (var i = 1; i < tl.segments.length; i++) {
          expect(tl.segments[i].startMs, tl.segments[i - 1].endMs);
        }
        final cues = tl.cues.map((c) => c.atMs).toList();
        expect(cues, orderedEquals([...cues]..sort()));
        expect(tl.cues.every((c) => c.rarity.rank <= r.rank), isTrue);
      }
    });

    test('흔들림·파티클은 등급이 높을수록 크고 상한이 있다', () {
      for (var i = 1; i < Rarity.values.length; i++) {
        final a = Rarity.values[i - 1];
        final b = Rarity.values[i];
        expect(
          RevealTimeline.shakeScale(b),
          greaterThan(RevealTimeline.shakeScale(a)),
        );
        expect(
          RevealTimeline.sparkCount(b),
          greaterThan(RevealTimeline.sparkCount(a)),
        );
      }
      expect(RevealTimeline.sparkCount(Rarity.ssr), lessThanOrEqualTo(120));
    });

    test('포커스(10+1 마지막 카드)는 승급 없이 진짜 색으로만 빛난다', () {
      final f = RevealTimeline.focus(Rarity.ssr);
      expect(f.segment(RevealPhase.ascend), isNull);
      for (var ms = 0; ms <= f.totalMs; ms += 50) {
        expect(f.at(ms.toDouble()).lit, Rarity.ssr);
      }
      expect(RevealTimeline.focus(Rarity.sr).totalMs, lessThan(f.totalMs));
    });
  });

  group('RevealDeck', () {
    test('낮은 등급부터, 가장 좋은 카드(희귀·고가)는 맨 끝', () {
      final results = [
        _r(1, Rarity.n),
        _r(2, Rarity.sr, value: 3000),
        _r(3, Rarity.r),
        _r(4, Rarity.ssr, value: 20000),
        _r(5, Rarity.n),
        _r(6, Rarity.sr, value: 5000),
        _r(7, Rarity.r),
      ];
      final ordered = RevealDeck.order(results);
      expect(ordered.map((r) => r.drawId), [1, 5, 3, 7, 2, 6, 4]);
      expect(ordered.length, results.length);
    });

    test('같은 등급이면 정가가 높은 카드가 마지막', () {
      final ordered = RevealDeck.order([
        _r(1, Rarity.sr, value: 9000),
        _r(2, Rarity.sr, value: 3000),
        _r(3, Rarity.n),
      ]);
      expect(ordered.last.drawId, 1);
      expect(ordered.first.drawId, 3);
    });

    test('SR 이상만 뒤집기 전에 빛나고, 마지막 카드가 SR 이상일 때만 포커스', () {
      expect(RevealDeck.glowsBeforeFlip(Rarity.n), isFalse);
      expect(RevealDeck.glowsBeforeFlip(Rarity.r), isFalse);
      expect(RevealDeck.glowsBeforeFlip(Rarity.sr), isTrue);
      expect(RevealDeck.glowsBeforeFlip(Rarity.ssr), isTrue);
      expect(
        RevealDeck.bestGetsFocus([_r(1, Rarity.n), _r(2, Rarity.r)]),
        isFalse,
      );
      expect(
        RevealDeck.bestGetsFocus([_r(1, Rarity.n), _r(2, Rarity.sr)]),
        isTrue,
      );
    });

    test('모두 뒤집기: N/R은 빠르게, 포커스 카드는 일정에서 빠진다', () {
      final rarities = [Rarity.n, Rarity.n, Rarity.r, Rarity.sr, Rarity.ssr];
      final schedule = RevealDeck.flipAllSchedule(rarities, {1});
      expect(schedule.map((e) => e.$1), [0, 2, 3]);
      final times = schedule.map((e) => e.$2).toList();
      expect(times, orderedEquals([...times]..sort()));
      expect(
        RevealDeck.flipGapMs(Rarity.n),
        lessThan(RevealDeck.flipGapMs(Rarity.sr)),
      );
      // 마지막이 N/R이면 포커스 없이 전부 일정에 들어간다.
      final plain = RevealDeck.flipAllSchedule([Rarity.n, Rarity.r], {});
      expect(plain.map((e) => e.$1), [0, 1]);
    });
  });

  test('진동 패턴은 등급이 높을수록 길고 강하다', () {
    int weight(HapticPattern p) =>
        p.steps.fold(0, (s, e) => s + e.$2.index + 1);
    for (var i = 1; i < Rarity.values.length; i++) {
      final a = HapticPattern.ascend(Rarity.values[i - 1]);
      final b = HapticPattern.ascend(Rarity.values[i]);
      expect(weight(b), greaterThan(weight(a)));
    }
    expect(
      HapticPattern.climax(Rarity.ssr).durationMs,
      greaterThan(HapticPattern.climax(Rarity.sr).durationMs),
    );
  });

  test('승급 빛 색은 양 끝에서 정확히 이전/새 등급 색이고, 중간은 흰 섬광을 거친다', () {
    expect(stageStep(Rarity.sr, Rarity.ssr, 0), stageLight(Rarity.sr));
    expect(stageStep(Rarity.sr, Rarity.ssr, 1), stageLight(Rarity.ssr));
    final mid = stageStep(Rarity.sr, Rarity.ssr, 0.4);
    double lum(Color c) => c.computeLuminance();
    expect(lum(mid), greaterThan(lum(stageLight(Rarity.sr))));
    expect(lum(mid), greaterThan(lum(stageLight(Rarity.ssr))));
  });
}
