// WebAudio 합성 효과음 (외부 파일 없음)
let ctx = null, master = null, noiseBuf = null;
let volume = 0.6;
const lastPlay = {};

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain(); master.gain.value = volume;
  const comp = ctx.createDynamicsCompressor();
  master.connect(comp); comp.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}
export function setVolume(v) { volume = v; if (master) master.gain.value = v; }

function noise(dur, freq, q, gain, type = 'lowpass', t0 = 0) {
  const t = ctx.currentTime + t0;
  const s = ctx.createBufferSource(); s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f); f.connect(g); g.connect(master);
  s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
}
function tone(f0, f1, dur, gain, type = 'sine', t0 = 0) {
  const t = ctx.currentTime + t0;
  const o = ctx.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
}

const throttle = (k, ms) => {
  const n = performance.now();
  if (lastPlay[k] && n - lastPlay[k] < ms) return true;
  lastPlay[k] = n; return false;
};

export function sfx(name, p = {}) {
  if (!ctx) return;
  switch (name) {
    case 'shot': {
      // 레이어: 날카로운 크랙 + 몸통 노이즈 + 저역 펀치 + 기계음 + 짧은 잔향
      const heavy = p.heavy || 0, pt = (p.pitch || 1) * (0.94 + Math.random() * 0.12);
      noise(0.025, 5200 * pt, 0.7, 0.45, 'highpass');
      noise(0.07 + heavy * 0.16, (2000 - heavy * 1000) * pt, 0.8, 0.55 + heavy * 0.3);
      tone(140 * pt, 38, 0.09 + heavy * 0.14, 0.75 + heavy * 0.3, 'sine');
      tone(320 * pt, 90, 0.04, 0.25, 'square');
      noise(0.03, 3500, 6, 0.12, 'bandpass', 0.045);
      noise(0.35 + heavy * 0.3, 700 * pt, 0.5, 0.08 + heavy * 0.06, 'lowpass', 0.03);
      break;
    }
    case 'swing': { const pt = (p.pitch || 1) * (0.9 + Math.random() * 0.2);
      noise(0.16 + (p.heavy || 0) * 0.12, 2400 * pt, 1.2, 0.35, 'bandpass'); tone(500 * pt, 180, 0.12, 0.06, 'sine'); break; }
    case 'meleeHit': { const h = p.heavy || 0;
      noise(0.12 + h * 0.15, 900 - h * 300, 0.7, 0.8); tone(110 - h * 30, 35, 0.18 + h * 0.15, 0.9, 'sine');
      noise(0.05, 4000, 3, 0.3, 'bandpass'); break; }
    case 'laser': if (throttle('laser', 60)) return; tone(900, 500, 0.06, 0.08, 'sawtooth'); break;
    case 'tesla': noise(0.12, 4000, 4, 0.3, 'bandpass'); tone(1200, 200, 0.12, 0.12, 'square'); break;
    case 'rail': tone(2400, 80, 0.35, 0.3, 'sawtooth'); noise(0.3, 3000, 1, 0.4); break;
    case 'launch': noise(0.35, 600, 0.6, 0.5); tone(220, 60, 0.3, 0.3, 'sawtooth'); break;
    case 'boom': if (throttle('boom', 40)) return;
      noise(0.9 * (p.s || 1), 380, 0.5, 0.9); tone(90, 25, 0.7, 0.7, 'sine'); break;
    case 'hit': if (throttle('hit', 30)) return; tone(p.crit ? 2200 : 1500, p.crit ? 1700 : 1000, 0.035, p.crit ? 0.16 : 0.1, 'square'); noise(0.04, 1200, 1, 0.12); break;
    case 'kill': { if (throttle('kill', 35)) return; const c = Math.min(p.combo || 0, 24) / 24; const f = 900 * (1 + c);
      tone(f, f * 1.5, 0.09, 0.13, 'triangle'); tone(f * 2, f * 2, 0.12, 0.05, 'sine', 0.03); noise(0.12, 600, 0.6, 0.25); break; }
    case 'reload': noise(0.05, 3000, 2, 0.3, 'bandpass'); noise(0.05, 2500, 2, 0.3, 'bandpass', 0.18); break;
    case 'empty': tone(1800, 1700, 0.03, 0.1, 'square'); break;
    case 'hurt': if (throttle('hurt', 120)) return; tone(200, 80, 0.2, 0.35, 'sawtooth'); break;
    case 'coin': if (throttle('coin', 50)) return; tone(1300, 1900, 0.08, 0.08, 'sine'); break;
    case 'loot': [523, 659, 784, 1046].forEach((f, i) => tone(f, f, 0.18, 0.15, 'triangle', i * 0.07)); break;
    case 'dash': noise(0.25, 1200, 0.5, 0.35, 'highpass'); break;
    case 'shock': tone(120, 30, 0.8, 0.8, 'sine'); noise(0.6, 900, 0.5, 0.6); break;
    case 'overdrive': tone(200, 1600, 0.6, 0.3, 'sawtooth'); break;
    case 'slash': noise(0.15, 5000, 1, 0.4, 'highpass'); break;
    case 'roar': tone(90, 40, 1.4, 0.8, 'sawtooth'); noise(1.2, 300, 0.4, 0.6); break;
    case 'warn': tone(880, 880, 0.12, 0.2, 'square'); tone(660, 660, 0.12, 0.2, 'square', 0.15); break;
    case 'click': tone(900, 700, 0.04, 0.1, 'triangle'); break;
    case 'buy': tone(880, 1760, 0.15, 0.15, 'triangle'); tone(1320, 2000, 0.2, 0.12, 'sine', 0.08); break;
    case 'gacha': [400, 500, 600, 800, 1000, 1300].forEach((f, i) => tone(f, f * 1.02, 0.12, 0.12, 'triangle', i * 0.06)); break;
    case 'gachaRare': [523, 784, 1046, 1568, 2093].forEach((f, i) => tone(f, f, 0.4, 0.18, 'sine', i * 0.09)); noise(1.2, 6000, 0.5, 0.15, 'highpass'); break;
  }
}
