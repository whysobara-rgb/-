/**
 * Fun / content scorecard: aggregation and markdown (C11; content-plan §8, fun-plan §3 WP1 / §5).
 *
 * Port of `fun/metrics/agg.ts` + `extra.py` + `fun/moment/exp/mp.py`, plus the Content 2.0 block.
 * Input: `FunRec[]` from tools/fun/collect.ts. Output: markdown tables (one column per group) and a
 * gate table against content-plan §8 with the classic re-baseline column when classic records are
 * part of the same run (or passed as `baseline`).
 */
import type { FunRec, Source } from './collect';

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
const f0 = (x: number): string => (Number.isFinite(x) ? x.toFixed(0) : '-');
const share = <X>(ms: X[], p: (m: X) => boolean): number => (ms.length ? ms.filter(p).length / ms.length : NaN);
const sign = (x: number): number => (x > 0 ? 1 : x < 0 ? -1 : 0);

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
  };
}

// ---------------------------------------------------------------------------
// group metrics (numbers) — shared by the tables and the gates
// ---------------------------------------------------------------------------

/** Value sources merged shell + coins by origin (content-plan §8 shares). */
const SHARE_SOURCES: Source[] = ['bank', 'largeSafe', 'smallSafe', 'atm', 'piggy', 'moneyTree', 'breakable', 'event'];

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
    if (s === 'bank') continue;
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
    if (a.length < 5 || b.length < 5) return null;
    return mean(a.map((x) => x.win)) - mean(b.map((x) => x.win));
  };
  const fd = ms.filter((m) => m.r.firstDropTeam !== null);
  const mirror: Record<string, number> = {};
  for (const l of layouts) {
    const lm = ms.filter((m) => m.r.layout === l && m.r.winner !== null);
    mirror[l] = lm.length ? lm.filter((m) => m.r.winner === 0).length / lm.length : NaN;
  }
  const early = ms.filter((m) => m.mpLeadS !== null);
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
    firstDropDelta: fd.length >= 5 ? mean(fd.map((m) => (m.r.winner === null ? 0.5 : m.r.winner === m.r.firstDropTeam ? 1 : 0))) - 0.5 : null,
    stepMsMed: q(ms.map((m) => m.r.stepMsMed), 0.5),
    mpWarned: early.length ? share(early, (m) => (m.mpLeadS ?? 0) >= 3) : NaN,
    mpDeniedPerMatch: mean(ms.map((m) => m.mpDenied)),
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
    'proxy first action med s (per map)': proxy.length ? `${f1(N.proxyFirstActionMed!)} (${lay(N.proxyFirstActionByLayout, f1)})` : '',
    'proxy first score med s (per map)': proxy.length ? `${f1(N.proxyFirstScoreMed!)} (${lay(N.proxyFirstScoreByLayout, f1)})` : '',
    'proxy dead time, payoff def (per map); payoff-or-holding; fun-plan def': proxy.length ? `${pct(N.deadPayoff!)} (${lay(N.deadPayoffByLayout, pct)}); ${pct(N.deadPayHold!)}; ${pct(N.deadOld!)}` : '',
    'longest no-score stretch med s': f0(N.longestDryMed),
    'drama events/min all / proxy-involved': `${f1(N.dramaPerMin)} / ${N.dramaProxyPerMin === null ? '-' : f1(N.dramaProxyPerMin)}`,
    '  coin bursts>=20 / item hits on chars+police / KOs (dash+item) / steals / launches / rec>=200 / event opens / jackpots per match': ['coinBurst', 'itemHitChar', 'ko', 'steal', 'launch', 'rec200', 'eventOpen', 'jackpot'].map((k) => f2(sumEv(k) / Math.max(1, n))).join(' / '),
    'proxy distinct verbs med (share of matches using each)': proxy.length ? `${f0(N.verbsMed!)} (${Object.entries(verbsCount).map(([k, v]) => `${k} ${pct(v / proxy.length)}`).join(', ')})` : '',
    'proxy distinct value sources med': proxy.length ? f0(N.sourcesMed!) : '',
    'bank share of points (mean)': pct(N.bankShare),
    'largest non-bank source share (pooled)': `${N.largestNonBank.source} ${pct(N.largestNonBank.share)}`,
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
    'rematch-worthy': pct(N.rematch),
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

