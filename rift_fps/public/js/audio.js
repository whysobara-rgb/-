// WebAudio 합성 사운드 (외부 파일 없음)
// 캐주얼 톤: 펀치감 있는 저음 + 밝은 고음 장식, 공간감(리버브), 콤보에 따라 올라가는 음계, 절차적 배경음악
let ctx = null, master = null, sfxBus = null, musicBus = null, reverb = null, noiseBuf = null;
let volume = 0.6, musicVolume = 0.5;
const lastPlay = {};
// C 장조 펜타토닉 (처치음·코인음이 콤보에 따라 이 음계로 상승)
const PENTA = [0, 2, 4, 7, 9];
const note = (i, base = 523.25) => base * Math.pow(2, (PENTA[i % 5] + 12 * Math.floor(i / 5)) / 12);

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.18;
  master = ctx.createGain(); master.gain.value = 1;
  sfxBus = ctx.createGain(); sfxBus.gain.value = volume;
  musicBus = ctx.createGain(); musicBus.gain.value = musicVolume * 0.32;
  // 짧은 공간 잔향 (생성한 임펄스 응답)
  reverb = ctx.createConvolver();
  const len = ctx.sampleRate * 1.3, ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
  reverb.buffer = ir;
  const wet = ctx.createGain(); wet.gain.value = 0.16;
  sfxBus.connect(master); sfxBus.connect(reverb); musicBus.connect(master); musicBus.connect(reverb);
  reverb.connect(wet); wet.connect(master);
  master.connect(comp); comp.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}
export function setVolume(v) { volume = v; if (sfxBus) sfxBus.gain.value = v; }
export function setMusicVolume(v) { musicVolume = v; if (musicBus) musicBus.gain.value = v * 0.32; }

// ── 기본 음원 ──
function env(g, t, a, peak, dur) {
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
}
function noise(dur, freq, q, gain, type = 'lowpass', t0 = 0, sweepTo = 0, out = sfxBus) {
  const t = ctx.currentTime + t0;
  const s = ctx.createBufferSource(); s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
  const g = ctx.createGain(); env(g, t, 0.002, gain, dur);
  s.connect(f); f.connect(g); g.connect(out);
  s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
}
function tone(f0, f1, dur, gain, type = 'sine', t0 = 0, out = sfxBus, attack = 0.003) {
  const t = ctx.currentTime + t0;
  const o = ctx.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = ctx.createGain(); env(g, t, attack, gain, dur);
  o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.05);
}
// 맑은 벨 소리 (배음 2개)
function bell(f, dur, gain, t0 = 0) { tone(f, f, dur, gain, 'sine', t0); tone(f * 2.01, f * 2.01, dur * 0.6, gain * 0.35, 'sine', t0); tone(f * 3, f * 3, dur * 0.3, gain * 0.12, 'triangle', t0); }

const throttle = (k, ms) => {
  const n = performance.now();
  if (lastPlay[k] && n - lastPlay[k] < ms) return true;
  lastPlay[k] = n; return false;
};

