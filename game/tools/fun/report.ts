/**
 * Fun / content scorecard: aggregation and markdown (C11; content-plan §8, fun-plan §3 WP1 / §5).
 *
 * Port of `fun/metrics/agg.ts` + `extra.py` + `fun/moment/exp/mp.py`, plus the Content 2.0 block.
 * Input: `FunRec[]` from tools/fun/collect.ts. Output: markdown tables (one column per group) and a
 * gate table against content-plan §8 with the classic re-baseline column when classic records are
 * part of the same run (or passed as `baseline`).
 */
import { BANK_GROUP, type FunRec, type Source } from './collect';

const T = 60;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

export const q = (a: number[], p: number): number => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const i = (s.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return s[lo]! + (s[hi]! - s[lo]!) * (i - lo);
};
export const mean = (a: number[]): number => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const pct = (x: number): string => (Number.isFinite(x) ? `${(100 * x).toFixed(0)}%` : '-');
const f1 = (x: number): string => (Number.isFinite(x) ? x.toFixed(1) : '-');
const f2 = (x: number): string => (Number.isFinite(x) ? x.toFixed(2) : '-');
const f0 = (x: number): string => (Number.isFinite(x) ? (Math.round(x) || 0).toFixed(0) : '-');
const share = <X>(ms: X[], p: (m: X) => boolean): number => (ms.length ? ms.filter(p).length / ms.length : NaN);
const sign = (x: number): number => (x > 0 ? 1 : x < 0 ? -1 : 0);

/** Deterministic PRNG for the bootstrap (reports must be reproducible). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 95% percentile-bootstrap interval of a statistic (default: the median), 1000 resamples. */
export function bootCI(a: number[], stat: (x: number[]) => number = (x) => q(x, 0.5), reps = 1000): [number, number] | null {
  if (a.length < 5) return null;
  const rnd = mulberry32(0x5eed + a.length);
  const out: number[] = [];
  const buf = new Array<number>(a.length);
  for (let r = 0; r < reps; r++) {
    for (let i = 0; i < a.length; i++) buf[i] = a[Math.floor(rnd() * a.length)]!;
    out.push(stat(buf));
  }
  return [q(out, 0.025), q(out, 0.975)];
}

/** Paired mean difference with a normal 95% interval (pairs by seed / side / rival / map). */
export function pairedDiff(d: number[]): { mean: number; lo: number; hi: number; n: number } | null {
  const n = d.length;
  if (n < 10) return null;
  const m = mean(d);
  const sd = Math.sqrt(d.reduce((a, x) => a + (x - m) * (x - m), 0) / (n - 1));
  const h = (1.96 * sd) / Math.sqrt(n);
  return { mean: m, lo: m - h, hi: m + h, n };
}

/** Shannon entropy (bits) of a weight distribution. */
const entropy = (w: number[]): number => {
  const t = w.reduce((a, x) => a + x, 0);
  if (t <= 0) return 0;
  let h = 0;
  for (const x of w) if (x > 0) h -= (x / t) * Math.log2(x / t);
  return h;
};

// ---------------------------------------------------------------------------
// per-match analysis (agg.ts `analyze` + content)
// ---------------------------------------------------------------------------

export interface M {
  r: FunRec;
  lenS: number;
  leadChanges: number;
  leadChanges2nd: number;
  equalizers: number;
  deficitOvercome: number;
  margin: number;
  last30Share: number;
  goAheadBeforeEndS: number;
  goAheadFrac: number;
  garbageS: number;
  garbage600S: number;
  dramaOld: number;
  dramaOldProxy: number;
  dramaNew: number;
  dramaNewProxy: number;
  clockRecoveries: number;
  lateSwing: boolean;
  firstScoreS: number | null;
  longestDryS: number;
  bankShare: number;
  biggestSingle: number;
  loserLedLate60: boolean;
  rematchWorthy: boolean;
  blowout: boolean;
  winnerLedFrac: number;
  clockCutS: number;
  proxyTeam: number | null;
  proxyResult: 'W' | 'L' | 'D' | null;
  /** Visible match point of the winner before an early ending (s); null when not an early win. */
  mpLeadS: number | null;
  mpDenied: number;
  totalPts: number;
  /** Variety index: entropy (bits) of points over (value source x transport mode), content-plan §8. */
  variety: number;
}

function analyze(r: FunRec): M {
  const end = r.endTick;
  const lenS = end / T;
  const s = [0, 0];
  const states: { tick: number; d: number }[] = [{ tick: 0, d: 0 }];
  const recs = [...r.rec].sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < recs.length; ) {
    const t = recs[i]![0];
    while (i < recs.length && recs[i]![0] === t) {
      s[recs[i]![1]]! += recs[i]![2];
      i++;
    }
    states.push({ tick: t, d: s[0]! - s[1]! });
  }
  const total = s[0]! + s[1]!;
  let leadChanges = 0;
  let leadChanges2nd = 0;
  let equalizers = 0;
  let lastStrict = 0;
  for (let i = 1; i < states.length; i++) {
    const g = sign(states[i]!.d);
    const pg = sign(states[i - 1]!.d);
    if (g === 0 && pg !== 0) equalizers++;
    if (g !== 0) {
      if (lastStrict !== 0 && g !== lastStrict) {
        leadChanges++;
        if (states[i]!.tick >= 0.5 * end) leadChanges2nd++;
      }
      lastStrict = g;
    }
  }
  const w = r.winner;
  const fd = s[0]! - s[1]!;
  const margin = Math.abs(r.scores[0] - r.scores[1]);
  const wd = (d: number): number => (w === 0 ? d : w === 1 ? -d : Math.abs(d));
  let deficitOvercome = 0;
  if (w !== null) for (const st of states) deficitOvercome = Math.max(deficitOvercome, -wd(st.d));
  else for (const st of states) deficitOvercome = Math.max(deficitOvercome, Math.abs(st.d));
  let goAheadTick = 0;
  const fs = sign(fd);
  for (let i = 1; i < states.length; i++) if (sign(states[i]!.d) === fs && sign(states[i - 1]!.d) !== fs) goAheadTick = states[i]!.tick;
  if (w === null) goAheadTick = states[states.length - 1]!.tick;
  const garbage = (X: number): number => {
    if (w === null || margin <= X) return 0;
    let t = 0;
    for (let i = states.length - 1; i >= 0; i--) {
      if (wd(states[i]!.d) > X) t = states[i]!.tick;
      else break;
    }
    return (end - t) / T;
  };
  const last30 = recs.filter((x) => x[0] >= end - 30 * T).reduce((a, x) => a + x[2], 0);
  const clockRecoveries = r.reason === 'time' ? recs.filter((x) => x[0] >= end - 10 * T).length : 0;
  let lateSwing = false;
  for (let i = 1; i < states.length; i++) {
    if (states[i]!.tick < end - 30 * T) continue;
    if (sign(states[i]!.d) !== sign(states[i - 1]!.d)) lateSwing = true;
  }
  let loserLedLate60 = false;
  if (w !== null) {
    let cur = 0;
    for (const st of states) if (st.tick <= end - 60 * T) cur = st.d;
    if (wd(cur) <= 0) loserLedLate60 = true;
    for (const st of states) if (st.tick > end - 60 * T && wd(st.d) <= 0) loserLedLate60 = true;
  }
  const ev = r.ev;
  const ep = r.evProxy;
  const n = (o: Record<string, number>, k: string): number => o[k] ?? 0;
  const dramaOld = n(ev, 'steal') + n(ev, 'tackle') + n(ev, 'koDash') + n(ev, 'fence') + clockRecoveries;
  const dramaOldProxy = n(ep, 'steal') + n(ep, 'tackled') + n(ep, 'koDealt') + n(ep, 'koTaken') + n(ep, 'fence') + n(ep, 'stun');
  // content-plan §8 drama: coin bursts >= 20, item hits on characters / police, KOs, steals,
  // launches, recoveries >= 200, event opens, jackpots
  const dramaNew = n(ev, 'coinBurst') + n(ev, 'itemHitChar') + n(ev, 'ko') + n(ev, 'steal') + n(ev, 'launch') + n(ev, 'rec200') + n(ev, 'eventOpen') + n(ev, 'jackpot');
  const dramaNewProxy = n(ep, 'coinBurst') + n(ep, 'itemHitChar') + n(ep, 'koDealt') + n(ep, 'koTaken') + n(ep, 'steal') + n(ep, 'launch') + n(ep, 'rec200') + n(ep, 'jackpot');
  const ticks = [0, ...recs.map((x) => x[0]), end];
  let longestDry = 0;
  for (let i = 1; i < ticks.length; i++) longestDry = Math.max(longestDry, (ticks[i]! - ticks[i - 1]!) / T);
  const bankPts = recs.filter((x) => x[3] === 'bank').reduce((a, x) => a + x[2], 0);
  const biggestSingle = recs.reduce((a, x) => Math.max(a, x[2]), 0);
  const proxyTeam = r.proxyId !== null ? (r.chars.find((c) => c.id === r.proxyId)?.team ?? null) : null;
  let proxyResult: M['proxyResult'] = null;
  if (proxyTeam !== null) proxyResult = w === null ? 'D' : w === proxyTeam ? 'W' : 'L';
  const rematchWorthy = w === null || margin <= 300 || loserLedLate60 || deficitOvercome >= 500;
  const g300 = garbage(300);
  // match point visibility (mp.py): merge intervals of one team within 2 s
  const iv: [number, number, number][] = [];
  for (const [t, a, b] of [...r.mp].sort((x, y) => x[0] - y[0] || x[1] - y[1])) {
    const last = iv[iv.length - 1];
    if (last && last[0] === t && a - last[2] <= 120) last[2] = Math.max(last[2], b);
    else iv.push([t, a, b]);
  }
  let mpLeadS: number | null = null;
  if ((r.reason === 'decided' || r.reason === 'allRecovered') && w !== null) {
    const fin = iv.find((x) => x[0] === w && x[2] >= end - 1);
    mpLeadS = fin ? (fin[2] - fin[1]) / T : 0;
  }
  const mpDenied = iv.filter((x) => x[2] < end - 30).length;
  // variety index: value-weighted entropy over (source x transport mode); coins by origin, the bank
  // group as one source; rows from records without a mode count as carried ('solo')
  const cell: Record<string, number> = {};
  for (const x of recs) {
    let src = x[3].startsWith('coins:') ? x[3].slice(6) : x[3];
    if (BANK_GROUP.has(src)) src = 'bank';
    const mode = x[6] ?? (x[5] ? 'bag' : 'solo');
    const k = `${src}|${mode}`;
    cell[k] = (cell[k] ?? 0) + x[2];
  }
  return {
    r,
    lenS,
    leadChanges,
    leadChanges2nd,
    equalizers,
    deficitOvercome,
    margin,
    last30Share: total > 0 ? last30 / total : 0,
    goAheadBeforeEndS: (end - goAheadTick) / T,
    goAheadFrac: goAheadTick / end,
    garbageS: g300,
    garbage600S: garbage(600),
    dramaOld,
    dramaOldProxy,
    dramaNew,
    dramaNewProxy,
    clockRecoveries,
    lateSwing,
    firstScoreS: recs.length ? recs[0]![0] / T : null,
    longestDryS: longestDry,
    bankShare: total > 0 ? bankPts / total : 0,
    biggestSingle,
    loserLedLate60,
    rematchWorthy,
    blowout: margin >= 1000 || g300 >= 60,
    winnerLedFrac: (() => {
      if (w === null) return 0;
      let led = 0;
      for (let i = 0; i < states.length; i++) {
        const t0 = states[i]!.tick;
        const t1 = i + 1 < states.length ? states[i + 1]!.tick : end;
        if (wd(states[i]!.d) > 0) led += t1 - t0;
      }
      return led / end;
    })(),
    clockCutS: ((r.fcTick !== null ? Math.min(240 * T, r.fcTick + 30 * T) : 240 * T) - end) / T,
    proxyTeam,
    proxyResult,
    mpLeadS,
    mpDenied,
    totalPts: total,
    variety: entropy(Object.values(cell)),
  };
}

