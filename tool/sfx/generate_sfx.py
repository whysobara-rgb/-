#!/usr/bin/env python3
"""가치가차 뽑기 연출 효과음 생성기.

외부 오디오 파일 없이 numpy로 직접 합성한다(전부 이 스크립트의 결과물).
32 kHz / 16-bit / mono WAV를 assets/sfx/ 에 쓴다.

    python3 tool/sfx/generate_sfx.py

소리 설계
- summon   박스 등장: 공진 밴드패스가 위로 쓸려 올라가는 바람 소리
- charge   차지: 디튠된 톱니파가 지수적으로 상승 + 빨라지는 트레몰로 + 노이즈 라이저
- tick     짧은 금속성 클릭(카드 뒤집기 대기, 승급 직전)
- step1~3  승급 차임(R/SR/SSR). FM 벨 + 서브 쿵. 단계마다 음높이·화음이 올라간다
- impact   클라이맥스 붐: 140→38 Hz 서브 스윕 + 저역 노이즈 + 소프트 클리핑
- stamp    등급 도장: 낮은 쿵 + 중역 클릭
- sr_sting SR 마무리 아르페지오
- fanfare  SSR 팡파르: 장조 아르페지오 + 패드 + 고음 반짝임
- pop      N/R 카드가 뒤집힐 때 작은 팝
- flip     카드 넘기는 스윽
"""

from __future__ import annotations

import math
import os
import wave

import numpy as np

SR = 32000
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "assets", "sfx")
RNG = np.random.default_rng(20261007)


def t_axis(dur: float) -> np.ndarray:
    return np.arange(int(dur * SR)) / SR


def env_ad(n: int, attack: float, decay_tau: float) -> np.ndarray:
    """빠른 어택 + 지수 감쇠."""
    t = np.arange(n) / SR
    a = np.clip(t / max(attack, 1e-4), 0, 1)
    return a * np.exp(-np.maximum(t - attack, 0) / decay_tau)


def fade(x: np.ndarray, fin: float = 0.004, fout: float = 0.02) -> np.ndarray:
    n_in = max(1, int(fin * SR))
    n_out = max(1, int(fout * SR))
    x = x.copy()
    x[:n_in] *= np.linspace(0, 1, n_in)
    x[-n_out:] *= np.linspace(1, 0, n_out)
    return x


def biquad_bandpass(x: np.ndarray, f0: np.ndarray, q: float) -> np.ndarray:
    """시간에 따라 중심 주파수가 바뀌는 밴드패스(RBJ cookbook)."""
    y = np.zeros_like(x)
    x1 = x2 = y1 = y2 = 0.0
    f0 = np.broadcast_to(f0, x.shape)
    for i in range(len(x)):
        w0 = 2 * math.pi * min(f0[i], SR * 0.45) / SR
        alpha = math.sin(w0) / (2 * q)
        b0, b2 = alpha, -alpha
        a0, a1, a2 = 1 + alpha, -2 * math.cos(w0), 1 - alpha
        yi = (b0 * x[i] + b2 * x2 - a1 * y1 - a2 * y2) / a0
        x2, x1 = x1, x[i]
        y2, y1 = y1, yi
        y[i] = yi
    return y


def onepole_lp(x: np.ndarray, cutoff) -> np.ndarray:
    """1차 저역 통과. cutoff는 상수 또는 샘플별 배열."""
    a = np.broadcast_to(np.exp(-2 * np.pi * np.asarray(cutoff, dtype=float) / SR), x.shape)
    y = np.zeros_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc = (1 - a[i]) * x[i] + a[i] * acc
        y[i] = acc
    return y


def saw(phase: np.ndarray, harmonics: int = 12) -> np.ndarray:
    """대역 제한 톱니파(가산 합성)."""
    out = np.zeros_like(phase)
    for k in range(1, harmonics + 1):
        out += np.sin(k * phase) / k
    return out * (2 / math.pi)


def fm_bell(freq: float, dur: float, ratio: float = 3.5, index: float = 4.0,
            tau: float = 0.45) -> np.ndarray:
    t = t_axis(dur)
    idx = index * np.exp(-t / (tau * 0.5))
    mod = np.sin(2 * math.pi * freq * ratio * t)
    car = np.sin(2 * math.pi * freq * t + idx * mod)
    return car * env_ad(len(t), 0.002, tau)


