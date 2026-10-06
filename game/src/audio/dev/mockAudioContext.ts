/**
 * Strict in-memory stand-in for a WebAudio context, for Node tests (dev only, never shipped).
 *
 * It does not produce sound; it records the graph and enforces the rules browsers enforce
 * (and a few stricter ones) so mistakes surface in CI instead of as silent bugs in the game:
 *   - non-finite values / times throw (TypeError), negative times throw (RangeError)
 *   - exponential ramps to <= 0 throw (RangeError); a ramp *from* 0 is flagged (it stays 0)
 *   - start() twice / stop() before start() throw (InvalidStateError)
 *   - connecting to something that is not a node or param throws
 */

export class MockError extends Error {}

export class MockParam {
  value: number;
  readonly events: { kind: string; value: number; time: number }[] = [];
  private last: number;
  constructor(v: number) {
    this.value = v;
    this.last = v;
  }
  private check(v: number, t: number): void {
    if (!Number.isFinite(v)) throw new TypeError(`non-finite param value ${v}`);
    if (!Number.isFinite(t)) throw new TypeError(`non-finite time ${t}`);
    if (t < 0) throw new RangeError(`negative time ${t}`);
  }
  setValueAtTime(v: number, t: number): this {
    this.check(v, t);
    this.events.push({ kind: 'set', value: v, time: t });
    this.last = v;
    this.value = v;
    return this;
  }
  linearRampToValueAtTime(v: number, t: number): this {
    this.check(v, t);
    this.events.push({ kind: 'lin', value: v, time: t });
    this.last = v;
    return this;
  }
  exponentialRampToValueAtTime(v: number, t: number): this {
    this.check(v, t);
    if (v <= 0) throw new RangeError('exponential ramp to a non-positive value');
    if (this.last === 0) throw new MockError('exponential ramp starting from 0 never moves');
    this.events.push({ kind: 'exp', value: v, time: t });
    this.last = v;
    return this;
  }
  setTargetAtTime(v: number, t: number, tau: number): this {
    this.check(v, t);
    if (!Number.isFinite(tau) || tau < 0) throw new RangeError(`bad time constant ${tau}`);
    this.events.push({ kind: 'target', value: v, time: t });
    this.last = v;
    return this;
  }
  setValueCurveAtTime(values: ArrayLike<number>, t: number, d: number): this {
    this.check(values[0] ?? 0, t);
    if (!(d > 0)) throw new RangeError('bad curve duration');
    return this;
  }
  cancelScheduledValues(t: number): this {
    this.check(0, t);
    return this;
  }
  cancelAndHoldAtTime(t: number): this {
    this.check(0, t);
    return this;
  }
}

export class MockNode {
  readonly ctx: MockAudioContext;
  readonly outputs: (MockNode | MockParam)[] = [];
  constructor(ctx: MockAudioContext) {
    this.ctx = ctx;
    ctx.nodesCreated++;
    ctx.nodes.push(this);
  }
  connect<T>(dest: T): T {
    if (!(dest instanceof MockNode) && !(dest instanceof MockParam)) throw new TypeError('connect() to a non-node');
    this.outputs.push(dest);
    return dest;
  }
  disconnect(): void {
    this.outputs.length = 0;
  }
}

export class MockGain extends MockNode {
  readonly gain = new MockParam(1);
}

export class MockSource extends MockNode {
  started = false;
  stopped = false;
  startTime = 0;
  onended: (() => void) | null = null;
  start(t = 0, offset = 0): void {
    if (this.started) throw new MockError('InvalidStateError: start() called twice');
    if (!Number.isFinite(t) || !Number.isFinite(offset)) throw new TypeError('non-finite start');
    if (t < 0 || offset < 0) throw new RangeError('negative start');
    this.started = true;
    this.startTime = t;
    this.ctx.sourcesStarted++;
  }
  stop(t = 0): void {
    if (!this.started) throw new MockError('InvalidStateError: stop() before start()');
    if (!Number.isFinite(t)) throw new TypeError('non-finite stop');
    this.stopped = true;
  }
}

export class MockOscillator extends MockSource {
  type: OscillatorType = 'sine';
  readonly frequency = new MockParam(440);
  readonly detune = new MockParam(0);
  setPeriodicWave(): void {
    this.type = 'custom';
  }
}

export class MockBufferSource extends MockSource {
  buffer: MockBuffer | null = null;
  loop = false;
  readonly playbackRate = new MockParam(1);
  readonly detune = new MockParam(0);
}

