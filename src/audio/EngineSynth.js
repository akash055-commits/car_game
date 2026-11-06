// Procedural engines, one voice per vehicle type. Pitch follows the simulated RPM
// (firing pulses per crank revolution depend on the engine layout), timbre follows
// throttle load. Each voice is a pulse-train oscillator pair through soft clipping, a
// load-dependent low-pass, a body resonance, an exhaust "presence" resonance and a real
// high-pass, plus intake / exhaust noise amplitude-modulated at the firing rate.
//
//  • car  — inline-four: two pulses per rev, mid-range growl, very little sub
//  • bike — parallel twin: one sharp pulse per rev, raspy "can" resonance, lumpy idle
//  • tank — V12 diesel: six pulses per rev, knocking clatter, turbo whistle

export function createNoiseBuffer(ctx, seconds = 2, type = 'white') {
  const len = Math.floor(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = buf.getChannelData(0)
  let b0 = 0, b1 = 0, b2 = 0, last = 0
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1
    if (type === 'pink') {
      b0 = 0.99765 * b0 + w * 0.099046
      b1 = 0.963 * b1 + w * 0.2965164
      b2 = 0.57 * b2 + w * 1.0526913
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2
    } else if (type === 'brown') {
      last = (last + 0.02 * w) / 1.02
      d[i] = last * 3.5
    } else d[i] = w
  }
  return buf
}

// Pulse-train Fourier series. Narrow duty = more upper harmonics (brighter, raspier).
export function pulseWave(ctx, duty = 0.3, harmonics = 48, rolloff = 0.15, phase = 0.7) {
  const real = new Float32Array(harmonics)
  const imag = new Float32Array(harmonics)
  for (let n = 1; n < harmonics; n++) {
    const a = (Math.sin(Math.PI * n * duty) / (Math.PI * n)) * Math.pow(n, -rolloff)
    real[n] = a * Math.cos(n * phase)
    imag[n] = a * Math.sin(n * phase)
  }
  return ctx.createPeriodicWave(real, imag)
}

export function softClip(amount = 2.5) {
  const n = 1024
  const curve = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    curve[i] = Math.tanh(x * amount) / Math.tanh(amount)
  }
  return curve
}

export const ENGINE_PROFILES = {
  car: {
    pulses: 2, duty: [0.2, 0.28], rolloff: 0.03, detune: 1.0035, mix: [0.5, 0.24], sub: 0.03,
    clip: 1.9, drive: [0.55, 1.6, 0.35],
    lp: { base: 900, rpm: 2200, thr: 1200, thrR: 2600, q: 0.6 },
    body: { f: [240, 400], q: 0.9, gain: 2.5 },
    presence: { f: [1100, 1900], q: 1.1, gain: 5.5 },
    hp: 95,
    noise: { mul: 4.2, add: 450, q: 1.1, base: 0.025, thr: 0.09 },
    rasp: { f: 2400, q: 1.2, base: 0.006, thr: 0.03, depth: 0.6 },
    gain: { base: 0.12, thr: 0.07, r: 0.07 },
    redline: 6900, jitter: 0.02, whine: 0.011, turbo: 0,
  },
  bike: {
    pulses: 1, duty: [0.11, 0.17], rolloff: 0, detune: 1.011, mix: [0.46, 0.3], sub: 0,
    clip: 2.4, drive: [0.6, 1.9, 0.3],
    lp: { base: 1500, rpm: 3000, thr: 1500, thrR: 3500, q: 0.5 },
    body: { f: [380, 650], q: 1.0, gain: 1.5 },
    presence: { f: [1600, 3200], q: 1.8, gain: 6.5 },
    hp: 120,
    noise: { mul: 6, add: 700, q: 1.0, base: 0.02, thr: 0.07 },
    rasp: { f: 2900, q: 0.9, base: 0.018, thr: 0.13, depth: 0.85 },
    gain: { base: 0.1, thr: 0.07, r: 0.06 },
    redline: 11000, jitter: 0.18, whine: 0.006, turbo: 0,
  },
  tank: {
    pulses: 6, duty: [0.3, 0.38], rolloff: 0.22, detune: 1.006, mix: [0.5, 0.26], sub: 0.1,
    clip: 2.2, drive: [0.7, 1.8, 0.6],
    lp: { base: 520, rpm: 1500, thr: 900, thrR: 1400, q: 0.7 },
    body: { f: [95, 160], q: 1.0, gain: 3 },
    presence: { f: [700, 1100], q: 1.0, gain: 2.5 },
    hp: 55,
    noise: { mul: 3, add: 300, q: 1.0, base: 0.03, thr: 0.08 },
    rasp: { f: 2100, q: 1.4, base: 0.05, thr: 0.12, depth: 0.95 }, // diesel knock clatter
    gain: { base: 0.13, thr: 0.07, r: 0.06 },
    redline: 2600, jitter: 0.04, whine: 0.004, turbo: 0.012,
  },
}