def sub_thump(dur: float = 0.18, f_start: float = 110, f_end: float = 45) -> np.ndarray:
    t = t_axis(dur)
    f = f_end + (f_start - f_end) * np.exp(-t / 0.04)
    ph = 2 * math.pi * np.cumsum(f) / SR
    return np.sin(ph) * env_ad(len(t), 0.002, dur * 0.35)


def mix(*parts: tuple[np.ndarray, float, float]) -> np.ndarray:
    """(신호, 시작 시각 s, 게인) 목록을 섞는다."""
    end = max(int(start * SR) + len(sig) for sig, start, _ in parts)
    out = np.zeros(end)
    for sig, start, gain in parts:
        s = int(start * SR)
        out[s:s + len(sig)] += sig * gain
    return out


def normalize(x: np.ndarray, peak_db: float = -1.0) -> np.ndarray:
    peak = np.max(np.abs(x)) or 1.0
    return x / peak * (10 ** (peak_db / 20))


def write(name: str, x: np.ndarray, peak_db: float = -1.0) -> None:
    x = normalize(fade(x), peak_db)
    pcm = np.clip(x * 32767, -32768, 32767).astype(np.int16)
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f"{name}.wav")
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print(f"{name:9s} {len(x) / SR:5.2f}s  {os.path.getsize(path) / 1024:6.1f} KB")


# ── 소리들 ────────────────────────────────────────────────────────

def summon() -> np.ndarray:
    dur = 0.65
    t = t_axis(dur)
    noise = RNG.standard_normal(len(t))
    f0 = 300 * (1 + 9 * (t / dur) ** 1.6)
    y = biquad_bandpass(noise, f0, q=2.2)
    env = np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 1.5
    return y * env


def charge() -> np.ndarray:
    dur = 1.9
    t = t_axis(dur)
    u = t / dur
    f = 82 * (6.5 ** u)  # 82 → 533 Hz
    ph = 2 * math.pi * np.cumsum(f) / SR
    tone = saw(ph, 10) + 0.7 * saw(ph * 1.007, 10) + 0.5 * np.sin(ph * 0.5)
    trem_rate = 5 + 22 * u ** 2
    trem = 0.65 + 0.35 * np.sin(2 * math.pi * np.cumsum(trem_rate) / SR)
    noise = RNG.standard_normal(len(t))
    riser = biquad_bandpass(noise, 600 + 5200 * u ** 2, q=1.4) * (u ** 2.2)
    body = onepole_lp(tone * trem, 900 + 3500 * u ** 1.5)
    return (body * (0.15 + 0.85 * u ** 1.3) + 0.55 * riser)


def tick() -> np.ndarray:
    dur = 0.09
    t = t_axis(dur)
    ping = np.sin(2 * math.pi * 2350 * t) * env_ad(len(t), 0.0005, 0.018)
    click = RNG.standard_normal(len(t)) * env_ad(len(t), 0.0002, 0.004)
    return ping + 0.6 * click


def step(level: int) -> np.ndarray:
    # R: E5 / SR: A5 + E6 / SSR: C#6 + E6 + A6
    chords = {1: [659.25], 2: [880.0, 1318.5], 3: [1108.7, 1318.5, 1760.0]}
    parts = [(sub_thump(0.2, 120 + 25 * level, 48), 0.0, 0.9)]
    for i, f in enumerate(chords[level]):
        parts.append((fm_bell(f, 1.1, ratio=3.5, index=1.6 + 0.6 * level,
                              tau=0.35 + 0.08 * level), 0.012 * i, 0.55))
    # 짧은 공기 소리.
    air = biquad_bandpass(RNG.standard_normal(int(0.25 * SR)),
                          np.full(int(0.25 * SR), 4500.0), q=0.9)
    parts.append((air * env_ad(len(air), 0.003, 0.05), 0.0, 0.2))
    return onepole_lp(mix(*parts), 6500)