export class MockBuffer {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  private readonly data: Float32Array[];
  constructor(ch: number, len: number, sr: number) {
    if (!(ch > 0) || !(len > 0) || !(sr > 0)) throw new RangeError('bad buffer');
    this.numberOfChannels = ch;
    this.length = len;
    this.sampleRate = sr;
    this.data = Array.from({ length: ch }, () => new Float32Array(len));
  }
  get duration(): number {
    return this.length / this.sampleRate;
  }
  getChannelData(c: number): Float32Array {
    return this.data[c];
  }
}

export class MockFilter extends MockNode {
  type: BiquadFilterType = 'lowpass';
  readonly frequency = new MockParam(350);
  readonly Q = new MockParam(1);
  readonly gain = new MockParam(0);
  readonly detune = new MockParam(0);
}

export class MockPanner extends MockNode {
  readonly pan = new MockParam(0);
}

export class MockCompressor extends MockNode {
  readonly threshold = new MockParam(-24);
  readonly knee = new MockParam(30);
  readonly ratio = new MockParam(12);
  readonly attack = new MockParam(0.003);
  readonly release = new MockParam(0.25);
  readonly reduction = 0;
}

export class MockShaper extends MockNode {
  curve: Float32Array | null = null;
  oversample: OverSampleType = 'none';
}

export class MockConvolver extends MockNode {
  buffer: MockBuffer | null = null;
  normalize = true;
}

export class MockDelay extends MockNode {
  readonly delayTime = new MockParam(0);
}

export class MockAnalyser extends MockNode {
  fftSize = 2048;
  getFloatTimeDomainData(a: Float32Array): void {
    a.fill(0);
  }
}

export class MockAudioContext {
  currentTime = 0;
  readonly sampleRate: number;
  state: AudioContextState = 'suspended';
  readonly destination: MockNode;
  nodesCreated = 0;
  sourcesStarted = 0;
  /** Every node created, in order (graph inspection in tests). */
  readonly nodes: MockNode[] = [];

  constructor(sampleRate = 48000) {
    this.sampleRate = sampleRate;
    this.destination = new MockNode(this);
  }
  resume(): Promise<void> {
    this.state = 'running';
    return Promise.resolve();
  }
  suspend(): Promise<void> {
    this.state = 'suspended';
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.state = 'closed';
    return Promise.resolve();
  }
  createGain(): MockGain {
    return new MockGain(this);
  }
  createOscillator(): MockOscillator {
    return new MockOscillator(this);
  }
  createBufferSource(): MockBufferSource {
    return new MockBufferSource(this);
  }
  createBuffer(ch: number, len: number, sr: number): MockBuffer {
    return new MockBuffer(ch, len, sr);
  }
  createBiquadFilter(): MockFilter {
    return new MockFilter(this);
  }
  createStereoPanner(): MockPanner {
    return new MockPanner(this);
  }
  createDynamicsCompressor(): MockCompressor {
    return new MockCompressor(this);
  }
  createWaveShaper(): MockShaper {
    return new MockShaper(this);
  }
  createConvolver(): MockConvolver {
    return new MockConvolver(this);
  }
  createDelay(): MockDelay {
    return new MockDelay(this);
  }
  createAnalyser(): MockAnalyser {
    return new MockAnalyser(this);
  }
  createPeriodicWave(): object {
    return {};
  }
}

/**
 * A compact description of everything scheduled on the context so far (node types, start
 * times and every parameter automation, rounded), starting at node index `from`. Two renders of
 * a sound with different random seeds should differ here when the recipe is randomized; noise
 * buffer read offsets are deliberately left out (they always differ).
 */
export function graphFingerprint(ctx: MockAudioContext, from = 0): string {
  const r = (x: number): string => (Math.round(x * 1e4) / 1e4).toString();
  const parts: string[] = [];
  for (const n of ctx.nodes.slice(from)) {
    parts.push(n.constructor.name);
    if (n instanceof MockSource) parts.push(`@${r(n.startTime)}`);
    for (const [k, p] of Object.entries(n)) {
      if (!(p instanceof MockParam)) continue;
      parts.push(`${k}=${r(p.value)}`);
      for (const e of p.events) parts.push(`${e.kind}:${r(e.value)}@${r(e.time)}`);
    }
  }
  return parts.join(' ');
}

/** Typed as a real AudioContext for code under test. */
export function mockContext(sampleRate = 48000): MockAudioContext & AudioContext {
  return new MockAudioContext(sampleRate) as unknown as MockAudioContext & AudioContext;
}
