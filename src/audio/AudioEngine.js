/**
 * AudioEngine — fully procedural sound synthesis via the Web Audio API.
 * Gunshots layer a noise-burst transient, a body "crack", and a low thump;
 * impacts, reloads, hitmarkers and ambience are all generated in code so the
 * game ships without any audio assets. Includes a master limiter + reverb.
 */
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this._noiseBuffer = null;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.7;

    // gentle limiter
    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -8;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.2;

    // convolution reverb (procedural impulse)
    this.reverb = this.ctx.createConvolver();
    this.reverb.buffer = this._makeImpulse(1.6, 2.2);
    this.reverbGain = this.ctx.createGain();
    this.reverbGain.gain.value = 0.18;

    this.master.connect(this.limiter);
    this.limiter.connect(this.ctx.destination);
    this.reverb.connect(this.reverbGain);
    this.reverbGain.connect(this.limiter);

    this._noiseBuffer = this._makeNoise(2);
    this.enabled = true;
    this._startAmbience();
  }

  resume() { this.ctx?.resume?.(); }

  _makeNoise(seconds) {
    const len = this.ctx.sampleRate * seconds;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _makeImpulse(seconds, decay) {
    const len = this.ctx.sampleRate * seconds;
    const buf = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  _noiseSource() {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    return src;
  }

  _env(node, gain, dur, attack = 0.001) {
    const t = this.ctx.currentTime;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    node.connect(g);
    return g;
  }

  // ------------------------------------------------------------- SFX
  gunshot(type = 'rifle') {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const cfg = {
      rifle: { dur: 0.22, lp: 4500, thump: 90, gain: 0.9 },
      smg: { dur: 0.16, lp: 5200, thump: 120, gain: 0.72 },
      pistol: { dur: 0.2, lp: 3800, thump: 110, gain: 0.85 },
    }[type] || {};

    // transient noise crack
    const noise = this._noiseSource();
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'lowpass'; bp.frequency.value = cfg.lp; bp.Q.value = 0.7;
    const ng = this._env(bp, cfg.gain, cfg.dur, 0.0005);
    noise.connect(bp);
    ng.connect(this.master);
    ng.connect(this.reverb);
    noise.start(t); noise.stop(t + cfg.dur + 0.05);

    // low thump (osc)
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(cfg.thump, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    const og = this._env(osc, 0.7, 0.14, 0.001);
    og.connect(this.master);
    osc.start(t); osc.stop(t + 0.16);

    // high snap
    const snap = this.ctx.createOscillator();
    snap.type = 'square';
    snap.frequency.value = 1800;
    const sg = this._env(snap, 0.08, 0.04);
    sg.connect(this.master);
    snap.start(t); snap.stop(t + 0.05);
  }

  impact(type = 'default') {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const noise = this._noiseSource();
    const f = this.ctx.createBiquadFilter();
    if (type === 'metal') { f.type = 'bandpass'; f.frequency.value = 3200; f.Q.value = 3; }
    else if (type === 'flesh') { f.type = 'lowpass'; f.frequency.value = 700; }
    else { f.type = 'lowpass'; f.frequency.value = 1600; }
    const g = this._env(f, type === 'flesh' ? 0.4 : 0.25, 0.12);
    noise.connect(f); g.connect(this.master);
    noise.start(t); noise.stop(t + 0.15);
  }

  hitmarker(kill = false) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = kill ? 520 : 900;
    const g = this._env(osc, 0.18, 0.06);
    g.connect(this.master);
    osc.start(t); osc.stop(t + 0.07);
    if (kill) {
      const o2 = this.ctx.createOscillator();
      o2.type = 'triangle'; o2.frequency.value = 780;
      const g2 = this.ctx.createGain();
      g2.gain.setValueAtTime(0, t + 0.05);
      g2.gain.linearRampToValueAtTime(0.16, t + 0.055);
      g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      o2.connect(g2); g2.connect(this.master);
      o2.start(t + 0.05); o2.stop(t + 0.15);
    }
  }

  reload() {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    // click-clack sequence
    [0, 0.35, 0.7, 1.1].forEach((d, i) => {
      const noise = this._noiseSource();
      const f = this.ctx.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.value = 2000 + i * 400; f.Q.value = 5;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t + d);
      g.gain.linearRampToValueAtTime(0.2, t + d + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.06);
      noise.connect(f); f.connect(g); g.connect(this.master);
      noise.start(t + d); noise.stop(t + d + 0.08);
    });
  }

  equip() {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const noise = this._noiseSource();
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 1500; f.Q.value = 3;
    const g = this._env(f, 0.15, 0.12);
    noise.connect(f); g.connect(this.master);
    noise.start(t); noise.stop(t + 0.14);
  }

  empty() {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'square'; osc.frequency.value = 220;
    const g = this._env(osc, 0.08, 0.05);
    g.connect(this.master);
    osc.start(t); osc.stop(t + 0.06);
  }

  playerHurt() {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(80, t + 0.3);
    const g = this._env(osc, 0.2, 0.3);
    g.connect(this.master);
    osc.start(t); osc.stop(t + 0.32);
  }

  explosion() {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const noise = this._noiseSource();
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.setValueAtTime(1200, t);
    f.frequency.exponentialRampToValueAtTime(120, t + 0.6);
    const g = this._env(f, 1.0, 0.7, 0.002);
    noise.connect(f); g.connect(this.master); g.connect(this.reverb);
    noise.start(t); noise.stop(t + 0.75);
    const osc = this.ctx.createOscillator();
    osc.type = 'sine'; osc.frequency.setValueAtTime(70, t);
    osc.frequency.exponentialRampToValueAtTime(30, t + 0.5);
    const og = this._env(osc, 0.9, 0.6);
    og.connect(this.master); osc.start(t); osc.stop(t + 0.62);
  }

  _startAmbience() {
    // low desert wind bed
    const noise = this._noiseSource();
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 380;
    const g = this.ctx.createGain(); g.gain.value = 0.04;
    // slow LFO on volume for wind gusts
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.08;
    const lfoGain = this.ctx.createGain(); lfoGain.gain.value = 0.02;
    lfo.connect(lfoGain); lfoGain.connect(g.gain);
    noise.connect(lp); lp.connect(g); g.connect(this.master);
    noise.start(); lfo.start();
  }

  // routing helper used by ViewModel/others
  play(name) {
    switch (name) {
      case 'reload': return this.reload();
      case 'equip': return this.equip();
      default: return;
    }
  }
}