export class EngineSynth {
  constructor(ctx, out, noiseBuffer, profile = ENGINE_PROFILES.car) {
    this.ctx = ctx
    this.p = profile
    const P = profile
    const t = ctx.currentTime

    this.osc1 = ctx.createOscillator()
    this.osc1.setPeriodicWave(pulseWave(ctx, P.duty[0], 48, P.rolloff))
    this.osc2 = ctx.createOscillator()
    this.osc2.setPeriodicWave(pulseWave(ctx, P.duty[1], 48, P.rolloff, 1.3))
    this.sub = ctx.createOscillator()
    this.sub.type = 'sine'
    const g1 = ctx.createGain(); g1.gain.value = P.mix[0]
    const g2 = ctx.createGain(); g2.gain.value = P.mix[1]
    const gs = ctx.createGain(); gs.gain.value = P.sub

    this.drive = ctx.createGain()
    this.shaper = ctx.createWaveShaper()
    this.shaper.curve = softClip(P.clip)
    this.shaper.oversample = '2x'

    const biquad = (type, f, q = 0.7, gain = 0) => {
      const b = ctx.createBiquadFilter()
      b.type = type
      b.frequency.value = f
      b.Q.value = q
      b.gain.value = gain
      return b
    }
    this.lowpass = biquad('lowpass', P.lp.base, P.lp.q)
    this.body = biquad('peaking', P.body.f[0], P.body.q, P.body.gain)
    this.presence = biquad('peaking', P.presence.f[0], P.presence.q, P.presence.gain)
    this.highpass = biquad('highpass', P.hp, 0.7)
    this.fizz = biquad('lowpass', 9000, 0.5)
    this.out = ctx.createGain()
    this.out.gain.value = 0

    // Intake / exhaust noise, amplitude-modulated at the firing rate (goes through the low-pass)
    const noiseSrc = (rate = 1) => {
      const s = ctx.createBufferSource()
      s.buffer = noiseBuffer
      s.loop = true
      s.playbackRate.value = rate
      s.start(t, Math.random() * 1.5)
      return s
    }
    this.noiseBand = biquad('bandpass', 600, P.noise.q)
    this.noiseAM = ctx.createGain()
    this.noiseAM.gain.value = 0.5
    const amDepth = ctx.createGain()
    amDepth.gain.value = 0.5
    this.noiseGain = ctx.createGain()
    this.noiseGain.gain.value = P.noise.base
    noiseSrc().connect(this.noiseBand).connect(this.noiseAM).connect(this.noiseGain).connect(this.lowpass)
    this.osc1.connect(amDepth).connect(this.noiseAM.gain)

    // Rasp (bike exhaust crackle / diesel knock): bright noise pulsed by the firing rate,
    // bypasses the low-pass so it stays crisp
    this.raspBand = biquad('bandpass', P.rasp.f, P.rasp.q)
    this.raspAM = ctx.createGain()
    this.raspAM.gain.value = 1 - P.rasp.depth
    const raspDepth = ctx.createGain()
    raspDepth.gain.value = P.rasp.depth
    this.raspGain = ctx.createGain()
    this.raspGain.gain.value = P.rasp.base
    noiseSrc(0.9).connect(this.raspBand).connect(this.raspAM).connect(this.raspGain).connect(this.highpass)
    this.osc2.connect(raspDepth).connect(this.raspAM.gain)

    // Gearbox whine + optional turbo whistle
    this.whine = ctx.createOscillator()
    this.whine.type = 'sine'
    this.whineGain = ctx.createGain()
    this.whineGain.gain.value = 0
    this.turbo = ctx.createOscillator()
    this.turbo.type = 'sine'
    this.turboGain = ctx.createGain()
    this.turboGain.gain.value = 0

    this.osc1.connect(g1).connect(this.drive)
    this.osc2.connect(g2).connect(this.drive)
    this.sub.connect(gs).connect(this.drive)
    this.drive.connect(this.shaper).connect(this.lowpass).connect(this.body).connect(this.presence).connect(this.highpass).connect(this.fizz).connect(this.out)
    this.whine.connect(this.whineGain).connect(this.out)
    this.turbo.connect(this.turboGain).connect(this.out)
    this.out.connect(out)

    for (const o of [this.osc1, this.osc2, this.sub, this.whine, this.turbo]) o.start(t)
    this.level = 0
    this.redline = P.redline
    this.lump = 1
  }