// ---------------------------------------------------------------------------
// group metrics (numbers) — shared by the tables and the gates
// ---------------------------------------------------------------------------

/** Value sources merged shell + coins by origin (content-plan §8 shares). */
const SHARE_SOURCES: Source[] = ['bank', 'bankSafe', 'largeSafe', 'smallSafe', 'atm', 'piggy', 'moneyTree', 'breakable', 'event'];

export interface GroupNumbers {
  n: number;
  errors: number;
  invariant: number;
  lenMed: number;
  reach240: number;
  draws: number;
  leadChanges: number;
  comebackWins: number | null;
  blowoutLosses: number | null;
  proxyW: number | null;
  proxyL: number | null;
  rematch: number;
  fullCountdown: number;
  endedAt2ndBank: number;
  fcStartMed: number;
  valueAtFcMed: number;
  proxyFirstScoreMed: number | null;
  proxyFirstScoreByLayout: Record<string, number>;
  proxyFirstActionMed: number | null;
  proxyFirstActionByLayout: Record<string, number>;
  deadPayoff: number | null;
  deadPayoffByLayout: Record<string, number>;
  deadOld: number | null;
  deadPayHold: number | null;
  longestDryMed: number;
  dramaPerMin: number;
  dramaProxyPerMin: number | null;
  verbsMed: number | null;
  sourcesMed: number | null;
  bankShare: number;
  largestNonBank: { source: string; share: number };
  coinShare: number;
  eventShare: number;
  tacklesPerMin: number;
  hammerKosPerMin: number;
  spillsPerMatch: number;
  spillRetakenPerMatch: number;
  dropsContested: number | null;
  botPickupsUsed: number | null;
  itemUsesPerHeldMinBot: number | null;
  itemUsesPerHeldMinProxy: number | null;
  gimmickBot: number | null;
  gimmickProxy: number | null;
  hammerKoRatio: number | null;
  mirrorSplitByLayout: Record<string, number>;
  heldHammerDelta: number | null;
  goldHammerDelta: number | null;
  firstDropDelta: number | null;
  stepMsMed: number;
  mpWarned: number;
  mpDeniedPerMatch: number;
  /** 95% bootstrap CI of each map's median proxy first action / first score (s). */
  proxyFirstActionCI: Record<string, [number, number] | null>;
  proxyFirstScoreCI: Record<string, [number, number] | null>;
  /** Share of proxies whose first action came by 10 s, per map. */
  proxyActBy10ByLayout: Record<string, number>;
  /** Bank group share of points (bank recoveries + interior safes recovered on their own). */
  bankGroupShare: number;
  /** Rematch-worthy among decided matches only (draws always count as rematch-worthy). */
  rematchDecided: number;
  /** Decided and rematch-worthy, as a share of all matches (= rematch-worthy minus draws). */
  rematchNonDraw: number;
  /** fun-plan WP1 proxy rows. */
  proxyTackled5: number | null;
  proxyBankHaulBroken4: number | null;
  proxyHaulBroken4: number | null;
  proxyKoDealtPerMatch: number | null;
  proxyKoTakenPerMatch: number | null;
  varietyMean: number;
  jackpotsPerMatch: number;
  piggyIntactPerMatch: number;
}

