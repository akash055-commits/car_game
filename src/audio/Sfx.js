// One-shot synthesized sound effects: material impacts, exhaust pops, landing thumps,
// pickup chimes, lap jingles, UI ticks, thunder and the horn. No sample files needed.

export class Sfx {
  constructor(ctx, out, reverbSend, buffers) {
    this.ctx = ctx
    this.out = out
    this.reverb = reverbSend
    this.buffers = buffers
    this.lastImpact = {}
    this.horn = null
  }

  noiseBurst({ t, dur, filter = 'bandpass', freq = 800, q = 1, gain = 0.5, attack = 0.002, buffer = 'white', dest = this.out, sweepTo = null }) {
    const ctx = this.ctx
    const src = ctx.createBufferSource()
    src.buffer = this.buffers[buffer]
    src.loop = true
    src.playbackRate.value = 0.9 + Math.random() * 0.2
    const f = ctx.createBiquadFilter()
    f.type = filter
    f.frequency.setValueAtTime(freq, t)
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur)
    f.Q.value = q
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(gain, t + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    src.connect(f).connect(g).connect(dest)
    src.start(t, Math.random() * 1.5)
    src.stop(t + dur + 0.05)
    return g
  }

  tone({ t, freq, dur, type = 'sine', gain = 0.3, attack = 0.004, glideTo = null, dest = this.out, detune = 0 }) {
    const ctx = this.ctx
    const o = ctx.createOscillator()
    o.type = type
    o.frequency.setValueAtTime(freq, t)
    o.detune.value = detune
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(gain, t + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g).connect(dest)
    o.start(t)
    o.stop(t + dur + 0.05)
    return g
  }

  impact(material, strength, withCar = false) {
    const now = this.ctx.currentTime
    const key = material + (withCar ? 'c' : '')
    if (now - (this.lastImpact[key] || 0) < 0.08) return
    this.lastImpact[key] = now
    const s = Math.max(0.05, Math.min(1, strength))
    const v = 0.08 + s * 0.55
    const t = now + 0.005
    switch (material) {
      case 'wood':
        this.noiseBurst({ t, dur: 0.12 + s * 0.1, freq: 650, q: 1.6, gain: v * 0.7 })
        this.tone({ t, freq: 210 + Math.random() * 40, dur: 0.18, type: 'triangle', gain: v * 0.45 })
        this.tone({ t, freq: 470 + Math.random() * 60, dur: 0.1, type: 'sine', gain: v * 0.25 })
        break
      case 'metal':
        for (const [f, d, k] of [[520, 0.7, 0.35], [1380, 0.5, 0.2], [2210, 0.35, 0.12], [3020, 0.25, 0.08]]) {
          this.tone({ t, freq: f * (0.95 + Math.random() * 0.1), dur: d * (0.5 + s), gain: v * k, dest: this.out })
        }
        this.noiseBurst({ t, dur: 0.05, filter: 'highpass', freq: 2500, gain: v * 0.4 })
        break
      case 'stone':
        this.noiseBurst({ t, dur: 0.18 + s * 0.15, filter: 'lowpass', freq: 380, q: 0.7, gain: v * 0.9, buffer: 'brown' })
        this.noiseBurst({ t, dur: 0.04, filter: 'bandpass', freq: 2200, q: 1, gain: v * 0.25 })
        break
      case 'plastic':
        this.tone({ t, freq: 330 + Math.random() * 80, dur: 0.09, type: 'triangle', gain: v * 0.45, glideTo: 220 })
        this.noiseBurst({ t, dur: 0.04, freq: 1800, q: 2, gain: v * 0.2 })
        break
      default:
        this.noiseBurst({ t, dur: 0.22, filter: 'lowpass', freq: 260, gain: v * 0.9, buffer: 'brown' })
    }
    if (withCar && s > 0.25) {
      // body crunch for harder car hits
      this.noiseBurst({ t, dur: 0.25 + s * 0.2, freq: 1400, q: 0.8, gain: v * 0.35, sweepTo: 500 })
      this.tone({ t, freq: 95, dur: 0.3, gain: v * 0.6, glideTo: 45 })
    }
  }

  pop(gain = 0.25) {
    const t = this.ctx.currentTime + Math.random() * 0.02
    this.noiseBurst({ t, dur: 0.06, freq: 900 + Math.random() * 900, q: 1.2, gain })
    this.tone({ t, freq: 70, dur: 0.08, gain: gain * 0.8, glideTo: 40 })
  }

  landing(strength) {
    const t = this.ctx.currentTime
    const v = 0.15 + strength * 0.5
    this.tone({ t, freq: 110, dur: 0.32, gain: v, glideTo: 38 })
    this.noiseBurst({ t, dur: 0.25, filter: 'lowpass', freq: 300, gain: v * 0.7, buffer: 'brown' })
    this.noiseBurst({ t: t + 0.02, dur: 0.12, freq: 1600, q: 0.8, gain: v * 0.15 })
  }

