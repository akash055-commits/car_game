import { clamp } from './utils.js';

/**
 * Fully procedural audio (Web Audio API): no external files, works offline.
 * Engine = layered oscillators shaped by RPM & load, plus tyres, wind, turbo,
 * impacts, UI blips and a generative synthwave soundtrack.
 */
export class AudioEngine {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.started = false;
    this.muted = false;
  }

  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.music = ctx.createGain();
    this.sfx.connect(this.master);
    this.music.connect(this.master);
    this.applyVolumes();
    this.noise = this.makeNoise(2);

    // Shared reverb-ish send for the music
    this.buildEngine();
    this.buildLoops();
    this.started = true;
  }

  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : 1, t, 0.05);
    this.sfx.gain.setTargetAtTime(this.settings.sfx, t, 0.05);
    this.music.gain.setTargetAtTime(this.settings.music * 0.55, t, 0.05);
  }

  toggleMute() { this.muted = !this.muted; this.applyVolumes(); return this.muted; }

  makeNoise(seconds) {
    const len = this.ctx.sampleRate * seconds;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  noiseSource(loop = true) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = loop;
    return s;
  }

  buildEngine() {
    const ctx = this.ctx;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.Q.value = 3;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 1.5); }
    shaper.curve = curve;
    const pre = ctx.createGain();
    pre.gain.value = 0.7;
    // high-pass removes the boomy sub-bass so the engine sings rather than rumbles
    this.engineHP = ctx.createBiquadFilter();
    this.engineHP.type = 'highpass';
    this.engineHP.frequency.value = 140;
    this.engineHP.Q.value = 0.6;
    // gentle presence peak = the "sweet" mid-range wail of a high-revving V12
    this.enginePeak = ctx.createBiquadFilter();
    this.enginePeak.type = 'peaking';
    this.enginePeak.gain.value = 5;
    this.enginePeak.Q.value = 1.4;
    pre.connect(shaper).connect(this.engineFilter).connect(this.engineHP).connect(this.enginePeak).connect(this.engineGain).connect(this.sfx);

    const mk = (type, gain, detune = 0) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g).connect(pre);
      o.start();
      return { o, g };
    };
    this.eng = [
      mk('sawtooth', 0.42), mk('sawtooth', 0.26, 9), mk('triangle', 0.3), mk('sine', 0.12), mk('sawtooth', 0.08),
    ];
    // Combustion "grit": noise amplitude-modulated around the firing frequency
    const n = this.noiseSource();
    const nf = ctx.createBiquadFilter();
    nf.type = 'bandpass'; nf.Q.value = 1.2; nf.frequency.value = 600;
    this.gritGain = ctx.createGain();
    this.gritGain.gain.value = 0.0;
    n.connect(nf).connect(this.gritGain).connect(this.engineFilter);
    n.start();
    this.gritFilter = nf;

    // Turbo whistle
    const turbo = ctx.createOscillator();
    turbo.type = 'sine';
    this.turboGain = ctx.createGain();
    this.turboGain.gain.value = 0;
    turbo.connect(this.turboGain).connect(this.sfx);
    turbo.start();
    this.turbo = turbo;
  }

  buildLoops() {
    const ctx = this.ctx;
    const loop = (type, freq, q) => {
      const s = this.noiseSource();
      const f = ctx.createBiquadFilter();
      f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      s.connect(f).connect(g).connect(this.sfx);
      s.start();
      return { f, g };
    };
    this.squeal = loop('bandpass', 1150, 9);
    this.squeal2 = loop('bandpass', 2100, 14);
    this.gravel = loop('lowpass', 500, 0.7);
    this.wind = loop('lowpass', 400, 0.5);
    this.nitroHiss = loop('highpass', 2500, 0.7);
    this.road = loop('lowpass', 140, 0.8);
    // squeal pitch wobble
    const tone = ctx.createOscillator();
    tone.type = 'triangle'; tone.frequency.value = 1180;
    this.squealTone = ctx.createGain();
    this.squealTone.gain.value = 0;
    tone.connect(this.squealTone).connect(this.sfx);
    tone.start();
    this.squealOsc = tone;
  }

  /** Called every frame with the car's state. */
  update(car, { offRoad = false, paused = false } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const set = (param, v, tc = 0.05) => param.setTargetAtTime(v, t, tc);
    if (paused) {
      for (const g of [this.engineGain, this.squeal.g, this.squeal2.g, this.gravel.g, this.wind.g, this.nitroHiss.g, this.road.g, this.squealTone, this.turboGain])
        set(g.gain, 0, 0.08);
      return;
    }
    const rpm = car.rpm;
    const load = car.throttleSmoothed;
    const fire = (rpm / 60) * 6; // V12: 6 firing pulses per revolution → a smooth, high wail
    const [a, b, c, d, e] = this.eng;
    set(a.o.frequency, fire, 0.02);
    set(b.o.frequency, fire * 1.003, 0.02);
    set(c.o.frequency, fire * 2, 0.02);
    set(d.o.frequency, fire * 0.5, 0.02);
    set(e.o.frequency, fire * 3, 0.02);
    set(this.engineFilter.frequency, 700 + rpm * 0.45 + load * 2600, 0.04);
    set(this.enginePeak.frequency, fire * 2.2, 0.04);
    set(this.engineGain.gain, 0.09 + load * 0.13 + (rpm / 7600) * 0.09, 0.05);
    set(this.gritFilter.frequency, fire * 2.5, 0.05);
    set(this.gritGain.gain, 0.05 + load * 0.12, 0.05);
    set(this.turbo.frequency, 1800 + rpm * 0.6, 0.1);
    set(this.turboGain.gain, load * Math.max(0, rpm - 3500) / 4000 * 0.018, 0.15);

    const skid = Math.max(car.skid[0], car.skid[1], car.skid[2], car.skid[3]);
    const onTarmac = !offRoad;
    set(this.squeal.g.gain, onTarmac ? skid * 0.55 : 0, 0.04);
    set(this.squeal2.g.gain, onTarmac ? skid * 0.18 : 0, 0.04);
    set(this.squealTone.gain, onTarmac ? skid * 0.025 : 0, 0.04);
    this.squealOsc.frequency.setTargetAtTime(1100 + Math.sin(t * 23) * 60 + car.speed * 4, t, 0.02);
    const sp = car.speed;
    set(this.gravel.g.gain, offRoad && car.onGroundCount > 0 ? clamp(sp / 25, 0, 1) * 0.5 : 0, 0.06);
    set(this.wind.g.gain, clamp(sp / 70, 0, 1) ** 2 * 0.5, 0.1);
    set(this.wind.f.frequency, 300 + sp * 18, 0.1);
    set(this.road.g.gain, car.onGroundCount > 0 ? clamp(sp / 40, 0, 1) * 0.35 : 0, 0.08);
    set(this.nitroHiss.g.gain, car.nitroActive ? 0.22 : 0, 0.06);
  }

  // -------- one-shots
  env(gainNode, peak, attack, decay) {
    const t = this.ctx.currentTime;
    gainNode.gain.setValueAtTime(0, t);
    gainNode.gain.linearRampToValueAtTime(peak, t + attack);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  blip(freq, dur = 0.12, type = 'sine', vol = 0.25, when = 0, slide = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  noiseHit(vol, freq, dur, type = 'lowpass', q = 0.7, sweepTo = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const s = this.noiseSource(false);
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = this.ctx.createGain();
    s.connect(f).connect(g).connect(this.sfx);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.start(t, Math.random());
    s.stop(t + dur + 0.05);
  }

  impact(strength) {
    if (!this.ctx) return;
    const v = clamp(strength / 12, 0.08, 1);
    this.noiseHit(v * 0.9, 900 + v * 1800, 0.25 + v * 0.35, 'lowpass', 0.8, 120);
    this.blip(70 + Math.random() * 30, 0.25 + v * 0.2, 'sine', v * 0.9, 0, 0.5);
    if (v > 0.45) this.noiseHit(v * 0.25, 4500, 0.4, 'highpass', 0.5); // glass/metal rattle
  }

  shift() {
    if (!this.ctx) return;
    this.noiseHit(0.12, 2200, 0.09, 'bandpass', 2);
  }

  backfire() {
    if (!this.ctx) return;
    this.noiseHit(0.55, 700, 0.12, 'lowpass', 1);
    this.blip(55, 0.1, 'square', 0.25, 0, 0.6);
    this.noiseHit(0.35, 500, 0.1, 'lowpass', 1);
  }

  blowoff() {
    if (!this.ctx) return;
    this.noiseHit(0.18, 3000, 0.35, 'bandpass', 3, 900);
  }

  coin() { this.blip(988, 0.09, 'square', 0.12); this.blip(1319, 0.25, 'square', 0.12, 0.08); }
  powerup() { [523, 659, 784, 1047].forEach((f, i) => this.blip(f, 0.18, 'triangle', 0.18, i * 0.06)); }
  checkpoint() { this.blip(880, 0.12, 'sine', 0.2); this.blip(1320, 0.2, 'sine', 0.2, 0.1); }
  lap() { [659, 784, 988, 1319].forEach((f, i) => this.blip(f, 0.25, 'triangle', 0.22, i * 0.09)); }
  countdown(go) { go ? this.blip(880, 0.6, 'square', 0.18) : this.blip(440, 0.25, 'square', 0.16); }
  uiHover() { this.blip(1400, 0.04, 'sine', 0.06); }
  uiClick() { this.blip(700, 0.08, 'triangle', 0.15, 0, 1.6); }
  drift(mult) { this.blip(500 + mult * 120, 0.15, 'triangle', 0.15, 0, 1.5); }
  splashSound() { this.noiseHit(0.4, 1200, 0.5, 'bandpass', 0.8, 300); }
  fail() { this.blip(330, 0.2, 'sawtooth', 0.12, 0, 0.6); this.blip(220, 0.35, 'sawtooth', 0.12, 0.15, 0.6); }

  // -------- generative music (synthwave-ish), scheduled with lookahead
  startMusic() {
    if (!this.ctx || this.musicTimer) return;
    this.bpm = 112;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.1;
    const progression = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]; // Am F C G
    this.progression = progression;
    this.musicTimer = setInterval(() => this.scheduleMusic(), 50);
  }

  stopMusic() { clearInterval(this.musicTimer); this.musicTimer = null; }

  scheduleMusic() {
    const ctx = this.ctx;
    const stepDur = 60 / this.bpm / 4;
    while (this.nextTime < ctx.currentTime + 0.25) {
      const s = this.step % 64;
      const chord = this.progression[Math.floor(s / 16) % 4];
      const t = this.nextTime;
      const mtof = (m) => 440 * 2 ** ((m - 69) / 12);
      // kick on beats
      if (s % 4 === 0) this.musicKick(t);
      // snare on 2 & 4
      if (s % 8 === 4) this.musicSnare(t);
      // hats
      if (s % 2 === 1) this.musicHat(t, s % 4 === 3 ? 0.05 : 0.025);
      // bass: octave pulses
      if (s % 2 === 0) this.musicNote(mtof(chord[0] - 24 + (s % 4 === 2 ? 12 : 0)), t, stepDur * 1.8, 'sawtooth', 0.11, 700);
      // pad at chord change
      if (s % 16 === 0) chord.forEach((m) => this.musicNote(mtof(m), t, stepDur * 16, 'sawtooth', 0.025, 1400, 0.4));
      // arpeggio
      if (s % 2 === 0 && s >= 0) {
        const arp = [chord[0] + 12, chord[1] + 12, chord[2] + 12, chord[1] + 24];
        this.musicNote(mtof(arp[(s / 2) % 4]), t, stepDur * 1.5, 'square', 0.022, 2600);
      }
      this.nextTime += stepDur;
      this.step++;
    }
  }

  musicNote(freq, t, dur, type, vol, cutoff, attack = 0.01) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type; o.frequency.value = freq;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = cutoff; f.Q.value = 2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(g).connect(this.music);
    o.start(t); o.stop(t + dur + 0.05);
  }

  musicKick(t) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.45, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g).connect(this.music);
    o.start(t); o.stop(t + 0.35);
  }

  musicSnare(t) {
    const s = this.noiseSource(false);
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.8;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    s.connect(f).connect(g).connect(this.music);
    s.start(t, Math.random()); s.stop(t + 0.2);
  }

  musicHat(t, vol) {
    const s = this.noiseSource(false);
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = 7000;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    s.connect(f).connect(g).connect(this.music);
    s.start(t, Math.random()); s.stop(t + 0.06);
  }
}