export function numbers(ms: M[]): GroupNumbers {
  const n = ms.length;
  const minutes = ms.reduce((a, m) => a + m.lenS / 60, 0) || 1;
  const sumEv = (k: string): number => ms.reduce((a, m) => a + (m.r.ev[k] ?? 0), 0);
  const proxy = ms.filter((m) => m.proxyResult !== null);
  const pc = (m: M) => m.r.chars.find((c) => c.id === m.r.proxyId)!;
  const layouts = [...new Set(ms.map((m) => m.r.layout))];
  const byLayout = (f: (xs: M[]) => number): Record<string, number> => Object.fromEntries(layouts.map((l) => [l, f(proxy.filter((m) => m.r.layout === l))]));
  const fc = ms.filter((m) => m.r.fcTick !== null);
  // source shares (pooled)
  const src: Record<string, number> = {};
  let totPts = 0;
  for (const m of ms) {
    for (const [k, v] of Object.entries(m.r.pointsBySource)) {
      const key = k.startsWith('coins:') ? k.slice(6) : k;
      src[key] = (src[key] ?? 0) + v;
    }
    totPts += m.totalPts;
  }
  let largest = { source: '-', share: 0 };
  for (const s of SHARE_SOURCES) {
    if (BANK_GROUP.has(s)) continue;
    const sh = (src[s] ?? 0) / Math.max(1, totPts);
    if (sh > largest.share) largest = { source: s, share: sh };
  }
  const coinPts = ms.reduce((a, m) => a + m.r.coinPoints, 0);
  // bots / proxy items
  const bots = ms.flatMap((m) => m.r.chars.filter((c) => c.isBot));
  const proxies = proxy.map(pc);
  const pick = bots.reduce((a, c) => a + c.itemPickups, 0);
  const used = bots.reduce((a, c) => a + c.itemPickupsUsed, 0);
  const rate = (cs: typeof bots): number | null => {
    const held = cs.reduce((a, c) => a + c.itemHeldTicks, 0) / T / 60;
    return held > 0 ? cs.reduce((a, c) => a + c.itemUses, 0) / held : null;
  };
  const botsInP = proxy.flatMap((m) => m.r.chars.filter((c) => c.isBot));
  const koBotOnProxy = botsInP.reduce((a, c) => a + c.hammerKosOnProxy, 0);
  const koProxyOnBots = proxies.reduce((a, c) => a + c.hammerKosOnBots, 0);
  // fairness: per character-match win rates
  const charRes = ms.flatMap((m) => m.r.chars.map((c) => ({ c, win: m.r.winner === null ? 0.5 : m.r.winner === c.team ? 1 : 0 })));
  const delta = (p: (c: (typeof charRes)[number]['c']) => boolean): number | null => {
    const a = charRes.filter((x) => p(x.c));
    const b = charRes.filter((x) => !p(x.c));
    // both groups need a real sample (a delta over a handful of characters is noise)
    if (a.length < 30 || b.length < 30) return null;
    return mean(a.map((x) => x.win)) - mean(b.map((x) => x.win));
  };
  const fd = ms.filter((m) => m.r.firstDropTeam !== null);
  const mirror: Record<string, number> = {};
  for (const l of layouts) {
    const lm = ms.filter((m) => m.r.layout === l && m.r.winner !== null);
    mirror[l] = lm.length ? lm.filter((m) => m.r.winner === 0).length / lm.length : NaN;
  }
  const early = ms.filter((m) => m.mpLeadS !== null);
  const fa = (m: M): number => (pc(m).firstActionTick ?? m.r.endTick) / T;
  const fsc = (m: M): number => (pc(m).firstScoreTick ?? m.r.endTick) / T;
  const ciBy = (f: (m: M) => number): Record<string, [number, number] | null> =>
    Object.fromEntries(layouts.map((l) => [l, bootCI(proxy.filter((m) => m.r.layout === l).map(f))]));
  const dec = ms.filter((m) => m.r.winner !== null);
  const ep = (m: M, k: string): number => m.r.evProxy[k] ?? 0;
  return {
    n,
    errors: ms.filter((m) => m.r.error).length,
    invariant: ms.reduce((a, m) => a + m.r.invariantViolations, 0),
    lenMed: q(ms.map((m) => m.lenS), 0.5),
    reach240: share(ms, (m) => m.r.endTick >= 240 * T - 1),
    draws: share(ms, (m) => m.r.winner === null),
    leadChanges: mean(ms.map((m) => m.leadChanges)),
    comebackWins: proxy.length ? share(proxy, (m) => m.proxyResult === 'W' && m.deficitOvercome >= 500) : null,
    blowoutLosses: proxy.length ? share(proxy, (m) => m.proxyResult === 'L' && m.blowout) : null,
    proxyW: proxy.length ? share(proxy, (m) => m.proxyResult === 'W') : null,
    proxyL: proxy.length ? share(proxy, (m) => m.proxyResult === 'L') : null,
    rematch: share(ms, (m) => m.rematchWorthy),
    fullCountdown: fc.length ? share(fc, (m) => m.r.endTick - m.r.fcTick! >= 25 * T) : NaN,
    endedAt2ndBank: fc.length ? share(fc, (m) => m.r.endTick - m.r.fcTick! <= 2 * T) : NaN,
    fcStartMed: q(fc.map((m) => m.r.fcTick! / T), 0.5),
    valueAtFcMed: q(fc.map((m) => m.r.valueAtFc ?? NaN).filter(Number.isFinite), 0.5),
    proxyFirstScoreMed: proxy.length ? q(proxy.map((m) => (pc(m).firstScoreTick ?? m.r.endTick) / T), 0.5) : null,
    proxyFirstScoreByLayout: byLayout((xs) => q(xs.map((m) => (pc(m).firstScoreTick ?? m.r.endTick) / T), 0.5)),
    proxyFirstActionMed: proxy.length ? q(proxy.map((m) => (pc(m).firstActionTick ?? m.r.endTick) / T), 0.5) : null,
    proxyFirstActionByLayout: byLayout((xs) => q(xs.map((m) => (pc(m).firstActionTick ?? m.r.endTick) / T), 0.5)),
    deadPayoff: proxy.length ? mean(proxy.map((m) => pc(m).deadPayoff.seconds / m.lenS)) : null,
    deadPayoffByLayout: byLayout((xs) => mean(xs.map((m) => pc(m).deadPayoff.seconds / m.lenS))),
    deadOld: proxy.length ? mean(proxy.map((m) => pc(m).dead.seconds / m.lenS)) : null,
    deadPayHold: proxy.length ? mean(proxy.map((m) => (pc(m).deadPayHold?.seconds ?? NaN) / m.lenS)) : null,
    longestDryMed: q(ms.map((m) => m.longestDryS), 0.5),
    dramaPerMin: ms.reduce((a, m) => a + m.dramaNew, 0) / minutes,
    dramaProxyPerMin: proxy.length ? proxy.reduce((a, m) => a + m.dramaNewProxy, 0) / (proxy.reduce((a, m) => a + m.lenS / 60, 0) || 1) : null,
    verbsMed: proxy.length ? q(proxy.map((m) => pc(m).verbs.length), 0.5) : null,
    sourcesMed: proxy.length ? q(proxy.map((m) => pc(m).sources.length), 0.5) : null,
    bankShare: mean(ms.filter((m) => m.totalPts > 0).map((m) => m.bankShare)),
    largestNonBank: largest,
    coinShare: coinPts / Math.max(1, totPts),
    eventShare: (src.event ?? 0) / Math.max(1, totPts),
    tacklesPerMin: sumEv('tackle') / minutes,
    hammerKosPerMin: sumEv('hammerKo') / minutes,
    spillsPerMatch: sumEv('spill') / Math.max(1, n),
    spillRetakenPerMatch: sumEv('spillRetakenN') / Math.max(1, n),
    dropsContested: sumEv('itemPickups') > 0 ? sumEv('dropsContested') / sumEv('itemPickups') : null,
    botPickupsUsed: pick > 0 ? used / pick : null,
    itemUsesPerHeldMinBot: rate(botsInP.length ? botsInP : bots),
    itemUsesPerHeldMinProxy: rate(proxies),
    gimmickBot: botsInP.length ? mean(botsInP.map((c) => c.gimmickUses)) : null,
    gimmickProxy: proxies.length ? mean(proxies.map((c) => c.gimmickUses)) : null,
    hammerKoRatio: koProxyOnBots > 0 ? koBotOnProxy / koProxyOnBots : koBotOnProxy > 0 ? Infinity : null,
    mirrorSplitByLayout: mirror,
    heldHammerDelta: delta((c) => c.heldHammer),
    goldHammerDelta: delta((c) => c.gotGoldHammer),
    firstDropDelta: fd.length >= 30 ? mean(fd.map((m) => (m.r.winner === null ? 0.5 : m.r.winner === m.r.firstDropTeam ? 1 : 0))) - 0.5 : null,
    stepMsMed: q(ms.map((m) => m.r.stepMsMed), 0.5),
    mpWarned: early.length ? share(early, (m) => (m.mpLeadS ?? 0) >= 3) : NaN,
    mpDeniedPerMatch: mean(ms.map((m) => m.mpDenied)),
    proxyFirstActionCI: ciBy(fa),
    proxyFirstScoreCI: ciBy(fsc),
    proxyActBy10ByLayout: byLayout((xs) => share(xs, (m) => fa(m) <= 10)),
    bankGroupShare: ((src.bank ?? 0) + (src.bankSafe ?? 0)) / Math.max(1, totPts),
    rematchDecided: share(dec, (m) => m.rematchWorthy),
    rematchNonDraw: share(ms, (m) => m.r.winner !== null && m.rematchWorthy),
    proxyTackled5: proxy.length ? share(proxy, (m) => ep(m, 'tackled') >= 5) : null,
    proxyBankHaulBroken4: proxy.length ? share(proxy, (m) => ep(m, 'bankHaulBroken') >= 4) : null,
    proxyHaulBroken4: proxy.length ? share(proxy, (m) => ep(m, 'haulBroken') >= 4) : null,
    proxyKoDealtPerMatch: proxy.length ? mean(proxy.map((m) => ep(m, 'koDealt'))) : null,
    proxyKoTakenPerMatch: proxy.length ? mean(proxy.map((m) => ep(m, 'koTaken'))) : null,
    varietyMean: mean(ms.map((m) => m.variety)),
    jackpotsPerMatch: sumEv('jackpot') / Math.max(1, n),
    piggyIntactPerMatch: sumEv('piggyIntact') / Math.max(1, n),
  };
}

// ---------------------------------------------------------------------------
// tables
// ---------------------------------------------------------------------------

