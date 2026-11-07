export type Sound =
  | 'rifle' | 'mg' | 'cannon' | 'rocket' | 'boom' | 'bigBoom' | 'click' | 'deny' | 'capture'
  | 'alert' | 'done' | 'jet' | 'whistle' | 'zap' | 'heal' | 'build' | 'ready' | 'upgrade' | 'drop'
  | 'victory' | 'defeat';

const MIN_GAP: Record<Sound, number> = {
  rifle: 0.06, mg: 0.14, cannon: 0.12, rocket: 0.14, boom: 0.08, bigBoom: 0.2, click: 0.03, deny: 0.2,
  capture: 0.3, alert: 1.5, done: 0.2, jet: 0.5, whistle: 0.25, zap: 0.4, heal: 0.4, build: 0.3,
  ready: 0.25, upgrade: 0.5, drop: 0.5, victory: 2, defeat: 2,
};

/** What plays: everything, effects only, or nothing. */
export type SoundMode = 'all' | 'sfx' | 'none';

const A_MINOR_LOOP: { bass: number; chord: number[] }[] = [
  { bass: 110, chord: [220, 261.63, 329.63] },
  { bass: 87.31, chord: [174.61, 220, 261.63] },
  { bass: 130.81, chord: [261.63, 329.63, 392] },
  { bass: 98, chord: [196, 246.94, 293.66] },
];

const LOOKAHEAD = 0.3;

/** All sound is synthesized, so the game ships no audio files. */
export class GameAudio {
  mode: SoundMode = 'all';
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private music: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private last = new Map<Sound, number>();
  private timer = 0;
  private nextStep = 0;
  private stepIndex = 0;
  private intensity = 0;
  private playing = false;

  get muted(): boolean {
    return this.mode === 'none';
  }

  /** Cycles all → effects only → silence, and returns the new mode. */
  cycleMode(): SoundMode {
    this.mode = this.mode === 'all' ? 'sfx' : this.mode === 'sfx' ? 'none' : 'all';
    if (this.music && this.ctx) {
      this.music.gain.setTargetAtTime(this.mode === 'all' ? 0.16 : 0, this.ctx.currentTime, 0.1);
    }
    return this.mode;
  }