def impact() -> np.ndarray:
    dur = 1.1
    t = t_axis(dur)
    f = 38 + 102 * np.exp(-t / 0.09)
    ph = 2 * math.pi * np.cumsum(f) / SR
    boom = np.sin(ph) * env_ad(len(t), 0.003, 0.32)
    noise = onepole_lp(RNG.standard_normal(len(t)), 900) * env_ad(len(t), 0.001, 0.12)
    crack = RNG.standard_normal(len(t)) * env_ad(len(t), 0.0003, 0.012)
    return onepole_lp(np.tanh(1.6 * (boom + 0.9 * noise + 0.2 * crack)), 2600)


def stamp() -> np.ndarray:
    thud = sub_thump(0.3, 160, 55)
    click_n = int(0.05 * SR)
    click = biquad_bandpass(RNG.standard_normal(click_n), np.full(click_n, 1800.0), q=1.2)
    click *= env_ad(click_n, 0.0005, 0.01)
    return mix((thud, 0, 1.0), (click, 0, 0.7))


def arpeggio(notes: list[float], gap: float, tail: float, bright: float) -> list:
    parts = []
    for i, f in enumerate(notes):
        tone = np.zeros(int((tail) * SR))
        tt = t_axis(tail)
        for k, amp in enumerate([1.0, 0.5 * bright, 0.28 * bright, 0.14 * bright], start=1):
            tone += amp * np.sin(2 * math.pi * f * k * tt)
        tone *= env_ad(len(tt), 0.006, 0.42)
        parts.append((tone, i * gap, 0.42))
    return parts


def sr_sting() -> np.ndarray:
    notes = [659.25, 830.6, 987.8, 1318.5]  # E5 G#5 B5 E6
    parts = arpeggio(notes, 0.075, 1.1, 0.8)
    parts.append((fm_bell(1318.5, 1.3, ratio=2.0, index=2.5, tau=0.6), 0.3, 0.35))
    return mix(*parts)


def fanfare() -> np.ndarray:
    notes = [440.0, 554.4, 659.25, 880.0, 1108.7, 1318.5]  # A 장조
    parts = arpeggio(notes, 0.07, 1.3, 1.0)
    # 패드: A 장화음을 디튠해 넓게.
    dur = 2.5
    t = t_axis(dur)
    pad = np.zeros(len(t))
    for f in [220.0, 277.2, 329.6, 440.0, 554.4]:
        for d in (-0.004, 0.0, 0.004):
            pad += np.sin(2 * math.pi * f * (1 + d) * t)
    pad_env = np.clip(t / 0.35, 0, 1) * np.exp(-np.maximum(t - 0.6, 0) / 0.9)
    parts.append((onepole_lp(pad, 2400) * pad_env, 0.35, 0.09))
    # 반짝임: 짧은 고음 사인 블립.
    for i in range(26):
        f = RNG.uniform(3200, 7600)
        start = 0.4 + RNG.uniform(0, 1.6)
        tt = t_axis(0.12)
        blip = np.sin(2 * math.pi * f * tt) * env_ad(len(tt), 0.001, 0.03)
        parts.append((blip, start, 0.12))
    return mix(*parts)


def pop() -> np.ndarray:
    dur = 0.14
    t = t_axis(dur)
    f = 260 + 420 * np.exp(-t / 0.02)
    ph = 2 * math.pi * np.cumsum(f) / SR
    return np.sin(ph) * env_ad(len(t), 0.001, 0.04)


def flip() -> np.ndarray:
    dur = 0.2
    t = t_axis(dur)
    noise = RNG.standard_normal(len(t))
    y = biquad_bandpass(noise, 1800 + 3800 * (t / dur), q=1.6)
    return y * np.sin(np.pi * t / dur) ** 2


def main() -> None:
    write("summon", summon(), -4)
    write("charge", charge(), -3)
    write("tick", tick(), -6)
    write("step1", step(1), -3)
    write("step2", step(2), -2)
    write("step3", step(3), -1.5)
    write("impact", impact(), -1)
    write("stamp", stamp(), -2)
    write("sr_sting", sr_sting(), -2)
    write("fanfare", fanfare(), -1.5)
    write("pop", pop(), -6)
    write("flip", flip(), -8)


if __name__ == "__main__":
    main()