/** Fun block (fun-plan §5 / WP1 metrics, agg.ts + extra.py + mp.py), one column per group. */
function funRow(name: string, ms: M[]): Record<string, string> {
  const n = ms.length;
  const N = numbers(ms);
  const dec = ms.filter((m) => m.r.winner !== null);
  const lens = ms.map((m) => m.lenS);
  const minutes = ms.reduce((a, m) => a + m.lenS / 60, 0) || 1;
  const sumEv = (k: string): number => ms.reduce((a, m) => a + (m.r.ev[k] ?? 0), 0);
  const sumEvP = (k: string): number => ms.reduce((a, m) => a + (m.r.evProxy[k] ?? 0), 0);
  const reasons: Record<string, number> = {};
  for (const m of ms) reasons[m.r.reason] = (reasons[m.r.reason] ?? 0) + 1;
  const proxy = ms.filter((m) => m.proxyResult !== null);
  const pc = (m: M) => m.r.chars.find((c) => c.id === m.r.proxyId)!;
  const fc = ms.filter((m) => m.r.fcTick !== null);
  const out: Record<string, string> = {
    group: name,
    n: String(n),
    'len s q1/med/q3; reached 240 s': `${f0(q(lens, 0.25))}/${f0(q(lens, 0.5))}/${f0(q(lens, 0.75))}; ${pct(N.reach240)}`,
    'end reason time/decided/allRec': `${pct((reasons.time ?? 0) / n)}/${pct((reasons.decided ?? 0) / n)}/${pct((reasons.allRecovered ?? 0) / n)}`,
    draws: pct(N.draws),
    'lead changes mean (0 / >=2); in 2nd half mean': `${f1(N.leadChanges)} (${pct(share(ms, (m) => m.leadChanges === 0))} / ${pct(share(ms, (m) => m.leadChanges >= 2))}); ${f2(mean(ms.map((m) => m.leadChanges2nd)))}`,
    'equalizers mean': f1(mean(ms.map((m) => m.equalizers))),
    'winner never trailed': pct(share(dec, (m) => m.deficitOvercome === 0)),
    'deficit overcome by winner: mean / p90 / >=500': `${f0(mean(dec.map((m) => m.deficitOvercome)))} / ${f0(q(dec.map((m) => m.deficitOvercome), 0.9))} / ${pct(share(dec, (m) => m.deficitOvercome >= 500))}`,
    'margin med (q1-q3)': `${f0(q(ms.map((m) => m.margin), 0.5))} (${f0(q(ms.map((m) => m.margin), 0.25))}-${f0(q(ms.map((m) => m.margin), 0.75))})`,
    'margin 0 / 1-300 / 301-999 / >=1000': `${pct(share(ms, (m) => m.margin === 0))} / ${pct(share(ms, (m) => m.margin > 0 && m.margin <= 300))} / ${pct(share(ms, (m) => m.margin > 300 && m.margin < 1000))} / ${pct(share(ms, (m) => m.margin >= 1000))}`,
    'decided by <=300 (incl draws)': pct(share(ms, (m) => m.margin <= 300)),
    'pts in final 30 s (mean share)': pct(mean(ms.map((m) => m.last30Share))),
    'final go-ahead: s before end med (q1-q3) / frac of match med': `${f0(q(dec.map((m) => m.goAheadBeforeEndS), 0.5))} (${f0(q(dec.map((m) => m.goAheadBeforeEndS), 0.25))}-${f0(q(dec.map((m) => m.goAheadBeforeEndS), 0.75))}) / ${pct(q(dec.map((m) => m.goAheadFrac), 0.5))}`,
    'go-ahead in final 30 s': pct(share(dec, (m) => m.goAheadBeforeEndS <= 30)),
    'garbage time (lead>300 for good) mean s / >=60 s': `${f0(mean(ms.map((m) => m.garbageS)))} / ${pct(share(ms, (m) => m.garbageS >= 60))}`,
    'late swing (flip/equalizer in final 30 s)': pct(share(ms, (m) => m.lateSwing)),
    'drama/min, fun-plan def (steal+tackle+dash KO+fence+clock rec)': f1(ms.reduce((a, m) => a + m.dramaOld, 0) / minutes),
    '  steals/min; police tackles/min; dash KOs/min; fence busts/match': `${f1(sumEv('steal') / minutes)}; ${f1(sumEv('tackle') / minutes)}; ${f1(sumEv('koDash') / minutes)}; ${f1(sumEv('fence') / n)}`,
    '  stuns/min, bank hauls broken/match, recovery cancels/match, strips/match': `${f1(sumEv('stun') / minutes)}, ${f1(sumEv('bankHaulBroken') / n)}, ${f1(sumEv('recoveryCancel') / n)}, ${f1(sumEv('strip') / n)}`,
    'first score (any team) s med': f1(q(ms.filter((m) => m.firstScoreS !== null).map((m) => m.firstScoreS!), 0.5)),
    'longest scoreless stretch s med (q3)': `${f0(N.longestDryMed)} (${f0(q(ms.map((m) => m.longestDryS), 0.75))})`,
    'bank share of points mean / largest single recovery med': `${pct(N.bankShare)} / ${f0(q(ms.map((m) => m.biggestSingle), 0.5))}`,
    'winner led % of match time (mean)': pct(mean(dec.map((m) => m.winnerLedFrac))),
    'draw scorelines': Object.entries(ms.filter((m) => m.r.winner === null).reduce((a, m) => ((a[m.r.scores[0]] = (a[m.r.scores[0]] ?? 0) + 1), a), {} as Record<string, number>)).map(([k, v]) => `${k}x${v}`).join(' '),
    'final countdown reached; FC start med s (q1-q3)': `${pct(fc.length / Math.max(1, n))}; ${f0(N.fcStartMed)} (${f0(q(fc.map((m) => m.r.fcTick! / T), 0.25))}-${f0(q(fc.map((m) => m.r.fcTick! / T), 0.75))})`,
    'of FC matches: full 30 s played / ended <=2 s after 2nd bank': `${pct(N.fullCountdown)} / ${pct(N.endedAt2ndBank)}`,
    'value on field at FC med (q1-q3)': `${f0(N.valueAtFcMed)} (${f0(q(fc.map((m) => m.r.valueAtFc ?? NaN).filter(Number.isFinite), 0.25))}-${f0(q(fc.map((m) => m.r.valueAtFc ?? NaN).filter(Number.isFinite), 0.75))})`,
    '1st bank med s; bank1->bank2 gap med s': `${f0(q(ms.filter((m) => m.r.firstBankTick).map((m) => m.r.firstBankTick! / T), 0.5))}; ${f0(q(ms.filter((m) => m.r.firstBankTick && m.r.secondBankTick).map((m) => (m.r.secondBankTick! - m.r.firstBankTick!) / T), 0.5))}`,
    'loser led/tied in final 60 s': pct(share(dec, (m) => m.loserLedLate60)),
    'REMATCH-WORTHY (draw | <=300 | loser led late | comeback>=500)': pct(N.rematch),
    '  rematch-worthy among decided matches; draws (each counts as rematch-worthy)': `${pct(N.rematchDecided)}; ${pct(N.draws)}`,
    'blowout (>=1000 or garbage >=60 s)': pct(share(ms, (m) => m.blowout)),
    'early wins with >=3 s visible match point; match points denied/match': `${pct(N.mpWarned)}; ${f2(N.mpDeniedPerMatch)}`,
  };
  if (proxy.length) {
    out['PROXY W/L/D'] = `${pct(N.proxyW!)}/${pct(N.proxyL!)}/${pct(share(proxy, (m) => m.proxyResult === 'D'))}`;
    out['proxy near-miss losses (<=300) / blowout losses'] = `${pct(share(proxy, (m) => m.proxyResult === 'L' && m.margin <= 300))} / ${pct(N.blowoutLosses!)}`;
    out['proxy comeback wins (>=500 deficit)'] = pct(N.comebackWins!);
    const minutesP = proxy.reduce((a, m) => a + m.lenS / 60, 0) || 1;
    out['proxy drama/min, fun-plan def (steal/tackled/KO dealt+taken/stun/fence)'] = `${f1(proxy.reduce((a, m) => a + m.dramaOldProxy, 0) / minutesP)} (${f1(sumEvP('steal') / minutesP)}/${f1(sumEvP('tackled') / minutesP)}/${f1((sumEvP('koDealt') + sumEvP('koTaken')) / minutesP)}/${f1(sumEvP('stun') / minutesP)}/${f1(sumEvP('fence') / minutesP)})`;
    out['proxy: had loot stolen from its haul /match'] = f1(sumEvP('stolenFrom') / proxy.length);
    const dead = proxy.map((m) => pc(m).dead);
    out['proxy dead time, fun-plan def (>8 s neither holding nor contested): stretches/match, s/match, % of match, longest med'] = `${f1(mean(dead.map((d) => d.stretches)))}, ${f0(mean(dead.map((d) => d.seconds)))}, ${pct(N.deadOld!)}, ${f0(q(dead.map((d) => d.longest), 0.5))}`;
    out['proxy own first score s med (none %)'] = `${f1(N.proxyFirstScoreMed!)} (${pct(share(proxy, (m) => pc(m).firstScoreTick === null))})`;
    out['proxy tackled >= 5 / bank haul broken >= 4 / any haul broken >= 4 (share of matches)'] = `${pct(N.proxyTackled5!)} / ${pct(N.proxyBankHaulBroken4!)} / ${pct(N.proxyHaulBroken4!)}`;
    out['proxy KOs dealt / received per match; steals per match'] = `${f2(N.proxyKoDealtPerMatch!)} / ${f2(N.proxyKoTakenPerMatch!)}; ${f2(sumEvP('steal') / proxy.length)}`;
  } else {
    const all = ms.flatMap((m) => m.r.chars.map((c) => ({ d: c.dead, len: m.lenS })));
    out['per-character dead time, fun-plan def: stretches, s, % of match, longest med'] = `${f1(mean(all.map((x) => x.d.stretches)))}, ${f0(mean(all.map((x) => x.d.seconds)))}, ${pct(mean(all.map((x) => x.d.seconds / x.len)))}, ${f0(q(all.map((x) => x.d.longest), 0.5))}`;
  }
  out['crashes / invariant violations'] = `${N.errors} / ${N.invariant}`;
  out['sim step median ms (p95 med)'] = `${N.stepMsMed.toFixed(3)} (${q(ms.map((m) => m.r.stepMsP95), 0.5).toFixed(3)})`;
  return out;
}

