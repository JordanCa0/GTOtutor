/** Synthesized table sounds (Web Audio) — no audio files to ship or license. */
export type SoundName = 'deal' | 'muck' | 'chip' | 'allin' | 'sweep' | 'good' | 'mixed' | 'bad';

const STORAGE_KEY = 'gtotutor.sound';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
let enabled = readEnabled();

function readEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

export const isSoundEnabled = () => enabled;

export function setSoundEnabled(on: boolean): void {
  enabled = on;
  try {
    localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    // storage blocked; the setting lasts for this tab only
  }
}

function audio(): { ctx: AudioContext; out: GainNode } | null {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return null;
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return { ctx, out: master! };
}

function envelope(ctx: AudioContext, at: number, peak: number, attack: number, decay: number): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
  return g;
}

/** Filtered noise burst: card slides and chip rattles. */
function burst(at: number, freq: number, q: number, peak: number, decay: number, out: GainNode, c: AudioContext) {
  const src = c.createBufferSource();
  src.buffer = noise;
  src.playbackRate.value = 0.9 + Math.random() * 0.2;
  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  filter.Q.value = q;
  const g = envelope(c, at, peak, 0.004, decay);
  src.connect(filter).connect(g).connect(out);
  src.start(at, Math.random() * 0.3, decay + 0.05);
}

function tone(at: number, freq: number, type: OscillatorType, peak: number, attack: number, decay: number, out: GainNode, c: AudioContext) {
  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  const g = envelope(c, at, peak, attack, decay);
  osc.connect(g).connect(out);
  osc.start(at);
  osc.stop(at + attack + decay + 0.05);
}

/** A single chip landing: a bright metallic tick plus a short rattle. */
function clink(at: number, loud: number, out: GainNode, c: AudioContext) {
  const base = 2600 + Math.random() * 500;
  tone(at, base, 'sine', 0.09 * loud, 0.002, 0.07, out, c);
  tone(at, base * 1.52, 'sine', 0.05 * loud, 0.002, 0.05, out, c);
  burst(at, 5200, 3, 0.12 * loud, 0.05, out, c);
}

export function playSound(name: SoundName, delayMs = 0): void {
  if (!enabled) return;
  const a = audio();
  if (!a) return;
  const { ctx: c, out } = a;
  const t = c.currentTime + delayMs / 1000 + 0.01;

  switch (name) {
    case 'deal':
      burst(t, 2400, 0.9, 0.35, 0.07, out, c);
      break;
    case 'muck':
      burst(t, 1500, 0.7, 0.16, 0.12, out, c);
      break;
    case 'chip':
      clink(t, 1, out, c);
      clink(t + 0.045, 0.7, out, c);
      break;
    case 'allin':
      for (let i = 0; i < 6; i++) clink(t + i * 0.035 + Math.random() * 0.015, 1 - i * 0.1, out, c);
      burst(t, 900, 0.6, 0.12, 0.25, out, c);
      break;
    case 'sweep':
      burst(t, 1100, 0.5, 0.18, 0.3, out, c);
      for (let i = 0; i < 4; i++) clink(t + 0.08 + i * 0.05 + Math.random() * 0.02, 0.6, out, c);
      break;
    case 'good':
      // Rising major arpeggio: C6, E6, G6.
      [1046.5, 1318.5, 1568].forEach((f, i) => {
        tone(t + i * 0.085, f, 'sine', 0.16, 0.01, 0.5, out, c);
        tone(t + i * 0.085, f * 2, 'sine', 0.03, 0.01, 0.3, out, c);
      });
      break;
    case 'mixed':
      [784, 988].forEach((f, i) => tone(t + i * 0.1, f, 'sine', 0.12, 0.01, 0.4, out, c));
      break;
    case 'bad':
      // Soft descending minor third, low and short — noticeable, not punishing.
      [311, 262].forEach((f, i) => tone(t + i * 0.14, f, 'triangle', 0.2, 0.015, 0.35, out, c));
      break;
  }
}
