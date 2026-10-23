import { clamp } from '../core/math.js';

/**
 * Procedural Web Audio synth — no audio files to load.
 * Player sounds stay crisp; world sounds go through a low-pass filter that
 * closes as time slows down, so slow-motion literally sounds muffled.
 */
export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.volume = 0.7;
  }

  /** Must be called from a user gesture (browser autoplay policy). */
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      const ctx = this.ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.volume;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master.connect(comp);
      comp.connect(ctx.destination);
      this.world = ctx.createBiquadFilter();
      this.world.type = 'lowpass';
      this.world.frequency.value = 18000;
      this.world.connect(this.master);

      const len = ctx.sampleRate;
      this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

      this.droneOsc = [ctx.createOscillator(), ctx.createOscillator()];
      const droneLp = ctx.createBiquadFilter();
      droneLp.type = 'lowpass';
      droneLp.frequency.value = 220;
      const droneGain = ctx.createGain();
      droneGain.gain.value = 0.05;
      this.droneOsc.forEach((o, i) => {
        o.type = 'sawtooth';
        o.frequency.value = 50 + i * 0.6;
        o.connect(droneLp);
        o.start();
      });
      droneLp.connect(droneGain);
      droneGain.connect(this.world);
    } catch {
      this.ctx = null;
    }
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  setTimeScale(ts) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.world.frequency.setTargetAtTime(500 + Math.pow(ts, 1.5) * 17500, t, 0.06);
    this.droneOsc[0].frequency.setTargetAtTime(36 + ts * 24, t, 0.1);
    this.droneOsc[1].frequency.setTargetAtTime(36.6 + ts * 24, t, 0.1);
  }

  _out(world, pan, vol) {
    const g = this.ctx.createGain();
    g.gain.value = vol;
    let node = g;
    if (pan && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1);
      g.connect(p);
      node = p;
    }
    node.connect(world ? this.world : this.master);
    return g;
  }

  tone(o) {
    if (!this.ctx) return;
    try {
      const t = this.ctx.currentTime + (o.delay || 0);
      const osc = this.ctx.createOscillator();
      const env = this.ctx.createGain();
      osc.type = o.type || 'sine';
      osc.frequency.setValueAtTime(o.f0, t);
      if (o.f1) osc.frequency.exponentialRampToValueAtTime(o.f1, t + o.dur);
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(o.vol, t + (o.attack || 0.005));
      env.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
      osc.connect(env);
      env.connect(this._out(o.world, o.pan, 1));
      osc.start(t);
      osc.stop(t + o.dur + 0.02);
    } catch {
      // A failed one-shot sound must never break gameplay.
    }
  }

  noise(o) {
    if (!this.ctx) return;
    try {
      const t = this.ctx.currentTime + (o.delay || 0);
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const f = this.ctx.createBiquadFilter();
      f.type = o.filter || 'lowpass';
      f.frequency.setValueAtTime(o.f0, t);
      if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t + o.dur);
      if (o.q) f.Q.value = o.q;
      const env = this.ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(o.vol, t + (o.attack || 0.004));
      env.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
      src.connect(f);
      f.connect(env);
      env.connect(this._out(o.world, o.pan, 1));
      src.start(t, Math.random() * 0.5);
      src.stop(t + o.dur + 0.02);
    } catch {
      // See tone().
    }
  }

  shoot() {
    this.tone({ type: 'square', f0: 1500, f1: 180, dur: 0.12, vol: 0.12 });
    this.tone({ type: 'sawtooth', f0: 700, f1: 90, dur: 0.16, vol: 0.12 });
    this.noise({ filter: 'highpass', f0: 3000, dur: 0.05, vol: 0.18 });
  }
  hit() {
    this.tone({ type: 'triangle', f0: 1700, dur: 0.05, vol: 0.18 });
  }
  headshot() {
    this.tone({ type: 'sine', f0: 2200, dur: 0.18, vol: 0.2 });
    this.tone({ type: 'sine', f0: 3300, dur: 0.22, vol: 0.12, delay: 0.03 });
  }
  shatter(pan, vol) {
    this.noise({ world: true, pan, filter: 'highpass', f0: 2600, f1: 400, dur: 0.32, vol: 0.4 * vol });
    this.tone({ world: true, pan, type: 'triangle', f0: 900, f1: 200, dur: 0.25, vol: 0.12 * vol });
  }
  explosion(pan, vol) {
    this.noise({ world: true, pan, filter: 'lowpass', f0: 900, f1: 40, dur: 0.9, vol: 0.7 * vol });
    this.tone({ world: true, pan, type: 'sine', f0: 90, f1: 28, dur: 0.7, vol: 0.6 * vol });
  }
  enemyShoot(pan, vol) {
    this.tone({ world: true, pan, type: 'square', f0: 420, f1: 90, dur: 0.18, vol: 0.12 * vol });
    this.noise({ world: true, pan, filter: 'bandpass', f0: 1200, dur: 0.08, vol: 0.12 * vol, q: 2 });
  }
  windup(pan, vol) {
    this.tone({ world: true, pan, type: 'sine', f0: 300, f1: 900, dur: 0.35, vol: 0.05 * vol, attack: 0.1 });
  }
  alert(pan, vol) {
    this.tone({ world: true, pan, type: 'sawtooth', f0: 520, dur: 0.08, vol: 0.12 * vol });
    this.tone({ world: true, pan, type: 'sawtooth', f0: 780, dur: 0.12, vol: 0.12 * vol, delay: 0.08 });
  }
  dash() {
    this.noise({ filter: 'bandpass', f0: 400, f1: 3000, dur: 0.22, vol: 0.35, q: 1.5 });
    this.tone({ type: 'sine', f0: 160, f1: 620, dur: 0.18, vol: 0.18 });
  }
  jump() {
    this.tone({ type: 'sine', f0: 220, f1: 420, dur: 0.12, vol: 0.12 });
  }
  land() {
    this.noise({ filter: 'lowpass', f0: 400, dur: 0.1, vol: 0.2 });
  }
  throwWeapon() {
    this.noise({ filter: 'bandpass', f0: 900, f1: 300, dur: 0.25, vol: 0.3, q: 3 });
  }
  deflect() {
    this.tone({ type: 'triangle', f0: 2600, f1: 1200, dur: 0.12, vol: 0.18 });
  }
  damage() {
    this.tone({ type: 'sawtooth', f0: 160, f1: 35, dur: 0.28, vol: 0.4 });
    this.noise({ filter: 'lowpass', f0: 1200, f1: 200, dur: 0.2, vol: 0.3 });
  }
  wave() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone({ type: 'square', f0: f, dur: 0.14, vol: 0.08, delay: i * 0.09 }));
  }
  gameOver() {
    [440, 349, 262, 196].forEach((f, i) => this.tone({ type: 'sawtooth', f0: f, dur: 0.3, vol: 0.1, delay: i * 0.18 }));
  }
}