/** Content block (content-plan §8), one column per group. */
function contentRow(name: string, ms: M[]): Record<string, string> {
  const N = numbers(ms);
  const n = ms.length;
  const sumEv = (k: string): number => ms.reduce((a, m) => a + (m.r.ev[k] ?? 0), 0);
  const proxy = ms.filter((m) => m.proxyResult !== null);
  const pc = (m: M) => m.r.chars.find((c) => c.id === m.r.proxyId)!;
  const lay = (o: Record<string, number>, fmt: (x: number) => string): string =>
    Object.entries(o)
      .map(([k, v]) => `${k.slice(0, 4)} ${fmt(v)}`)
      .join(' · ');
  const layCI = (o: Record<string, number>, ci: Record<string, [number, number] | null>): string =>
    Object.entries(o)
      .map(([k, v]) => `${k.slice(0, 4)} ${f1(v)}${ci[k] ? ` [${f1(ci[k]![0])}–${f1(ci[k]![1])}]` : ''}`)
      .join(' · ');
  const src: Record<string, number> = {};
  let tot = 0;
  for (const m of ms) {
    for (const [k, v] of Object.entries(m.r.pointsBySource)) src[k] = (src[k] ?? 0) + v;
    tot += m.totalPts;
  }
  const verbsCount: Record<string, number> = {};
  for (const m of proxy) for (const v of pc(m).verbs) verbsCount[v] = (verbsCount[v] ?? 0) + 1;
  const out: Record<string, string> = {
    group: name,
    n: String(n),
    'content / total value': `${[...new Set(ms.map((m) => m.r.content))].join('+')} / ${[...new Set(ms.map((m) => m.r.totalValue))].join(',')}`,
    'proxy first action med s (per map [95% CI])': proxy.length ? `${f1(N.proxyFirstActionMed!)} (${layCI(N.proxyFirstActionByLayout, N.proxyFirstActionCI)})` : '',
    'proxy first action by 10 s, share (per map)': proxy.length ? lay(N.proxyActBy10ByLayout, pct) : '',
    'proxy first score med s (per map [95% CI])': proxy.length ? `${f1(N.proxyFirstScoreMed!)} (${layCI(N.proxyFirstScoreByLayout, N.proxyFirstScoreCI)})` : '',
    'proxy dead time, payoff def (per map); payoff-or-holding; fun-plan def': proxy.length ? `${pct(N.deadPayoff!)} (${lay(N.deadPayoffByLayout, pct)}); ${pct(N.deadPayHold!)}; ${pct(N.deadOld!)}` : '',
    'longest no-score stretch med s': f0(N.longestDryMed),
    'drama events/min all / proxy-involved': `${f1(N.dramaPerMin)} / ${N.dramaProxyPerMin === null ? '-' : f1(N.dramaProxyPerMin)}`,
    '  coin bursts>=20 / item hits on chars+police / KOs (dash+item) / steals / launches / rec>=200 / event opens / jackpots per match': ['coinBurst', 'itemHitChar', 'ko', 'steal', 'launch', 'rec200', 'eventOpen', 'jackpot'].map((k) => f2(sumEv(k) / Math.max(1, n))).join(' / '),
    'proxy distinct verbs med (share of matches using each)': proxy.length ? `${f0(N.verbsMed!)} (${Object.entries(verbsCount).map(([k, v]) => `${k} ${pct(v / proxy.length)}`).join(', ')})` : '',
    'proxy distinct value sources med': proxy.length ? f0(N.sourcesMed!) : '',
    'bank share of points (mean)': pct(N.bankShare),
    'largest non-bank source share (pooled; bank group = bank + interior safes excluded)': `${N.largestNonBank.source} ${pct(N.largestNonBank.share)}`,
    'bank group share of points (bank + interior safes recovered on their own)': pct(N.bankGroupShare),
    'variety index: entropy of points over (source x transport mode), bits, mean': f2(N.varietyMean),
    'piggy: jackpots / hauled in intact / cracks, per match': `${f2(N.jackpotsPerMatch)} / ${f2(N.piggyIntactPerMatch)} / ${f2(sumEv('piggyCracks') / Math.max(1, n))}`,
    'points by source (pooled share; coins:<origin> = deposits)': Object.entries(src)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${pct(v / Math.max(1, tot))}`)
      .join(', '),
    'coin share of points; event-loot share': `${pct(N.coinShare)}; ${pct(N.eventShare)}`,
    'full 30 s countdown played; value on field at FC med': `${pct(N.fullCountdown)}; ${f0(N.valueAtFcMed)}`,
    'draws; lead changes/match': `${pct(N.draws)}; ${f2(N.leadChanges)}`,
    'proxy comeback wins / blowout losses / W / L': proxy.length ? `${pct(N.comebackWins!)} / ${pct(N.blowoutLosses!)} / ${pct(N.proxyW!)} / ${pct(N.proxyL!)}` : '',
    'match length med s; reaching 240 s': `${f0(N.lenMed)}; ${pct(N.reach240)}`,
    'police tackles/min; hammer KOs/min': `${f2(N.tacklesPerMin)}; ${f2(N.hammerKosPerMin)}`,
    'spills/match; spill piles re-taken by the other team/match; spill value/match': `${f2(N.spillsPerMatch)}; ${f2(N.spillRetakenPerMatch)}; ${f0(sumEv('spillValue') / Math.max(1, n))}`,
    'coin pickups/match; deposits/match; breakables broken/match': `${f1(sumEv('coinPickups') / Math.max(1, n))}; ${f2(sumEv('deposits') / Math.max(1, n))}; ${f2(sumEv('breakablesBroken') / Math.max(1, n))}`,
    'item pickups/match; uses/match; drops contested': `${f2(sumEv('itemPickups') / Math.max(1, n))}; ${f2(sumEv('itemUses') / Math.max(1, n))}; ${N.dropsContested === null ? '-' : pct(N.dropsContested)}`,
    'bot pickups used before expiry': N.botPickupsUsed === null ? '-' : pct(N.botPickupsUsed),
    'item uses per held-minute bot / proxy': `${N.itemUsesPerHeldMinBot === null ? '-' : f2(N.itemUsesPerHeldMinBot)} / ${N.itemUsesPerHeldMinProxy === null ? '-' : f2(N.itemUsesPerHeldMinProxy)}`,
    'gimmick uses/match bot / proxy': `${N.gimmickBot === null ? '-' : f2(N.gimmickBot)} / ${N.gimmickProxy === null ? '-' : f2(N.gimmickProxy)}`,
    'bot hammer KOs on proxy ÷ proxy hammer KOs on bots': N.hammerKoRatio === null ? '-' : f2(N.hammerKoRatio),
    'team-0 share of decided (mirror split) per map': lay(N.mirrorSplitByLayout, pct),
    'win-rate delta: held a hammer / got the golden hammer / won the first drop (pts)': [N.heldHammerDelta, N.goldHammerDelta, N.firstDropDelta].map((x) => (x === null ? '-' : f0(100 * x))).join(' / '),
    'golden hammer pickups/match; characters that held a hammer / the golden hammer': `${f2(sumEv('goldHammerPickups') / Math.max(1, n))}; ${pct(share(ms.flatMap((m) => m.r.chars), (c) => c.heldHammer))} / ${pct(share(ms.flatMap((m) => m.r.chars), (c) => c.gotGoldHammer))}`,
    'rematch-worthy (among decided)': `${pct(N.rematch)} (${pct(N.rematchDecided)})`,
    'crashes / invariant violations; sim step med ms': `${N.errors} / ${N.invariant}; ${N.stepMsMed.toFixed(3)}`,
  };
  return out;
}

function printRows(rows: Record<string, string>[]): string {
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const L: string[] = [];
  L.push(`| ${keys[0]} | ${rows.map((r) => r[keys[0]!] ?? '').join(' | ')} |`);
  L.push(`|---|${rows.map(() => '---').join('|')}|`);
  for (const k of keys.slice(1)) L.push(`| ${k} | ${rows.map((r) => r[k] ?? '').join(' | ')} |`);
  return L.join('\n');
}
// ---------------------------------------------------------------------------
// gates (content-plan §8, v2 everything on, P block unless noted)
// ---------------------------------------------------------------------------

/** One gate-table column: a variant's P / B / T2 numbers (+ the classic re-baseline, when known). */
interface Ctx {
  P: GroupNumbers;
  B: GroupNumbers | null;
  T2: GroupNumbers | null;
  base: Ctx | null;
}

interface Gate {
  metric: string;
  value: (c: Ctx) => number | null;
  /** 95% interval of the value (shown, and a gate verdict whose interval spans the bound is marked). */
  ci?: (c: Ctx) => [number, number] | null;
  /** Extra text after the value (e.g. which source / map). */
  note?: (c: Ctx) => string;
  fmt: (x: number) => string;
  gate: (x: number) => boolean;
  target: (x: number) => boolean;
  gateText: string;
  targetText: string;
  /** Only meaningful for v2 (coins / items / events). */
  v2Only?: boolean;
}

const finite = (o: Record<string, number>): [string, number][] => Object.entries(o).filter(([, v]) => Number.isFinite(v));
/** Worst (largest) map of a per-map record. */
const worstMap = (o: Record<string, number>): [string, number] | null => {
  const e = finite(o);
  if (!e.length) return null;
  return e.reduce((a, b) => (b[1] > a[1] ? b : a));
};
const ratio = (a: number | null, b: number | null): number | null => (a !== null && b !== null && b > 0 ? a / b : null);
const INFO = { gate: (): boolean => true, gateText: '–' };

const G: Gate[] = [
  {
    metric: 'Proxy first action, median, worst map (s) [95% CI of that map]',
    value: (c) => worstMap(c.P.proxyFirstActionByLayout)?.[1] ?? null,
    ci: (c) => c.P.proxyFirstActionCI[worstMap(c.P.proxyFirstActionByLayout)?.[0] ?? ''] ?? null,
    note: (c) => worstMap(c.P.proxyFirstActionByLayout)?.[0] ?? '',
    fmt: f1,
    gate: (x) => x <= 10,
    target: (x) => x <= 8,
    gateText: '≤ 10',
    targetText: '≤ 8',
  },
  {
    metric: 'Proxy first score, median, worst map (s) [95% CI of that map]',
    value: (c) => worstMap(c.P.proxyFirstScoreByLayout)?.[1] ?? null,
    ci: (c) => c.P.proxyFirstScoreCI[worstMap(c.P.proxyFirstScoreByLayout)?.[0] ?? ''] ?? null,
    note: (c) => worstMap(c.P.proxyFirstScoreByLayout)?.[0] ?? '',
    fmt: f1,
    gate: (x) => x <= 18,
    target: (x) => x <= 15,
    gateText: '≤ 18',
    targetText: '≤ 15',
  },
  { metric: 'Proxy dead time (payoff def)', value: (c) => c.P.deadPayoff, fmt: pct, gate: (x) => x <= 0.1, target: (x) => x <= 0.08, gateText: '≤ 10%', targetText: '≤ 8%' },
  { metric: 'Proxy dead time (info: payoff def, holding / straining loot counts as engaged)', value: (c) => c.P.deadPayHold, fmt: pct, ...INFO, target: (x) => x <= 0.08, targetText: '(≤ 8%)' },
  { metric: 'Proxy dead time (info: fun-plan def, neither holding nor contested)', value: (c) => c.P.deadOld, fmt: pct, ...INFO, target: (x) => x <= 0.1, targetText: '(fun plan ≤ 10%)' },
  { metric: 'Proxy dead time, worst map (payoff def)', value: (c) => worstMap(c.P.deadPayoffByLayout)?.[1] ?? null, note: (c) => worstMap(c.P.deadPayoffByLayout)?.[0] ?? '', fmt: pct, ...INFO, target: (x) => x <= 0.1, targetText: 'no map > 10%' },
  { metric: 'Longest no-score stretch, median (s)', value: (c) => c.P.longestDryMed, fmt: f0, gate: (x) => x <= 28, target: (x) => x <= 24, gateText: '≤ 28', targetText: '≤ 24' },
  { metric: 'Drama events / min (all)', value: (c) => c.P.dramaPerMin, fmt: f1, gate: (x) => x >= 4, target: (x) => x >= 6, gateText: '≥ 4', targetText: '≥ 6' },
  { metric: 'Drama events / min (proxy-involved)', value: (c) => c.P.dramaProxyPerMin, fmt: f1, gate: (x) => x >= 2, target: (x) => x >= 3, gateText: '≥ 2', targetText: '≥ 3' },
  { metric: 'Distinct verbs the proxy used (median)', value: (c) => c.P.verbsMed, fmt: f0, gate: (x) => x >= 5, target: (x) => x >= 6, gateText: '≥ 5', targetText: '≥ 6' },
  { metric: 'Distinct value sources the proxy scored from (median; bank group = 1)', value: (c) => c.P.sourcesMed, fmt: f0, gate: (x) => x >= 3, target: (x) => x >= 4, gateText: '≥ 3', targetText: '≥ 4' },
  { metric: 'Variety index ÷ classic (entropy of points over source × transport mode)', value: (c) => (c.base ? ratio(c.P.varietyMean, c.base.P.varietyMean) : null), note: (c) => `${f2(c.P.varietyMean)} bits`, fmt: (x) => `${f2(x)}×`, ...INFO, target: (x) => x >= 1.5, targetText: '≥ 1.5×' },
  { metric: 'Bank share of points (bank recoveries incl. loaded safes)', value: (c) => c.P.bankShare, fmt: pct, gate: (x) => x >= 0.3 && x <= 0.45, target: (x) => x >= 0.35 && x <= 0.42, gateText: '30–45%', targetText: '35–42%' },
  { metric: 'Bank group share (info: + interior safes recovered on their own)', value: (c) => c.P.bankGroupShare, fmt: pct, ...INFO, target: () => true, targetText: '–' },
  { metric: 'Largest single non-bank source share (bank group excluded)', value: (c) => c.P.largestNonBank.share, note: (c) => c.P.largestNonBank.source, fmt: pct, gate: (x) => x <= 0.25, target: (x) => x <= 0.2, gateText: '≤ 25%', targetText: '≤ 20%' },
  { metric: 'Coin share of points', value: (c) => c.P.coinShare, fmt: pct, gate: (x) => x >= 0.1 && x <= 0.28, target: (x) => x >= 0.12 && x <= 0.25, gateText: '10–28%', targetText: '12–25%', v2Only: true },
  { metric: 'Event-loot share of points (events on)', value: (c) => c.P.eventShare, fmt: pct, gate: (x) => x >= 0.06 && x <= 0.15, target: (x) => x >= 0.08 && x <= 0.12, gateText: '6–15%', targetText: '8–12%', v2Only: true },
  { metric: 'Full 30 s countdown played', value: (c) => c.P.fullCountdown, fmt: pct, gate: (x) => x >= 0.4, target: (x) => x >= 0.45, gateText: '≥ 40%', targetText: '≥ 45%' },
  { metric: 'Value on field at countdown, median', value: (c) => c.P.valueAtFcMed, fmt: f0, gate: (x) => x >= 400, target: (x) => x >= 500, gateText: '≥ 400', targetText: '≥ 500' },
  { metric: 'Draws, P', value: (c) => c.P.draws, fmt: pct, gate: (x) => x <= 0.09, target: (x) => x <= 0.07, gateText: '≤ 9%', targetText: '≤ 7%' },
  { metric: 'Draws, B', value: (c) => (c.B ? c.B.draws : null), fmt: pct, gate: (x) => x <= 0.09, target: (x) => x <= 0.07, gateText: '≤ 9%', targetText: '≤ 7%' },
  { metric: 'Lead changes per match', value: (c) => c.P.leadChanges, fmt: f2, gate: (x) => x >= 2.2, target: (x) => x >= 2.5, gateText: '≥ 2.2', targetText: '≥ 2.5' },
  { metric: 'Comeback wins (≥ 500)', value: (c) => c.P.comebackWins, fmt: pct, gate: (x) => x >= 0.12, target: (x) => x >= 0.16, gateText: '≥ 12%', targetText: '≥ 16%' },
  { metric: 'Blowout losses', value: (c) => c.P.blowoutLosses, fmt: pct, gate: (x) => x <= 0.08, target: (x) => x <= 0.05, gateText: '≤ 8%', targetText: '≤ 5%' },
  { metric: 'Match length median (s)', value: (c) => c.P.lenMed, fmt: f0, gate: (x) => x >= 140 && x <= 185, target: (x) => x >= 150 && x <= 175, gateText: '140–185', targetText: '150–175' },
  { metric: 'Matches reaching 240 s', value: (c) => c.P.reach240, fmt: pct, gate: (x) => x <= 0.15, target: (x) => x <= 0.1, gateText: '≤ 15%', targetText: '≤ 10%' },
  { metric: 'Police tackles per minute', value: (c) => c.P.tacklesPerMin, fmt: f2, gate: (x) => x <= 2.5, target: (x) => x <= 2.3, gateText: '≤ 2.5', targetText: '≤ 2.3' },
  { metric: 'Proxy tackled ≥ 5 times (fun-plan WP1 row)', value: (c) => c.P.proxyTackled5, fmt: pct, gate: (x) => x <= 0.26, target: (x) => x <= 0.22, gateText: '≤ 26%', targetText: '≤ 22%' },
  { metric: 'Proxy bank haul broken ≥ 4 times (info, fun-plan WP1)', value: (c) => c.P.proxyBankHaulBroken4, fmt: pct, ...INFO, target: () => true, targetText: '–' },
  { metric: 'Hammer KOs per minute (all)', value: (c) => c.P.hammerKosPerMin, fmt: f2, gate: (x) => x >= 0.4 && x <= 1.5, target: (x) => x >= 0.6 && x <= 1.2, gateText: '0.4–1.5', targetText: '0.6–1.2', v2Only: true },
  { metric: 'Spills per match', value: (c) => c.P.spillsPerMatch, fmt: f2, gate: (x) => x >= 2 && x <= 8, target: (x) => x >= 3 && x <= 6, gateText: '2–8', targetText: '3–6', v2Only: true },
  { metric: 'Spill piles re-taken by the other team / match', value: (c) => c.P.spillRetakenPerMatch, fmt: f2, gate: (x) => x >= 1, target: (x) => x >= 2, gateText: '≥ 1', targetText: '≥ 2', v2Only: true },
  { metric: 'Drops contested (both teams within 6 m)', value: (c) => c.P.dropsContested, fmt: pct, gate: (x) => x >= 0.25, target: (x) => x >= 0.35, gateText: '≥ 25%', targetText: '≥ 35%', v2Only: true },
  { metric: 'Bot item pickups used before expiry', value: (c) => c.P.botPickupsUsed, fmt: pct, gate: (x) => x >= 0.85, target: (x) => x >= 0.92, gateText: '≥ 85%', targetText: '≥ 92%', v2Only: true },
  { metric: 'Bot ÷ proxy item uses per held-minute', value: (c) => ratio(c.P.itemUsesPerHeldMinBot, c.P.itemUsesPerHeldMinProxy), fmt: f2, gate: (x) => x >= 0.75 && x <= 1.25, target: (x) => x >= 0.85 && x <= 1.15, gateText: '0.75–1.25', targetText: '0.85–1.15', v2Only: true },
  {
    metric: 'Bot ÷ proxy gimmick uses per match',
    value: (c) => ratio(c.P.gimmickBot, c.P.gimmickProxy),
    note: (c) => (c.P.gimmickProxy === 0 && c.P.gimmickBot === 0 ? 'no gimmick uses' : ''),
    fmt: f2,
    gate: (x) => x >= 0.8 && x <= 1.2,
    target: (x) => x >= 0.85 && x <= 1.15,
    gateText: '0.8–1.2',
    targetText: '0.85–1.15',
    v2Only: true,
  },
  { metric: 'Bot hammer KOs on proxy ÷ proxy hammer KOs on bots', value: (c) => c.P.hammerKoRatio, fmt: f2, gate: (x) => x <= 1.3, target: (x) => x >= 0.8 && x <= 1.2, gateText: '≤ 1.3', targetText: '0.8–1.2', v2Only: true },
  {
    metric: 'Mirror win split, worst map (B, |team-0 share of decided − 50|, pts)',
    value: (c) => (c.B ? Math.max(...finite(c.B.mirrorSplitByLayout).map(([, x]) => Math.abs(x - 0.5) * 100)) : null),
    note: (c) => {
      // binomial standard error at ~50%: tells whether ±3 is resolvable at this n
      if (!c.B) return '';
      const per = c.B.n / Math.max(1, Object.keys(c.B.mirrorSplitByLayout).length);
      return `SE ≈ ${f0(50 / Math.sqrt(Math.max(1, per)))} pts/map`;
    },
    fmt: f0,
    gate: (x) => x <= 3,
    target: (x) => x <= 2,
    gateText: '±3',
    targetText: '±2',
  },
  { metric: 'Win-rate delta, held a hammer (pts)', value: (c) => (c.P.heldHammerDelta === null ? null : 100 * c.P.heldHammerDelta), fmt: f0, gate: (x) => x <= 12, target: (x) => x <= 8, gateText: '≤ +12', targetText: '≤ +8', v2Only: true },
  { metric: 'Win-rate delta, got the golden hammer (pts)', value: (c) => (c.P.goldHammerDelta === null ? null : 100 * c.P.goldHammerDelta), fmt: f0, gate: (x) => x <= 15, target: (x) => x <= 10, gateText: '≤ +15', targetText: '≤ +10', v2Only: true },
  { metric: 'Win-rate delta, won the first drop (pts)', value: (c) => (c.P.firstDropDelta === null ? null : 100 * c.P.firstDropDelta), fmt: f0, gate: (x) => x <= 10, target: (x) => x <= 6, gateText: '≤ +10', targetText: '≤ +6', v2Only: true },
  { metric: 'Proxy wins vs normal', value: (c) => c.P.proxyW, fmt: pct, gate: (x) => x >= 0.32, target: (x) => x >= 0.35, gateText: '≥ 32%', targetText: '≥ 35%' },
  { metric: 'Rematch-worthy', value: (c) => c.P.rematch, fmt: pct, gate: (x) => x >= 0.78, target: (x) => x >= 0.82, gateText: '≥ 78%', targetText: '≥ 82%' },
  { metric: 'Rematch-worthy among decided matches (info: draws always count)', value: (c) => c.P.rematchDecided, note: (c) => `draws ${pct(c.P.draws)}; decided & rematch-worthy ${pct(c.P.rematchNonDraw)} of all`, fmt: pct, ...INFO, target: () => true, targetText: '–' },
  { metric: 'Crashes + invariant violations (P + B + T2)', value: (c) => c.P.errors + c.P.invariant, fmt: f0, gate: (x) => x === 0, target: (x) => x === 0, gateText: '0', targetText: '0' },
  { metric: 'Sim step median, 2:2 every system on (T2), ms', value: (c) => (c.T2 ? c.T2.stepMsMed : null), fmt: (x) => x.toFixed(3), gate: (x) => x <= 1.5, target: (x) => x <= 1.0, gateText: '≤ 1.5', targetText: '≤ 1.0' },
  { metric: 'Sim step median, 1v1 (info, P), ms', value: (c) => c.P.stepMsMed, fmt: (x) => x.toFixed(3), ...INFO, target: () => true, targetText: '–' },
];

type Status = 'target' | 'gate' | 'miss' | 'na' | 'none';

function gateStatus(g: Gate, c: Ctx, content: string): Status {
  const v = g.value(c);
  if (v === null || (!Number.isFinite(v) && v !== Infinity)) return 'none';
  if (g.v2Only && content !== 'v2') return 'na';
  return g.gate(v) ? (g.target(v) ? 'target' : 'gate') : 'miss';
}

function gateCell(g: Gate, c: Ctx, content: string): string {
  const v = g.value(c);
  const st = gateStatus(g, c, content);
  if (st === 'none') {
    const note = g.note?.(c);
    return note ? `– (${note})` : '–';
  }
  const ci = g.ci?.(c) ?? null;
  const note = g.note?.(c);
  let s = g.fmt(v!);
  if (ci) s += ` [${g.fmt(ci[0])}–${g.fmt(ci[1])}]`;
  if (note) s += ` (${note})`;
  if (st === 'na') return `${s} (n/a)`;
  if (g.gateText === '–' && g.targetText === '–') return s; // pure info row: no verdict
  s += ` ${st === 'target' ? '✔✔' : st === 'gate' ? '✔' : '✘'}`;
  // an interval that reaches across the gate bound: the verdict is not resolved at this n
  if (ci && g.gate(ci[0]) !== g.gate(ci[1])) s += ' (CI spans gate)';
  return s;
}

function gateTable(cols: { name: string; ctx: Ctx; content: string }[], baseline: Ctx | null): string {
  const head = ['metric', ...(baseline ? ['classic re-baseline'] : []), ...cols.map((c) => c.name), 'gate (must)', 'target'];
  const L = [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`];
  for (const g of G) {
    const cells: string[] = [g.metric];
    if (baseline) {
      const v = g.value(baseline);
      const note = g.note?.(baseline);
      cells.push(v === null || !Number.isFinite(v) ? '–' : `${g.fmt(v)}${note ? ` (${note})` : ''}`);
    }
    for (const c of cols) cells.push(gateCell(g, c.ctx, c.content));
    cells.push(g.gateText, g.targetText);
    L.push(`| ${cells.join(' | ')} |`);
  }
  L.push('');
  L.push('✔ = gate met, ✔✔ = target met too, ✘ = gate missed. (n/a) = metric only meaningful with content v2. Rows marked "info" have no §8 gate. [a–b] = 95% bootstrap interval; "(CI spans gate)" = the verdict flips inside the interval, so it is not resolved at this sample size.');
  // gate status changes against the reference column (the first v2 column)
  const ref = cols.find((c) => c.content === 'v2');
  if (ref && cols.length > 1) {
    const rank: Record<Status, number> = { target: 2, gate: 1, miss: 0, na: -1, none: -1 };
    L.push('');
    L.push(`**Gate changes vs \`${ref.name}\`** (must-gate regressions first):`);
    L.push('');
    for (const c of cols) {
      if (c === ref) continue;
      const reg: string[] = [];
      const lost: string[] = [];
      const fixed: string[] = [];
      for (const g of G) {
        if (g.gateText === '–') continue;
        const a = gateStatus(g, ref.ctx, ref.content);
        const b = gateStatus(g, c.ctx, c.content);
        if (rank[a] < 0 || rank[b] < 0 || a === b) continue;
        const va = g.fmt(g.value(ref.ctx)!);
        const vb = g.fmt(g.value(c.ctx)!);
        const line = `${g.metric}: ${va} → ${vb} (gate ${g.gateText})`;
        if (a !== 'miss' && b === 'miss') reg.push(line);
        else if (a === 'target' && b === 'gate') lost.push(line);
        else if (rank[b] > rank[a]) fixed.push(line);
      }
      L.push(`- \`${c.name}\`: ${reg.length ? `**REGRESSION (passing gate now fails): ${reg.join('; ')}**` : 'no must-gate regression'}${lost.length ? `; target lost: ${lost.join('; ')}` : ''}${fixed.length ? `; improved: ${fixed.join('; ')}` : ''}.`);
    }
  }
  return L.join('\n');
}

