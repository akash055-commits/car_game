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
}