interface Gate {
  metric: string;
  value: (P: GroupNumbers, B: GroupNumbers | null) => number | null;
  fmt: (x: number) => string;
  gate: (x: number) => boolean;
  target: (x: number) => boolean;
  gateText: string;
  targetText: string;
  /** Only meaningful for v2 (coins / items / events). */
  v2Only?: boolean;
}

const maxOf = (o: Record<string, number>): number => Math.max(...Object.values(o).filter(Number.isFinite));
const G: Gate[] = [
  { metric: 'Proxy first action, median, worst map (s)', value: (P) => (Object.keys(P.proxyFirstActionByLayout).length ? maxOf(P.proxyFirstActionByLayout) : null), fmt: f1, gate: (x) => x <= 10, target: (x) => x <= 8, gateText: '≤ 10', targetText: '≤ 8' },
  { metric: 'Proxy first score, median, worst map (s)', value: (P) => (Object.keys(P.proxyFirstScoreByLayout).length ? maxOf(P.proxyFirstScoreByLayout) : null), fmt: f1, gate: (x) => x <= 18, target: (x) => x <= 15, gateText: '≤ 18', targetText: '≤ 15' },
  { metric: 'Proxy dead time (payoff def)', value: (P) => P.deadPayoff, fmt: pct, gate: (x) => x <= 0.1, target: (x) => x <= 0.08, gateText: '≤ 10%', targetText: '≤ 8%' },
  { metric: 'Proxy dead time (info: payoff def, holding / straining loot counts as engaged)', value: (P) => P.deadPayHold, fmt: pct, gate: () => true, target: (x) => x <= 0.08, gateText: '–', targetText: '(≤ 8%)' },
  { metric: 'Proxy dead time (info: fun-plan def, neither holding nor contested)', value: (P) => P.deadOld, fmt: pct, gate: () => true, target: (x) => x <= 0.1, gateText: '–', targetText: '(fun plan ≤ 10%)' },
  { metric: 'Proxy dead time, worst map (payoff def)', value: (P) => (Object.keys(P.deadPayoffByLayout).length ? maxOf(P.deadPayoffByLayout) : null), fmt: pct, gate: () => true, target: (x) => x <= 0.1, gateText: '–', targetText: 'no map > 10%' },
  { metric: 'Longest no-score stretch, median (s)', value: (P) => P.longestDryMed, fmt: f0, gate: (x) => x <= 28, target: (x) => x <= 24, gateText: '≤ 28', targetText: '≤ 24' },
  { metric: 'Drama events / min (all)', value: (P) => P.dramaPerMin, fmt: f1, gate: (x) => x >= 4, target: (x) => x >= 6, gateText: '≥ 4', targetText: '≥ 6' },
  { metric: 'Drama events / min (proxy-involved)', value: (P) => P.dramaProxyPerMin, fmt: f1, gate: (x) => x >= 2, target: (x) => x >= 3, gateText: '≥ 2', targetText: '≥ 3' },
  { metric: 'Distinct verbs the proxy used (median)', value: (P) => P.verbsMed, fmt: f0, gate: (x) => x >= 5, target: (x) => x >= 6, gateText: '≥ 5', targetText: '≥ 6' },
  { metric: 'Distinct value sources the proxy scored from (median)', value: (P) => P.sourcesMed, fmt: f0, gate: (x) => x >= 3, target: (x) => x >= 4, gateText: '≥ 3', targetText: '≥ 4' },
  { metric: 'Bank share of points', value: (P) => P.bankShare, fmt: pct, gate: (x) => x >= 0.3 && x <= 0.45, target: (x) => x >= 0.35 && x <= 0.42, gateText: '30–45%', targetText: '35–42%' },
  { metric: 'Largest single non-bank source share', value: (P) => P.largestNonBank.share, fmt: pct, gate: (x) => x <= 0.25, target: (x) => x <= 0.2, gateText: '≤ 25%', targetText: '≤ 20%' },
  { metric: 'Coin share of points', value: (P) => P.coinShare, fmt: pct, gate: (x) => x >= 0.1 && x <= 0.28, target: (x) => x >= 0.12 && x <= 0.25, gateText: '10–28%', targetText: '12–25%', v2Only: true },
  { metric: 'Event-loot share of points (events on)', value: (P) => P.eventShare, fmt: pct, gate: (x) => x >= 0.06 && x <= 0.15, target: (x) => x >= 0.08 && x <= 0.12, gateText: '6–15%', targetText: '8–12%', v2Only: true },
  { metric: 'Full 30 s countdown played', value: (P) => P.fullCountdown, fmt: pct, gate: (x) => x >= 0.4, target: (x) => x >= 0.45, gateText: '≥ 40%', targetText: '≥ 45%' },
  { metric: 'Value on field at countdown, median', value: (P) => P.valueAtFcMed, fmt: f0, gate: (x) => x >= 400, target: (x) => x >= 500, gateText: '≥ 400', targetText: '≥ 500' },
  { metric: 'Draws, P', value: (P) => P.draws, fmt: pct, gate: (x) => x <= 0.09, target: (x) => x <= 0.07, gateText: '≤ 9%', targetText: '≤ 7%' },
  { metric: 'Draws, B', value: (_P, B) => (B ? B.draws : null), fmt: pct, gate: (x) => x <= 0.09, target: (x) => x <= 0.07, gateText: '≤ 9%', targetText: '≤ 7%' },
  { metric: 'Lead changes per match', value: (P) => P.leadChanges, fmt: f2, gate: (x) => x >= 2.2, target: (x) => x >= 2.5, gateText: '≥ 2.2', targetText: '≥ 2.5' },
  { metric: 'Comeback wins (≥ 500)', value: (P) => P.comebackWins, fmt: pct, gate: (x) => x >= 0.12, target: (x) => x >= 0.16, gateText: '≥ 12%', targetText: '≥ 16%' },
  { metric: 'Blowout losses', value: (P) => P.blowoutLosses, fmt: pct, gate: (x) => x <= 0.08, target: (x) => x <= 0.05, gateText: '≤ 8%', targetText: '≤ 5%' },
  { metric: 'Match length median (s)', value: (P) => P.lenMed, fmt: f0, gate: (x) => x >= 140 && x <= 185, target: (x) => x >= 150 && x <= 175, gateText: '140–185', targetText: '150–175' },
  { metric: 'Matches reaching 240 s', value: (P) => P.reach240, fmt: pct, gate: (x) => x <= 0.15, target: (x) => x <= 0.1, gateText: '≤ 15%', targetText: '≤ 10%' },
  { metric: 'Police tackles per minute', value: (P) => P.tacklesPerMin, fmt: f2, gate: (x) => x <= 2.5, target: (x) => x <= 2.3, gateText: '≤ 2.5', targetText: '≤ 2.3' },
  { metric: 'Hammer KOs per minute (all)', value: (P) => P.hammerKosPerMin, fmt: f2, gate: (x) => x >= 0.4 && x <= 1.5, target: (x) => x >= 0.6 && x <= 1.2, gateText: '0.4–1.5', targetText: '0.6–1.2', v2Only: true },
  { metric: 'Spills per match', value: (P) => P.spillsPerMatch, fmt: f2, gate: (x) => x >= 2 && x <= 8, target: (x) => x >= 3 && x <= 6, gateText: '2–8', targetText: '3–6', v2Only: true },
  { metric: 'Spill piles re-taken by the other team / match', value: (P) => P.spillRetakenPerMatch, fmt: f2, gate: (x) => x >= 1, target: (x) => x >= 2, gateText: '≥ 1', targetText: '≥ 2', v2Only: true },
  { metric: 'Drops contested (both teams within 6 m)', value: (P) => P.dropsContested, fmt: pct, gate: (x) => x >= 0.25, target: (x) => x >= 0.35, gateText: '≥ 25%', targetText: '≥ 35%', v2Only: true },
  { metric: 'Bot item pickups used before expiry', value: (P) => P.botPickupsUsed, fmt: pct, gate: (x) => x >= 0.85, target: (x) => x >= 0.92, gateText: '≥ 85%', targetText: '≥ 92%', v2Only: true },
  { metric: 'Bot ÷ proxy item uses per held-minute', value: (P) => (P.itemUsesPerHeldMinBot !== null && P.itemUsesPerHeldMinProxy ? P.itemUsesPerHeldMinBot / P.itemUsesPerHeldMinProxy : null), fmt: f2, gate: (x) => x >= 0.75 && x <= 1.25, target: (x) => x >= 0.85 && x <= 1.15, gateText: '0.75–1.25', targetText: '0.85–1.15', v2Only: true },
  { metric: 'Bot hammer KOs on proxy ÷ proxy hammer KOs on bots', value: (P) => P.hammerKoRatio, fmt: f2, gate: (x) => x <= 1.3, target: (x) => x >= 0.8 && x <= 1.2, gateText: '≤ 1.3', targetText: '0.8–1.2', v2Only: true },
  { metric: 'Mirror win split, worst map (B, team-0 share of decided − 50, pts)', value: (_P, B) => (B ? Math.max(...Object.values(B.mirrorSplitByLayout).filter(Number.isFinite).map((x) => Math.abs(x - 0.5) * 100)) : null), fmt: f0, gate: (x) => x <= 3, target: (x) => x <= 2, gateText: '±3', targetText: '±2' },
  { metric: 'Win-rate delta, held a hammer (pts)', value: (P) => (P.heldHammerDelta === null ? null : 100 * P.heldHammerDelta), fmt: f0, gate: (x) => x <= 12, target: (x) => x <= 8, gateText: '≤ +12', targetText: '≤ +8', v2Only: true },
  { metric: 'Win-rate delta, got the golden hammer (pts)', value: (P) => (P.goldHammerDelta === null ? null : 100 * P.goldHammerDelta), fmt: f0, gate: (x) => x <= 15, target: (x) => x <= 10, gateText: '≤ +15', targetText: '≤ +10', v2Only: true },
  { metric: 'Win-rate delta, won the first drop (pts)', value: (P) => (P.firstDropDelta === null ? null : 100 * P.firstDropDelta), fmt: f0, gate: (x) => x <= 10, target: (x) => x <= 6, gateText: '≤ +10', targetText: '≤ +6', v2Only: true },
  { metric: 'Proxy wins vs normal', value: (P) => P.proxyW, fmt: pct, gate: (x) => x >= 0.32, target: (x) => x >= 0.35, gateText: '≥ 32%', targetText: '≥ 35%' },
  { metric: 'Rematch-worthy', value: (P) => P.rematch, fmt: pct, gate: (x) => x >= 0.78, target: (x) => x >= 0.82, gateText: '≥ 78%', targetText: '≥ 82%' },
  { metric: 'Crashes + invariant violations (P + B + T2)', value: (P) => P.errors + P.invariant, fmt: f0, gate: (x) => x === 0, target: (x) => x === 0, gateText: '0', targetText: '0' },
  { metric: 'Sim step median, ms', value: (P) => P.stepMsMed, fmt: (x) => x.toFixed(3), gate: (x) => x <= 1.5, target: (x) => x <= 1.0, gateText: '≤ 1.5', targetText: '≤ 1.0' },
];