  bell(t, freq, gain = 0.18, dur = 1.4) {
    this.tone({ t, freq, dur, type: 'sine', gain, dest: this.out })
    this.tone({ t, freq: freq * 2.01, dur: dur * 0.6, type: 'sine', gain: gain * 0.3, dest: this.out })
    this.tone({ t, freq, dur, type: 'triangle', gain: gain * 0.5, dest: this.reverb })
  }

  pickup() {
    const t = this.ctx.currentTime + 0.01
    ;[1046.5, 1318.5, 1568, 2093].forEach((f, i) => this.bell(t + i * 0.065, f, 0.12 - i * 0.015, 1.2))
  }

  checkpoint() {
    const t = this.ctx.currentTime + 0.01
    this.bell(t, 783.99, 0.14, 0.9)
    this.bell(t + 0.11, 1046.5, 0.14, 1.1)
  }

  lap(best) {
    const t = this.ctx.currentTime + 0.01
    const notes = best ? [523.25, 659.25, 783.99, 1046.5, 1318.5] : [523.25, 659.25, 783.99, 1046.5]
    notes.forEach((f, i) => this.bell(t + i * 0.12, f, 0.15, 1.6))
  }

  invalid() {
    const t = this.ctx.currentTime + 0.01
    this.tone({ t, freq: 392, dur: 0.25, type: 'triangle', gain: 0.12 })
    this.tone({ t: t + 0.16, freq: 311, dur: 0.35, type: 'triangle', gain: 0.12 })
  }

  complete() {
    const t = this.ctx.currentTime + 0.01
    ;[523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5, 1318.5, 1568].forEach((f, i) => this.bell(t + i * 0.1, f, 0.13, 1.8))
  }

  click() {
    const t = this.ctx.currentTime
    this.tone({ t, freq: 1800, dur: 0.05, type: 'triangle', gain: 0.06, glideTo: 1200 })
  }

  whoosh() {
    const t = this.ctx.currentTime
    this.noiseBurst({ t, dur: 1.1, freq: 300, sweepTo: 2600, q: 0.9, gain: 0.08, attack: 0.35, buffer: 'pink', dest: this.reverb })
    ;[659.25, 987.77, 1318.5].forEach((f, i) => this.bell(t + 0.25 + i * 0.09, f, 0.05, 1.5))
  }

  thunder(delay = 1) {
    const t = this.ctx.currentTime + delay
    const g = this.noiseBurst({ t, dur: 4.5, filter: 'lowpass', freq: 220, q: 0.5, gain: 0.55, attack: 0.08, buffer: 'brown' })
    void g
    this.noiseBurst({ t: t + 0.05, dur: 1.2, filter: 'lowpass', freq: 900, q: 0.6, gain: 0.18, attack: 0.02, buffer: 'pink' })
    this.noiseBurst({ t: t + 0.6, dur: 3, filter: 'lowpass', freq: 140, q: 0.6, gain: 0.35, attack: 0.3, buffer: 'brown', dest: this.reverb })
  }