  /** Browsers only allow audio after a user gesture. */
  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);
    this.sfx = this.ctx.createGain();
    this.sfx.gain.value = 0.9;
    this.sfx.connect(this.master);
    this.music = this.ctx.createGain();
    this.music.gain.value = this.mode === 'all' ? 0.16 : 0;
    this.music.connect(this.master);
    const length = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    if (this.playing) this.startScheduler();
  }

  private tone(freq: number, end: number, duration: number, volume: number, wave: OscillatorType,
    delay = 0, out: AudioNode = this.sfx!, at?: number): void {
    const ctx = this.ctx!;
    const t = at ?? ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, end), t + duration);
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain).connect(out);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  private burst(cutoff: number, duration: number, volume: number, type: BiquadFilterType = 'lowpass',
    delay = 0, out: AudioNode = this.sfx!, at?: number, sweepTo?: number): void {
    const ctx = this.ctx!;
    const t = at ?? ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(cutoff, t);
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, t + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(filter).connect(gain).connect(out);
    src.start(t, Math.random() * 0.5, duration);
  }

  /** `volume` lets far-away fights sound quieter than the ones on screen. */
  play(sound: Sound, volume = 1): void {
    if (this.muted || !this.ctx || this.ctx.state !== 'running' || volume < 0.05) return;
    const now = this.ctx.currentTime;
    if (now - (this.last.get(sound) ?? -9) < MIN_GAP[sound]) return;
    this.last.set(sound, now);
    const v = Math.min(1, volume);
    const pitch = 0.9 + Math.random() * 0.2;
    switch (sound) {
      case 'rifle':
        this.burst(2600 + Math.random() * 1400, 0.07, 0.1 * v);
        if (Math.random() < 0.5) this.burst(3000, 0.05, 0.07 * v, 'lowpass', 0.07);
        break;
      case 'mg':
        for (let i = 0; i < 4; i++) this.burst(2000, 0.04, 0.09 * v, 'bandpass', i * 0.05);
        break;
      case 'cannon':
        this.burst(900, 0.22, 0.28 * v);
        this.tone(140 * pitch, 45, 0.18, 0.26 * v, 'sine');
        break;
      case 'rocket':
        this.burst(600, 0.32, 0.16 * v, 'bandpass', 0, this.sfx!, undefined, 3200);
        this.tone(90 * pitch, 40, 0.2, 0.2 * v, 'sine', 0.05);
        break;
      case 'boom':
        this.burst(600, 0.45, 0.4 * v);
        this.tone(90 * pitch, 28, 0.32, 0.3 * v, 'sine');
        break;
      case 'bigBoom':
        this.burst(420, 1, 0.7 * v);
        this.burst(1800, 0.25, 0.25 * v, 'highpass');
        this.tone(70 * pitch, 20, 0.8, 0.5 * v, 'sine');
        break;
      case 'click': this.tone(760, 520, 0.05, 0.1, 'triangle'); break;
      case 'deny': this.tone(170, 120, 0.13, 0.14, 'square'); break;
      case 'capture':
        this.tone(520, 520, 0.11, 0.14, 'triangle');
        this.tone(780, 780, 0.17, 0.14, 'triangle', 0.1);
        break;
      case 'alert':
        this.tone(660, 660, 0.12, 0.13, 'square');
        this.tone(440, 440, 0.16, 0.13, 'square', 0.15);
        break;
      case 'done': this.tone(640, 900, 0.1, 0.1, 'triangle'); break;
      case 'jet':
        this.burst(1500, 1.6, 0.22 * v, 'lowpass', 0, this.sfx!, undefined, 400);
        this.tone(420, 120, 1.4, 0.07 * v, 'sawtooth');
        break;
      case 'whistle': this.tone(1300 * pitch, 380, 0.9, 0.07 * v, 'sine'); break;
      case 'zap':
        this.tone(1400, 60, 0.5, 0.16 * v, 'sawtooth');
        this.burst(5000, 0.35, 0.14 * v, 'highpass');
        break;
      case 'heal':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(f, f, 0.22, 0.08 * v, 'triangle', i * 0.07));
        break;
      case 'build':
        this.burst(1200, 0.06, 0.18 * v, 'bandpass');
        this.burst(1000, 0.06, 0.16 * v, 'bandpass', 0.13);
        break;
      case 'ready':
        this.tone(880, 880, 0.06, 0.07, 'square');
        this.tone(1175, 1175, 0.09, 0.07, 'square', 0.07);
        break;
      case 'upgrade':
        [392, 523, 659, 784].forEach((f, i) => this.tone(f, f, 0.26, 0.11, 'triangle', i * 0.09));
        break;
      case 'drop': this.burst(900, 1.1, 0.12 * v, 'bandpass', 0, this.sfx!, undefined, 300); break;
      case 'victory':
        [523, 659, 784, 1047, 784, 1047].forEach((f, i) =>
          this.tone(f, f, i === 5 ? 1.2 : 0.22, 0.14, 'square', [0, 0.14, 0.28, 0.42, 0.62, 0.76][i]));
        [131, 196, 262].forEach((f) => this.tone(f, f, 1.8, 0.1, 'triangle', 0.76));
        break;
      case 'defeat':
        [392, 349, 311, 262].forEach((f, i) => this.tone(f, f * 0.98, i === 3 ? 1.4 : 0.36, 0.12, 'triangle', i * 0.34));
        [98, 87].forEach((f, i) => this.tone(f, f, 1.2, 0.12, 'sawtooth', i * 0.68));
        break;
    }
  }

  // ---- Music -------------------------------------------------------------

  /** 0 menu, 1 calm match, 2 fighting, 3 sudden death. */
  setIntensity(level: number): void {
    this.intensity = Math.max(0, Math.min(3, level));
  }

  startMusic(level: number): void {
    this.setIntensity(level);
    this.playing = true;
    this.startScheduler();
  }

  stopMusic(): void {
    this.playing = false;
    window.clearInterval(this.timer);
    this.timer = 0;
  }

  private startScheduler(): void {
    if (!this.ctx || this.timer) return;
    this.nextStep = this.ctx.currentTime + 0.1;
    this.stepIndex = 0;
    this.timer = window.setInterval(() => this.schedule(), 60);
  }

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || this.mode !== 'all') {
      if (ctx) this.nextStep = Math.max(this.nextStep, ctx.currentTime + 0.05);
      return;
    }
    // Never try to catch up after the page was asleep.
    if (this.nextStep < ctx.currentTime - 0.2) this.nextStep = ctx.currentTime + 0.05;
    const bpm = [88, 108, 118, 132][this.intensity];
    const stepTime = 60 / bpm / 4;
    while (this.nextStep < ctx.currentTime + LOOKAHEAD) {
      this.playStep(this.stepIndex, this.nextStep, stepTime);
      this.nextStep += stepTime;
      this.stepIndex = (this.stepIndex + 1) % 64;
    }
  }

  private playStep(index: number, t: number, step: number): void {
    const out = this.music!;
    const level = this.intensity;
    const bar = A_MINOR_LOOP[index >> 4];
    const beat = index % 16;

    if (beat === 0) {
      for (const f of bar.chord) this.tone(f, f, step * 15, 0.05, 'triangle', 0, out, t);
    }
    // Arpeggio: 8ths when calm, 16ths in a fight.
    if (level <= 1 ? beat % 2 === 0 : true) {
      const f = bar.chord[(beat >> (level <= 1 ? 1 : 0)) % 3] * (beat % 8 >= 4 ? 2 : 1);
      this.tone(f, f, step * 0.9, level === 0 ? 0.04 : 0.05, 'square', 0, out, t);
    }
    if (level === 0) return;

    if (beat % 2 === 0) this.tone(bar.bass, bar.bass, step * 1.6, 0.16, 'sawtooth', 0, out, t);
    if (beat === 0 || beat === 8 || (level >= 2 && (beat === 6 || beat === 10))) {
      this.tone(150, 40, 0.18, 0.5, 'sine', 0, out, t);
    }
    if (beat % 4 === 2 || (level >= 2 && beat % 2 === 1)) this.burst(7000, 0.04, 0.12, 'highpass', 0, out, t);
    if (level >= 2 && (beat === 4 || beat === 12)) {
      this.burst(1800, 0.14, 0.32, 'bandpass', 0, out, t);
      this.tone(220, 140, 0.08, 0.12, 'triangle', 0, out, t);
    }
    if (level >= 2 && index % 32 >= 28) this.burst(1600, 0.06, 0.16, 'bandpass', 0, out, t);
    if (level === 3 && (beat === 0 || beat === 3 || beat === 6)) {
      const f = bar.chord[2] * 2;
      this.tone(f, f, step * 2, 0.06, 'sawtooth', 0, out, t);
    }
  }
}

export function buzz(ms: number): void {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // Vibration is optional and blocked in some browsers.
  }
}
