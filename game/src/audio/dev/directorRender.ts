/**
 * Offline render of a scripted scene through the REAL AudioEngine + MatchAudioDirector + mixer
 * (dev / QA only, browser-only). The OfflineAudioContext is suspended at every 60 Hz tick so the
 * director sees exactly what the game would feed it: events after each sim step, one update per
 * frame, the engine's scheduler pumped in between.
 */
import { AudioEngine } from '../audio';
import { MatchAudioDirector } from '../director';
import type { TrackId } from '../ids';
import { DEFAULT_VOLUMES, type Volumes } from '../mixer';
import { PRE_ROLL, QA_SAMPLE_RATE } from '../offline';
import type { ScriptedScene } from './scenes';

export interface DirectedRenderOptions {
  volumes?: Volumes;
  seed?: number;
  /** Music to run under the scene (default 'match'); null = none. */
  music?: TrackId | null;
  /** Extra seconds rendered after the script ends (tails). */
  tail?: number;
  sampleRate?: number;
}

export async function renderDirectedScene(scene: ScriptedScene, o: DirectedRenderOptions = {}): Promise<AudioBuffer> {
  const sr = o.sampleRate ?? QA_SAMPLE_RATE;
  const tail = o.tail ?? 1.5;
  const seconds = scene.seconds + tail;
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: Math.ceil((PRE_ROLL + seconds) * sr), sampleRate: sr });
  const engine = new AudioEngine({ createContext: () => ctx as unknown as AudioContext, autoPump: false, seed: o.seed ?? 5 });
  engine.setVolumes(o.volumes ?? DEFAULT_VOLUMES);
  // An offline context cannot resume before rendering; unlock() tolerates that and builds the graph.
  await engine.unlock();
  const director = new MatchAudioDirector(engine, { localTeam: 0, listenerCharId: scene.listenerId });
  const music = o.music === undefined ? 'match' : o.music;
  const dt = 1 / 60;
  const ticks = Math.round(scene.seconds * 60);
  const frames = Math.round(seconds * 60);
  const frame = (i: number): void => {
    if (i === 0 && music) {
      engine.setMusicIntensity(0.4);
      engine.playMusic(music);
    }
    if (i < ticks) {
      const ev = scene.step();
      if (ev.length) director.onEvents(ev, scene.view);
      director.update(scene.view, dt);
    } else if (i === ticks) {
      director.stop();
      engine.playMusic('none');
    }
    engine.pump();
  };
  const at = (i: number): number => PRE_ROLL + i * dt;
  const schedule = (i: number): void => {
    void ctx.suspend(at(i)).then(() => {
      try {
        frame(i);
      } catch (err) {
        console.error('[qa] scene frame failed', err);
      }
      if (i + 1 < frames) schedule(i + 1);
      void ctx.resume();
    });
  };
  schedule(0);
  return ctx.startRendering();
}