  // rpm, load (0..1 engine load), throttle (0..1), wheelSpeed (m/s), gear, limiter
  update({ rpm, throttle, load, speed = 0, gear = 1, limiter = false, shift = 0, nitro = false }, t = this.ctx.currentTime, tc = 0.04) {
    const P = this.p
    if (this.level < 0.002) {
      this.out.gain.setTargetAtTime(0, t, 0.08)
      return
    }
    const f = (rpm / 60) * P.pulses
    const r = Math.min(rpm / this.redline, 1.1)
    this.osc1.frequency.setTargetAtTime(f, t, tc)
    this.osc2.frequency.setTargetAtTime(f * P.detune, t, tc)
    this.sub.frequency.setTargetAtTime(f * 0.5, t, tc)
    this.noiseBand.frequency.setTargetAtTime(Math.min(f * P.noise.mul + P.noise.add, 7000), t, tc)

    const cutoff = Math.min(P.lp.base + r * P.lp.rpm + throttle * (P.lp.thr + P.lp.thrR * r), 9500)
    this.lowpass.frequency.setTargetAtTime(cutoff, t, tc * 1.5)
    this.drive.gain.setTargetAtTime(P.drive[0] + throttle * P.drive[1] + load * P.drive[2], t, tc)
    this.body.frequency.setTargetAtTime(P.body.f[0] + Math.min(r, 1) * (P.body.f[1] - P.body.f[0]), t, 0.1)
    this.presence.frequency.setTargetAtTime(P.presence.f[0] + Math.min(r, 1) * (P.presence.f[1] - P.presence.f[0]), t, 0.1)
    this.noiseGain.gain.setTargetAtTime(P.noise.base + throttle * P.noise.thr * (0.3 + r), t, tc)
    this.raspGain.gain.setTargetAtTime(P.rasp.base + throttle * P.rasp.thr * (0.4 + r) + (nitro ? 0.04 : 0), t, tc)

    // Lumpy idle: slow random wobble that fades out as the revs rise
    const idleness = Math.max(0, 1 - r * 3)
    this.lump += ((1 + (Math.random() - 0.5) * 2 * P.jitter * idleness) - this.lump) * 0.5
    let gain = (P.gain.base + throttle * P.gain.thr + r * P.gain.r) * this.level * this.lump
    if (limiter) gain *= Math.sin(t * 2 * Math.PI * 14) > 0 ? 1 : 0.35
    if (shift) gain *= 0.45
    this.out.gain.setTargetAtTime(gain, t, shift ? 0.02 : tc)

    const whineF = Math.max(60, speed * (gear > 0 ? 38 + gear * 4 : 60))
    this.whine.frequency.setTargetAtTime(whineF, t, 0.05)
    this.whineGain.gain.setTargetAtTime(Math.min(speed / 30, 1) * P.whine * (0.4 + throttle) * this.level, t, 0.1)
    if (P.turbo) {
      this.turbo.frequency.setTargetAtTime(1500 + Math.min(r, 1) * 3600, t, 0.25)
      this.turboGain.gain.setTargetAtTime(P.turbo * throttle * (0.3 + r) * this.level, t, 0.3)
    }
  }

  setLevel(v) {
    this.level = v
  }
}