// ---------------------------------------------------------------------------
// per-item table, feature reach (watch list), paired lever comparison
// ---------------------------------------------------------------------------

/** content-plan §8 "per item": uses, hits, KOs, win delta, hold time; weakest first. */
function itemTable(ms: M[]): string {
  const chars = ms.flatMap((m) => m.r.chars.map((c) => ({ c, win: m.r.winner === null ? 0.5 : m.r.winner === c.team ? 1 : 0 })));
  const kinds = [...new Set(chars.flatMap((x) => Object.keys(x.c.items ?? {})))];
  if (!kinds.length) return '';
  const n = Math.max(1, ms.length);
  const rows = kinds.map((k) => {
    const st = chars.map((x) => x.c.items?.[k]).filter((s): s is NonNullable<typeof s> => !!s);
    const sum = (f: (s: (typeof st)[number]) => number): number => st.reduce((a, s) => a + f(s), 0);
    const pickups = sum((s) => s.pickups);
    const uses = sum((s) => s.uses);
    const hits = sum((s) => s.hits);
    const kos = sum((s) => s.kos);
    const held = sum((s) => s.heldTicks);
    const a = chars.filter((x) => (x.c.items?.[k]?.heldTicks ?? 0) > 0);
    const b = chars.filter((x) => (x.c.items?.[k]?.heldTicks ?? 0) === 0);
    const wd = a.length >= 30 && b.length >= 30 ? 100 * (mean(a.map((x) => x.win)) - mean(b.map((x) => x.win))) : NaN;
    return { k, pickups, uses, hits, kos, held, wd, heldShare: a.length / Math.max(1, chars.length), hitsPerPickup: pickups ? hits / pickups : 0 };
  });
  rows.sort((x, y) => x.hitsPerPickup - y.hitsPerPickup);
  const L = ['| item (weakest first: hits per pickup) | pickups/match | uses/match | hits on chars+police/match | KOs/match | hits per use | avg hold per pickup s | characters holding it | win delta held vs not (pts) |', '|---|---|---|---|---|---|---|---|---|'];
  for (const r of rows)
    L.push(`| ${r.k} | ${f2(r.pickups / n)} | ${f2(r.uses / n)} | ${f2(r.hits / n)} | ${f2(r.kos / n)} | ${r.uses ? f2(r.hits / r.uses) : '-'} | ${r.pickups ? f1(r.held / T / r.pickups) : '-'} | ${pct(r.heldShare)} | ${Number.isFinite(r.wd) ? f0(r.wd) : '- (< 30 per group)'} |`);
  return L.join('\n');
}