  hornOn() {
    if (this.horn) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.03)
    const f = ctx.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.value = 1800
    const oscs = [392, 494].map((freq) => {
      const o = ctx.createOscillator()
      o.type = 'square'
      o.frequency.value = freq
      o.connect(f)
      o.start(t)
      return o
    })
    f.connect(g).connect(this.out)
    this.horn = { g, oscs }
  }

  hornOff() {
    if (!this.horn) return
    const t = this.ctx.currentTime
    const { g, oscs } = this.horn
    g.gain.cancelScheduledValues(t)
    g.gain.setTargetAtTime(0.0001, t, 0.03)
    oscs.forEach((o) => o.stop(t + 0.2))
    this.horn = null
  }

  // ---------------------------------------------------------------- town life
  // distance attenuation for world sounds heard from the camera
  near(d, ref = 12) {
    return 1 / (1 + (d / ref) * (d / ref))
  }

  footstep(surface = 'road', run = false, sprint = false) {
    const t = this.ctx.currentTime + 0.002
    const g = sprint ? 0.115 : run ? 0.09 : 0.06
    if (surface === 'grass' || surface === 'dirt') {
      this.noiseBurst({ t, dur: 0.09, filter: 'bandpass', freq: 1400 + Math.random() * 500, q: 0.7, gain: g * 0.8, buffer: 'pink' })
    } else if (surface === 'wood') {
      this.noiseBurst({ t, dur: 0.07, filter: 'lowpass', freq: 500, q: 1.5, gain: g * 1.4, buffer: 'brown' })
      this.tone({ t, freq: 180 + Math.random() * 40, dur: 0.06, type: 'triangle', gain: g * 0.25 })
    } else {
      this.noiseBurst({ t, dur: 0.05, filter: 'bandpass', freq: 2600 + Math.random() * 900, q: 1.2, gain: g * 0.55 })
      this.noiseBurst({ t, dur: 0.07, filter: 'lowpass', freq: 260, q: 0.8, gain: g * 0.9, buffer: 'brown' })
    }
  }

  // Little vocal blips: no words, just pitch contours (Animal-Crossing style but softer)
  voice(kind, dist) {
    const v = this.near(dist, 9)
    if (v < 0.04) return
    const now = this.ctx.currentTime
    if (now - (this.lastVoice || 0) < 0.12) return
    this.lastVoice = now
    const t = now + 0.01
    const base = 210 + Math.random() * 180
    const shapes = {
      hey: [[1, 1.25, 0.12], [1.25, 1.1, 0.14]],
      hello: [[1, 1.2, 0.1], [1.3, 1.15, 0.16]],
      yelp: [[1.4, 2.0, 0.16]],
      oof: [[1.1, 0.7, 0.2]],
      angry: [[0.85, 0.8, 0.1], [0.9, 0.75, 0.12], [0.95, 0.7, 0.16]],
      laugh: [[1.3, 1.25, 0.07], [1.3, 1.2, 0.07], [1.25, 1.1, 0.09]],
      wow: [[0.9, 1.5, 0.22]],
    }
    let at = t
    for (const [a, b, d] of shapes[kind] || shapes.hey) {
      const o = this.ctx.createOscillator()
      o.type = 'triangle'
      o.frequency.setValueAtTime(base * a, at)
      o.frequency.exponentialRampToValueAtTime(base * b, at + d)
      const f = this.ctx.createBiquadFilter()
      f.type = 'bandpass'
      f.frequency.value = base * 3.2
      f.Q.value = 1.4
      const g = this.ctx.createGain()
      g.gain.setValueAtTime(0.0001, at)
      g.gain.exponentialRampToValueAtTime(0.11 * v, at + 0.015)
      g.gain.exponentialRampToValueAtTime(0.0001, at + d)
      o.connect(f).connect(g).connect(this.out)
      o.start(at)
      o.stop(at + d + 0.05)
      at += d * 0.9
    }
  }

  hammer(dist) {
    const v = this.near(dist, 14)
    if (v < 0.03) return
    const t = this.ctx.currentTime + 0.005
    this.tone({ t, freq: 1700 + Math.random() * 500, dur: 0.07, type: 'triangle', gain: 0.05 * v })
    this.noiseBurst({ t, dur: 0.06, freq: 2400, q: 2, gain: 0.07 * v })
    this.noiseBurst({ t, dur: 0.1, filter: 'lowpass', freq: 380, gain: 0.08 * v, buffer: 'brown' })
  }

  honk(dist) {
    const v = this.near(dist, 22)
    if (v < 0.03) return
    const t = this.ctx.currentTime + 0.01
    const dur = 0.28 + Math.random() * 0.2
    for (const f of [350, 440]) this.tone({ t, freq: f + Math.random() * 20, dur, type: 'square', gain: 0.022 * v, attack: 0.02 })
    this.tone({ t: t + dur + 0.1, freq: 350, dur: dur * 0.6, type: 'square', gain: 0.018 * v, attack: 0.02 })
  }

  coin(n = 1) {
    const t = this.ctx.currentTime + 0.01
    const k = Math.min(4, Math.max(1, Math.round(n / 40)))
    for (let i = 0; i < k; i++) {
      this.bell(t + i * 0.07, 1567.98, 0.07, 0.5)
      this.bell(t + i * 0.07 + 0.05, 2093, 0.06, 0.7)
    }
  }

  beep(go = false) {
    const t = this.ctx.currentTime + 0.01
    this.tone({ t, freq: go ? 1046.5 : 523.25, dur: go ? 0.6 : 0.22, type: 'triangle', gain: 0.12 })
    this.tone({ t, freq: go ? 2093 : 1046.5, dur: go ? 0.4 : 0.15, type: 'sine', gain: 0.04 })
  }

  door(open = true) {
    const t = this.ctx.currentTime + 0.01
    this.noiseBurst({ t, dur: 0.12, filter: 'lowpass', freq: open ? 700 : 450, gain: 0.12, buffer: 'brown' })
    this.tone({ t: t + 0.01, freq: open ? 140 : 110, dur: 0.12, type: 'sine', gain: 0.08 })
    this.noiseBurst({ t: t + 0.015, dur: 0.05, freq: 3000, q: 1.5, gain: 0.03 })
  }

  starter() {
    // helicopter: starter click + igniter ticks
    const t = this.ctx.currentTime + 0.01
    this.tone({ t, freq: 900, dur: 0.05, type: 'square', gain: 0.03 })
    for (let i = 0; i < 8; i++) this.noiseBurst({ t: t + 0.25 + i * 0.13, dur: 0.03, freq: 4200, q: 3, gain: 0.04 })
  }

  smash(dist) {
    const v = this.near(dist, 16)
    const t = this.ctx.currentTime + 0.01
    this.noiseBurst({ t, dur: 0.45, filter: 'lowpass', freq: 500, gain: 0.3 * v, buffer: 'brown' })
    for (let i = 0; i < 5; i++) this.noiseBurst({ t: t + 0.05 + Math.random() * 0.4, dur: 0.12, freq: 900 + Math.random() * 800, q: 1.2, gain: 0.08 * v, buffer: 'pink' })
  }

  fanfare() {
    const t = this.ctx.currentTime + 0.01
    ;[587.33, 739.99, 880, 1174.66].forEach((f, i) => this.bell(t + i * 0.09, f, 0.1, 1.3))
  }
}
