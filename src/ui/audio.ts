type Sound = 'rifle' | 'cannon' | 'boom' | 'bigBoom' | 'click' | 'deny' | 'capture' | 'alert' | 'done' | 'jet';

const MIN_GAP: Record<Sound, number> = {
  rifle: 0.07, cannon: 0.12, boom: 0.08, bigBoom: 0.2, click: 0.03, deny: 0.2, capture: 0.3, alert: 1.5, done: 0.2, jet: 0.5,
};

/** All sound is synthesized, so the game ships no audio files. */
export class GameAudio {
  muted = false;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private last = new Map<Sound, number>();

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
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    const length = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  }

  private tone(freq: number, end: number, duration: number, volume: number, wave: OscillatorType, delay = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, end), t + duration);
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain).connect(this.master!);
    osc.start(t);
    osc.stop(t + duration);
  }

  private burst(cutoff: number, duration: number, volume: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(filter).connect(gain).connect(this.master!);
    src.start(t, Math.random() * 0.5, duration);
  }

  play(sound: Sound): void {
    if (this.muted || !this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    if (now - (this.last.get(sound) ?? -9) < MIN_GAP[sound]) return;
    this.last.set(sound, now);
    switch (sound) {
      case 'rifle': this.burst(3200, 0.07, 0.1); break;
      case 'cannon': this.burst(900, 0.2, 0.28); this.tone(140, 50, 0.16, 0.25, 'sine'); break;
      case 'boom': this.burst(600, 0.4, 0.4); this.tone(90, 30, 0.3, 0.3, 'sine'); break;
      case 'bigBoom': this.burst(420, 0.9, 0.7); this.tone(70, 22, 0.7, 0.5, 'sine'); break;
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
      case 'jet': this.burst(1500, 1.5, 0.22); this.tone(420, 120, 1.4, 0.07, 'sawtooth'); break;
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
