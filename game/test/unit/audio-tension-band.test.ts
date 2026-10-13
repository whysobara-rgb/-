/**
 * [F8] fun-plan WP8 acceptance band: "coin climb reaches step >= 3 in 30-40 % of P-block matches"
 * (1v1 human proxy vs each rival at normal, police on, v2, both sides), measured through the real
 * MatchAudioDirector + MomentTracker fed exactly like match.ts funObserve.
 *
 * Bot-driven and slow (each match is a full headless game), so it is opt-in:
 *   F8_CLIMB_SEEDS=10 npx vitest run test/unit/audio-tension-band.test.ts   (n = 180, strict band)
 * Smaller seed counts widen the band by two binomial standard errors. Re-run it whenever bot
 * behaviour or content changes and retune TENSION_AUDIO.climbRunShare if it leaves the band.
 * The climb formula itself is covered by the default suite (audio-tension.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { MatchAudioDirector, type AudioEngine, type PlayOptions } from '../../src/audio';
import { createMatch } from '../../src/ai/harness';
import { MomentTracker } from '../../src/game/moments';
import { TICK_RATE } from '../../src/sim/config';
import type { LayoutId, TeamId } from '../../src/sim/types';

const SEEDS = Number(process.env.F8_CLIMB_SEEDS ?? 0);
const LAYOUTS: LayoutId[] = ['counter', 'plaza', 'shortcut'];
const RIVALS = ['hodadak', 'tongkeun', 'nunchi'] as const;

class Rec {
  maxStep = 0;
  play(id: string, o: PlayOptions = {}): void {
    const own = (id === 'scoreSmall' || id === 'scoreLarge' || id === 'scoreBank') && (o.volume ?? 1) === 1;
    if (own || id === 'runClimb') this.maxStep = Math.max(this.maxStep, o.step ?? 0);
  }
  stop(): void {}
  setLoop(): void {}
  playMusic(): void {}
  setMusicIntensity(): void {}
  setMusicTension(): void {}
  duckMusic(): void {}
  setListener(): void {}
}

/** Highest coin-climb step of one P-block match, from the local (proxy) side. */
function climbOf(layout: LayoutId, rivalP: (typeof RIVALS)[number], aTeam: TeamId, seed: number): number {
  const proxy = { personality: 'hodadak' as const, difficulty: 'normal' as const, humanProxy: true };
  const bot = { personality: rivalP, difficulty: 'normal' as const };
  const { sim, bots } = createMatch({ layout, team0: aTeam === 0 ? [proxy] : [bot], team1: aTeam === 0 ? [bot] : [proxy], seed, rules: { police: true, content: 'v2' } });
  const me = sim.characterBySlot(aTeam === 0 ? 0 : 1);
  const rival = bots.find((b) => b.team !== aTeam)!;
  const eng = new Rec();
  const dir = new MatchAudioDirector(eng as unknown as AudioEngine, { localTeam: aTeam, listenerCharId: me.id, footsteps: false, driveMusic: false });
  const tracker = new MomentTracker({ localTeam: aTeam, localCharId: me.id, earlyDecision: sim.rules.earlyDecision, isFree: (p) => sim.isFree(p, 0.45) });
  while (!sim.state.over && sim.state.tick < 300 * TICK_RATE) {
    const ev = sim.step(bots.map((b) => b.update(sim)));
    const intent = rival.intent?.();
    const moments = tracker.observe(sim.state, ev, intent ? [{ charId: sim.characterBySlot(rival.slot).id, intent }] : []);
    const snap = tracker.snapshot();
    const mp = snap.matchPoint;
    const left = sim.ticksLeft();
    dir.setTension({
      matchPoint: mp ? (mp.team === aTeam ? 'ours' : 'theirs') : null,
      secondsLeft: Number.isFinite(left) ? Math.max(0, left) / TICK_RATE : Infinity,
      run: snap.run ? { side: snap.run.team === aTeam ? 'ours' : 'theirs', recoveries: snap.run.recoveries, tier: snap.run.tier } : null,
    });
    dir.onMoments(moments);
    if (ev.length) dir.onEvents(ev, sim);
  }
  return eng.maxStep;
}

describe.skipIf(!(SEEDS > 0))('director [F8]: coin climb band on the P block (opt-in, F8_CLIMB_SEEDS)', () => {
  it('step >= 3 in 30-40 % of P-block matches', () => {
    let hits = 0;
    let n = 0;
    const per: Record<string, string> = {};
    for (const layout of LAYOUTS) {
      let h = 0;
      let m = 0;
      for (const r of RIVALS) {
        for (let k = 1; k <= SEEDS; k++) {
          for (const aTeam of [0, 1] as TeamId[]) {
            if (climbOf(layout, r, aTeam, 1000 * k + 17) >= 3) h++;
            m++;
          }
        }
      }
      per[layout] = `${((100 * h) / m).toFixed(1)}%`;
      hits += h;
      n += m;
    }
    const share = hits / n;
    // n >= 180: the plan's band as is; fewer matches: widened by two standard errors
    const slack = n >= 180 ? 0 : 2 * Math.sqrt((0.35 * 0.65) / n);
    console.log(`[F8 climb band] n=${n} step>=3 ${(100 * share).toFixed(1)}% ${JSON.stringify(per)}`);
    expect(share).toBeGreaterThanOrEqual(0.3 - slack);
    expect(share).toBeLessThanOrEqual(0.4 + slack);
  }, 3_600_000);
});