export function sfx(name, p = {}) {
  if (!ctx) return;
  const r = 0.95 + Math.random() * 0.1;
  switch (name) {
    case 'shot': {
      // 클릭 트랜지언트 + 둥근 "퉁" 몸통 + 짧은 노이즈 꼬리 → 귀가 덜 아프고 묵직함
      const heavy = p.heavy || 0, pt = (p.pitch || 1) * r;
      tone(3200 * pt, 1800 * pt, 0.012, 0.25, 'square');
      tone(240 * pt, 55, 0.09 + heavy * 0.12, 0.85 + heavy * 0.2, 'sine');
      tone(480 * pt, 160, 0.05, 0.2, 'triangle');
      noise(0.06 + heavy * 0.12, 2400 * pt, 0.7, 0.35 + heavy * 0.2, 'lowpass', 0, 600);
      if (heavy >= 1) tone(90, 32, 0.28, 0.6, 'sine', 0.005);
      break;
    }
    case 'laser': if (throttle('laser', 55)) return; tone(1500 * r, 700, 0.07, 0.07, 'sawtooth'); tone(750 * r, 400, 0.07, 0.06, 'sine'); break;
    case 'tesla': noise(0.1, 5000, 3, 0.22, 'bandpass', 0, 1500); tone(1600 * r, 300, 0.1, 0.1, 'square'); break;
    case 'rail': tone(300, 2400, 0.12, 0.18, 'sawtooth'); tone(2400, 90, 0.45, 0.32, 'sawtooth', 0.1); noise(0.4, 4000, 1, 0.3, 'lowpass', 0.1, 300); tone(70, 30, 0.4, 0.6, 'sine', 0.1); break;
    case 'launch': noise(0.35, 300, 0.8, 0.5, 'bandpass', 0, 2500); tone(160, 60, 0.25, 0.5, 'sine'); break;
    case 'boom': if (throttle('boom', 45)) return;
      { const s = p.s || 1; tone(110 * r, 28, 0.6 * s, 0.95, 'sine'); noise(0.8 * s, 900, 0.5, 0.75, 'lowpass', 0, 120); noise(0.25, 3500, 0.8, 0.25, 'highpass', 0.02); }
      break;
    case 'hit': if (throttle('hit', 28)) return;
      if (p.crit) { bell(2093 * r, 0.12, 0.12); tone(1400, 900, 0.03, 0.12, 'square'); }
      else { tone(1700 * r, 1100, 0.03, 0.11, 'sine'); noise(0.03, 2500, 2, 0.08, 'bandpass'); }
      break;
    case 'kill': { if (throttle('kill', 30)) return;
      const c = Math.min(p.combo || 0, 30);
      tone(260 * r, 120, 0.08, 0.35, 'sine'); noise(0.07, 1100, 1.5, 0.3, 'bandpass', 0, 500); // 퍽
      bell(note(Math.floor(c / 3)), 0.22, 0.13, 0.015); // 콤보 따라 올라가는 띵
      break; }
    case 'reload': noise(0.04, 3500, 3, 0.25, 'bandpass'); tone(900, 600, 0.03, 0.12, 'square', 0.0); noise(0.12, 800, 1, 0.12, 'bandpass', 0.12, 2400); tone(1200, 1500, 0.03, 0.14, 'square', 0.26); break;
    case 'empty': tone(2200, 2000, 0.02, 0.1, 'square'); tone(1500, 1400, 0.02, 0.08, 'square', 0.05); break;
    case 'hurt': if (throttle('hurt', 110)) return; tone(220, 90, 0.18, 0.4, 'triangle'); noise(0.12, 600, 1, 0.25, 'lowpass'); break;
    case 'coin': if (throttle('coin', 45)) return; tone(1975 * r, 1975 * r, 0.06, 0.07, 'square'); tone(2637 * r, 2637 * r, 0.16, 0.07, 'square', 0.055); break;
    case 'loot': [0, 2, 4, 5, 7].forEach((i, k) => bell(note(i + 5), 0.4, 0.13, k * 0.06)); noise(0.6, 7000, 0.6, 0.08, 'highpass', 0.1); break;
    case 'dash': noise(0.22, 400, 1.2, 0.4, 'bandpass', 0, 3000); tone(300, 700, 0.15, 0.08, 'sine'); break;
    case 'jump': tone(320 * r, 560, 0.12, 0.12, 'sine'); break;
    case 'jump2': tone(480 * r, 900, 0.14, 0.13, 'sine'); noise(0.15, 1500, 1, 0.12, 'bandpass', 0, 4000); break;
    case 'shock': tone(160, 40, 0.7, 0.85, 'sine'); noise(0.5, 2000, 0.6, 0.45, 'lowpass', 0, 200); bell(note(7), 0.5, 0.08, 0.02); break;
    case 'overdrive': case 'skill':
      tone(200, 1600, 0.45, 0.22, 'sawtooth'); tone(400, 3200, 0.45, 0.08, 'square');
      [0, 2, 4, 7].forEach((i, k) => bell(note(i + 5), 0.5, 0.1, 0.35 + k * 0.05)); tone(90, 40, 0.5, 0.7, 'sine', 0.4);
      break;
    case 'slash': case 'swing': { const pt = (p.pitch || 1) * r; noise(0.16 + (p.heavy || 0) * 0.1, 900 * pt, 1.4, 0.3, 'bandpass', 0, 4500 * pt); break; }
    case 'meleeHit': { const h = p.heavy || 0; tone(180 - h * 50, 45, 0.16 + h * 0.12, 0.9, 'sine'); noise(0.08, 1800, 1, 0.45, 'bandpass', 0, 500); tone(1100, 700, 0.04, 0.12, 'square'); break; }
    case 'roar': { const t = ctx.currentTime, o = ctx.createOscillator(), o2 = ctx.createOscillator(), lfo = ctx.createOscillator(), lg = ctx.createGain(), g = ctx.createGain(), f = ctx.createBiquadFilter();
      o.type = 'sawtooth'; o2.type = 'sawtooth'; o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(48, t + 1.3); o2.frequency.setValueAtTime(113, t); o2.frequency.exponentialRampToValueAtTime(50, t + 1.3);
      lfo.frequency.value = 18; lg.gain.value = 12; lfo.connect(lg); lg.connect(o.frequency); lg.connect(o2.frequency);
      f.type = 'lowpass'; f.frequency.value = 700; env(g, t, 0.08, 0.5, 1.4);
      o.connect(f); o2.connect(f); f.connect(g); g.connect(sfxBus); [o, o2, lfo].forEach((x) => { x.start(t); x.stop(t + 1.5); });
      noise(1.2, 400, 0.5, 0.35, 'lowpass'); break; }
    case 'warn': tone(988, 988, 0.1, 0.12, 'triangle'); tone(740, 740, 0.12, 0.12, 'triangle', 0.13); break;
    case 'click': tone(900, 1300, 0.04, 0.09, 'sine'); break;
    case 'buy': [0, 2, 4].forEach((i, k) => bell(note(i + 5), 0.3, 0.12, k * 0.06)); tone(1975, 1975, 0.05, 0.05, 'square', 0.2); tone(2637, 2637, 0.14, 0.05, 'square', 0.25); break;
    case 'gacha': for (let i = 0; i < 8; i++) tone(note(i, 392), note(i, 392), 0.09, 0.08, 'triangle', i * 0.05); break;
    case 'gachaRare': [0, 2, 4, 5, 7, 9].forEach((i, k) => bell(note(i + 5), 0.7, 0.14, k * 0.08)); noise(1.4, 8000, 0.5, 0.1, 'highpass', 0.1); tone(80, 40, 0.8, 0.5, 'sine'); break;
  }
}