function gateTable(cols: { name: string; P: GroupNumbers; B: GroupNumbers | null; content: string }[], baseline: { P: GroupNumbers; B: GroupNumbers | null } | null): string {
  const head = ['metric', ...(baseline ? ['classic re-baseline'] : []), ...cols.map((c) => c.name), 'gate (must)', 'target'];
  const L = [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`];
  for (const g of G) {
    const cells: string[] = [g.metric];
    if (baseline) {
      const v = g.value(baseline.P, baseline.B);
      cells.push(v === null || !Number.isFinite(v) ? '–' : g.fmt(v));
    }
    for (const c of cols) {
      const v = g.value(c.P, c.B);
      if (v === null || (!Number.isFinite(v) && v !== Infinity)) cells.push('–');
      else if (g.v2Only && c.content !== 'v2') cells.push(`${g.fmt(v)} (n/a)`);
      else cells.push(`${g.fmt(v)} ${g.gate(v) ? (g.target(v) ? '✔✔' : '✔') : '✘'}`);
    }
    cells.push(g.gateText, g.targetText);
    L.push(`| ${cells.join(' | ')} |`);
  }
  L.push('');
  L.push('✔ = gate met, ✔✔ = target met too, ✘ = gate missed. (n/a) = metric only meaningful with content v2.');
  return L.join('\n');
}

// ---------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------

export interface FunReportOptions {
  /** Content block (§8) on top of the fun block. */
  content: boolean;
  title?: string;
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
      return { name: v, P: Pn, B: B.length ? numbers(B) : null, content: P[0]!.r.content };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  const base = cols.find((c) => c.content === 'classic') ?? null;
  if (cols.length) {
    L.push('### Gates (content-plan §8; P block unless noted)');
    L.push('');
    L.push(gateTable(base && cols.length > 1 ? cols.filter((c) => c !== base) : cols, base && cols.length > 1 ? { P: base.P, B: base.B } : null));
    L.push('');
  }
  return L.join('\n');
}