/** Share of matches in which each headline feature happened; RARE = under 10% of matches. */
function featureReach(ms: M[]): string {
  const P = ms.filter((m) => m.proxyResult !== null);
  const verb = (v: string) => (m: M): boolean => m.r.chars.find((c) => c.id === m.r.proxyId)?.verbs.includes(v as never) ?? false;
  const ev = (k: string) => (m: M): boolean => (m.r.ev[k] ?? 0) > 0;
  const feats: [string, (m: M) => boolean, M[], string][] = [
    ['돼지 잭팟 (piggy smashed open)', ev('jackpot'), ms, 'C6 bot use (props goal: kickPiggy smash only when contested with 2 cracks, never while holding a hammer) / C3 piggy rules'],
    ['piggy hauled in intact', ev('piggyIntact'), ms, ''],
    ['piggy cracked at least once', ev('piggyCracks'), ms, ''],
    ['proxy tug-spurt (ATM coins while uprooting)', verb('tugSpurt'), P, ''],
    ['proxy kicked the piggy', verb('kick'), P, ''],
    ['golden hammer picked up', ev('goldHammerPickups'), ms, ''],
    ['spill pile re-taken by the other team', ev('spillRetakenN'), ms, ''],
    ['steal (bank unloaded by an opponent)', ev('steal'), ms, ''],
    ['gimmick launch (toss / tube / crane)', ev('launch'), ms, 'wave 2 (C4)'],
    ['event opened', ev('eventOpen'), ms, 'wave 2 (C5)'],
  ];
  const L = ['| feature | matches where it happened | per match | flag |', '|---|---|---|---|'];
  for (const [name, f, set, owner] of feats) {
    if (!set.length) continue;
    const sh = share(set, f);
    const flag = sh < 0.1 ? `**RARE**${owner ? ` → ${owner}` : ''}` : '';
    const key = name.startsWith('돼지') ? 'jackpot' : name.startsWith('piggy hauled') ? 'piggyIntact' : name.startsWith('piggy cracked') ? 'piggyCracks' : name.startsWith('golden') ? 'goldHammerPickups' : name.startsWith('spill') ? 'spillRetakenN' : name.startsWith('steal') ? 'steal' : name.startsWith('gimmick') ? 'launch' : name.startsWith('event') ? 'eventOpen' : '';
    const per = key ? f2(set.reduce((a, m) => a + (m.r.ev[key] ?? 0), 0) / set.length) : '-';
    L.push(`| ${name} | ${Number.isFinite(sh) ? `${(100 * sh).toFixed(1)}%` : '-'} | ${per} | ${flag} |`);
  }
  return L.join('\n');
}