// ── 절차적 배경음악: 'lobby'(잔잔) / 'battle'(신나는 신스웨이브) ──
let musicTimer = null, musicMode = null, step = 0, nextT = 0;
const CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]; // Am F C G
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
function mTone(f, t, dur, gain, type, attack = 0.005, cutoff = 0) {
  const o = ctx.createOscillator(); o.type = type; o.frequency.value = f;
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  if (cutoff) { const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = cutoff; o.connect(fl); fl.connect(g); } else o.connect(g);
  g.connect(musicBus); o.start(t); o.stop(t + dur + 0.05);
}
function mNoise(t, dur, gain, freq, type) {
  const s = ctx.createBufferSource(); s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
  const g = ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(musicBus); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
}
function scheduleStep(t) {
  const battle = musicMode === 'battle';
  const spb = 60 / (battle ? 126 : 84) / 4; // 16분음표 길이
  const bar = Math.floor(step / 16) % 4, s16 = step % 16, chord = CHORDS[bar];
  if (battle) {
    if (s16 % 4 === 0) { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.12); g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18); o.connect(g); g.connect(musicBus); o.start(t); o.stop(t + 0.2); }
    if (s16 % 8 === 4) mNoise(t, 0.12, 0.35, 1800, 'bandpass');
    if (s16 % 2 === 1) mNoise(t, 0.035, 0.12, 8000, 'highpass');
    if (s16 % 2 === 0) mTone(mtof(chord[0] - 24), t, spb * 1.8, 0.32, 'sawtooth', 0.005, 420);
    const arp = chord[[0, 1, 2, 1][s16 % 4]] + (s16 >= 8 ? 12 : 0);
    mTone(mtof(arp + 12), t, spb * 1.5, 0.07, 'square', 0.003, 2600);
  } else {
    if (s16 === 0) chord.forEach((m) => mTone(mtof(m), t, spb * 15, 0.06, 'triangle', 0.6));
    if (s16 % 4 === 0) mTone(mtof(chord[0] - 24), t, spb * 3.5, 0.18, 'sine', 0.02);
    if ([0, 3, 6, 10, 12].includes(s16)) mTone(mtof(chord[(s16 / 3 | 0) % 3] + 12), t, spb * 3, 0.06, 'sine', 0.004);
    if (s16 % 4 === 2) mNoise(t, 0.04, 0.03, 9000, 'highpass');
  }
  step++;
  return spb;
}
export function startMusic(mode) {
  if (!ctx || musicMode === mode) return;
  musicMode = mode; step = 0; nextT = ctx.currentTime + 0.1;
  clearInterval(musicTimer);
  musicTimer = setInterval(() => { while (nextT < ctx.currentTime + 0.12) nextT += scheduleStep(nextT); }, 25);
}
export function stopMusic() { clearInterval(musicTimer); musicTimer = null; musicMode = null; }