/** Per-match metrics for the paired comparison (null = not defined for this match). */
const PAIRED: [string, 'all' | 'P', (m: M) => number | null][] = [
  ['match length s', 'all', (m) => m.lenS],
  ['reached 240 s', 'all', (m) => (m.r.endTick >= 240 * T - 1 ? 1 : 0)],
  ['full 30 s countdown (both reached FC)', 'all', (m) => (m.r.fcTick === null ? null : m.r.endTick - m.r.fcTick >= 25 * T ? 1 : 0)],
  ['value on field at FC (both reached FC)', 'all', (m) => m.r.valueAtFc],
  ['spills / match', 'all', (m) => m.r.ev.spill ?? 0],
  ['spill piles re-taken / match', 'all', (m) => m.r.ev.spillRetakenN ?? 0],
  ['police tackles / match', 'all', (m) => m.r.ev.tackle ?? 0],
  ['hammer KOs / match', 'all', (m) => m.r.ev.hammerKo ?? 0],
  ['lead changes', 'all', (m) => m.leadChanges],
  ['bank share of points', 'all', (m) => (m.totalPts > 0 ? m.bankShare : null)],
  ['coin share of points', 'all', (m) => (m.totalPts > 0 ? m.r.coinPoints / m.totalPts : null)],
  ['rematch-worthy', 'all', (m) => (m.rematchWorthy ? 1 : 0)],
  ['proxy win', 'P', (m) => (m.proxyResult === 'W' ? 1 : 0)],
  ['proxy blowout loss', 'P', (m) => (m.proxyResult === 'L' && m.blowout ? 1 : 0)],
  ['proxy first action s', 'P', (m) => (m.r.chars.find((c) => c.id === m.r.proxyId)?.firstActionTick ?? m.r.endTick) / T],
  ['proxy first score s', 'P', (m) => (m.r.chars.find((c) => c.id === m.r.proxyId)?.firstScoreTick ?? m.r.endTick) / T],
];

const pairKey = (r: FunRec): string => `${r.block}|${r.layout}|${r.group}|${r.seed}|${r.aTeam}`;

/** Paired-by-seed deltas of each variant against a reference variant (same blocks / seeds / sides). */
function pairedTable(ref: M[], other: M[]): string {
  const byKey = new Map(ref.map((m) => [pairKey(m.r), m]));
  const pairs = other.map((m) => [byKey.get(pairKey(m.r)), m] as const).filter((p): p is readonly [M, M] => p[0] !== undefined);
  if (pairs.length < 10) return `(only ${pairs.length} paired matches; run both variants with the same seeds)`;
  const L = ['| metric (paired by block / map / rival / seed / side) | pairs | reference | variant | Δ [95% CI] | |', '|---|---|---|---|---|---|'];
  for (const [name, scope, f] of PAIRED) {
    const a: number[] = [];
    const b: number[] = [];
    for (const [x, y] of pairs) {
      if (scope === 'P' && x.r.block !== 'P') continue;
      const u = f(x);
      const v = f(y);
      if (u === null || v === null || !Number.isFinite(u) || !Number.isFinite(v)) continue;
      a.push(u);
      b.push(v);
    }
    const d = pairedDiff(b.map((v, i) => v - a[i]!));
    if (!d) continue;
    // 0/1 and share metrics print as percent (points for the delta)
    const isShare = name.startsWith('reached') || name.startsWith('full') || name.includes('share') || name.startsWith('rematch') || name === 'proxy win' || name.startsWith('proxy blowout');
    const fm = (x: number): string => (isShare ? `${(100 * x).toFixed(1)}%` : f2(x));
    const sig = d.lo > 0 || d.hi < 0 ? 'significant' : '';
    L.push(`| ${name} | ${d.n} | ${fm(mean(a))} | ${fm(mean(b))} | ${fm(d.mean)} [${fm(d.lo)}, ${fm(d.hi)}] | ${sig} |`);
  }
  return L.join('\n');
}

// ---------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------

export interface FunReportOptions {
  /** Content block (§8) on top of the fun block. */
  content: boolean;
  title?: string;
  /** Variant the paired comparison and the gate-change list are measured against (default: first v2 variant). */
  ref?: string;
}

/** Build the scorecard markdown for a set of records (several variants / blocks allowed). */
export function funReport(recs: FunRec[], opts: FunReportOptions): string {
  const ok = recs.filter((r) => !r.error);
  const errs = recs.filter((r) => r.error);
  const all = ok.map(analyze);
  const variants = [...new Set(recs.map((r) => r.variant))];
  const L: string[] = [];
  L.push(`## ${opts.title ?? 'Fun / content scorecard'}`);
  L.push('');
  L.push(`Records ${recs.length}, crashes ${errs.length}, invariant violations ${ok.reduce((a, r) => a + r.invariantViolations, 0)}. Variants: ${variants.join(', ')}.`);
  for (const e of errs.slice(0, 10)) L.push(`- CRASH ${e.block} ${e.layout} seed ${e.seed} ${e.group}: ${String(e.error).split('\n')[0]}`);
  L.push('');
  const pick = (v: string, b: string, layout?: string, label?: string): M[] => all.filter((m) => m.r.variant === v && m.r.block === b && (!layout || m.r.layout === layout) && (!label || m.r.group.endsWith(label)));
  for (const v of variants) {
    const layouts = [...new Set(all.filter((m) => m.r.variant === v).map((m) => m.r.layout))];
    const blocks = [...new Set(all.filter((m) => m.r.variant === v).map((m) => m.r.block))];
    const main: Record<string, string>[] = [];
    const det: Record<string, string>[] = [];
    const cmain: Record<string, string>[] = [];
    const cdet: Record<string, string>[] = [];
    for (const b of blocks) {
      const ms = pick(v, b);
      if (!ms.length) continue;
      main.push(funRow(`${b} all`, ms));
      if (opts.content) cmain.push(contentRow(`${b} all`, ms));
      for (const l of layouts) {
        const lm = pick(v, b, l);
        if (!lm.length) continue;
        det.push(funRow(`${b} ${l}`, lm));
        if (opts.content) cdet.push(contentRow(`${b} ${l}`, lm));
      }
      if (b === 'P')
        for (const r of ['hodadak', 'tongkeun', 'nunchi']) {
          const rm = pick(v, b, undefined, r);
          if (rm.length) det.push(funRow(`P vs ${r}`, rm));
        }
    }
    L.push(`### Variant \`${v}\`: fun block (fun-plan §5 / WP1)`);
    L.push('');
    L.push(printRows(main));
    L.push('');
    L.push(printRows(det));
    L.push('');
    if (opts.content) {
      L.push(`### Variant \`${v}\`: content block (content-plan §8)`);
      L.push('');
      L.push(printRows(cmain));
      L.push('');
      L.push(printRows(cdet));
      L.push('');
      const vAll = all.filter((m) => m.r.variant === v);
      if (vAll[0]?.r.content === 'v2') {
        const it = itemTable(vAll);
        if (it) {
          L.push(`#### \`${v}\`: per item (P + B + T2 pooled)`);
          L.push('');
          L.push(it);
          L.push('');
        }
        L.push(`#### \`${v}\`: feature reach / watch list (P + B + T2 pooled; proxy verbs from P)`);
        L.push('');
        L.push(featureReach(vAll));
        L.push('');
      }
    }
  }
  // gate table: one column per variant (P + B), classic baseline when present
  const cols = variants
    .map((v) => {
      const P = pick(v, 'P');
      if (!P.length) return null;
      const B = pick(v, 'B');
      const T2 = pick(v, 'T2');
      const Pn = numbers(P);
      // stability gate counts P + B + T2
      const stab = numbers([...P, ...B, ...T2]);
      Pn.errors = errs.filter((r) => r.variant === v).length;
      Pn.invariant = stab.invariant;
      const ctx: Ctx = { P: Pn, B: B.length ? numbers(B) : null, T2: T2.length ? numbers(T2) : null, base: null };
      return { name: v, ctx, content: P[0]!.r.content };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  const base = cols.find((c) => c.content === 'classic') ?? null;
  const withBase = base && cols.length > 1;
  if (withBase) for (const c of cols) if (c !== base) c.ctx.base = base.ctx;
  if (cols.length) {
    L.push('### Gates (content-plan §8; P block unless noted)');
    L.push('');
    L.push(gateTable(withBase ? cols.filter((c) => c !== base) : cols, withBase ? base.ctx : null));
    L.push('');
  }
  // paired lever comparison against the reference variant
  const refName = opts.ref ?? cols.find((c) => c.content === 'v2')?.name ?? null;
  if (refName) {
    const ref = all.filter((m) => m.r.variant === refName && m.r.block !== 'T2');
    const others = variants.filter((v) => v !== refName && all.some((m) => m.r.variant === v && m.r.content === ref[0]?.r.content));
    for (const v of others) {
      L.push(`### Paired comparison: \`${v}\` vs \`${refName}\` (P + B; proxy rows P only)`);
      L.push('');
      L.push(pairedTable(ref, all.filter((m) => m.r.variant === v && m.r.block !== 'T2')));
      L.push('');
    }
  }
  return L.join('\n');
}
