// Procedural 4-cylinder engine. Pitch follows the simulated RPM (two firing pulses per
// crank revolution), timbre follows throttle load: a pulse-train oscillator pair with a
// crank-rate sub, soft clipping, a load-dependent low-pass, a body resonance and pulsed
// intake/exhaust noise. Also a faint gearbox whine and a rev-limiter stutter.

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

function pulseWave(ctx, duty = 0.3, harmonics = 40) {
  const real = new Float32Array(harmonics)
  const imag = new Float32Array(harmonics)
  for (let n = 1; n < harmonics; n++) {
    // pulse-train Fourier series with a gentle roll-off
    const a = (Math.sin(Math.PI * n * duty) / (Math.PI * n)) * Math.pow(n, -0.15)
    real[n] = a * Math.cos(n * 0.7)
    imag[n] = a * Math.sin(n * 0.7)
  }
  return ctx.createPeriodicWave(real, imag)
}

function softClip(amount = 2.5) {
  const n = 1024
  const curve = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    curve[i] = Math.tanh(x * amount) / Math.tanh(amount)
  }
  return curve
}

export class EngineSynth {
  constructor(ctx, out, noiseBuffer) {
    this.ctx = ctx
    const t = ctx.currentTime
    const wave = pulseWave(ctx, 0.28)

    this.osc1 = ctx.createOscillator()
    this.osc1.setPeriodicWave(wave)
    this.osc2 = ctx.createOscillator()
    this.osc2.setPeriodicWave(pulseWave(ctx, 0.36))
    this.sub = ctx.createOscillator()
    this.sub.type = 'sine'
    const g1 = ctx.createGain(); g1.gain.value = 0.55
    const g2 = ctx.createGain(); g2.gain.value = 0.22
    const gs = ctx.createGain(); gs.gain.value = 0.5

    this.drive = ctx.createGain()
    this.drive.gain.value = 1
    this.shaper = ctx.createWaveShaper()
    this.shaper.curve = softClip(2.2)
    this.shaper.oversample = '2x'

    this.lowpass = ctx.createBiquadFilter()
    this.lowpass.type = 'lowpass'
    this.lowpass.Q.value = 0.9
    this.lowpass.frequency.value = 600
    this.body = ctx.createBiquadFilter()
    this.body.type = 'peaking'
    this.body.frequency.value = 130
    this.body.Q.value = 1.1
    this.body.gain.value = 5
    this.highcut = ctx.createBiquadFilter()
    this.highcut.type = 'highpass'
    this.highcut.frequency.value = 28
    this.fizz = ctx.createBiquadFilter()
    this.fizz.type = 'lowpass'
    this.fizz.frequency.value = 5200
    this.fizz.Q.value = 0.5

    this.out = ctx.createGain()
    this.out.gain.value = 0

    // Intake / exhaust noise, amplitude-modulated at the firing rate
    this.noise = ctx.createBufferSource()
    this.noise.buffer = noiseBuffer
    this.noise.loop = true
    this.noiseBand = ctx.createBiquadFilter()
    this.noiseBand.type = 'bandpass'
    this.noiseBand.Q.value = 1.3
    this.noiseAM = ctx.createGain()
    this.noiseAM.gain.value = 0.5
    this.amDepth = ctx.createGain()
    this.amDepth.gain.value = 0.5
    this.noiseGain = ctx.createGain()
    this.noiseGain.gain.value = 0.05

    // Gearbox whine
    this.whine = ctx.createOscillator()
    this.whine.type = 'sine'
    this.whineGain = ctx.createGain()
    this.whineGain.gain.value = 0

    this.osc1.connect(g1).connect(this.drive)
    this.osc2.connect(g2).connect(this.drive)
    this.sub.connect(gs).connect(this.drive)
    this.drive.connect(this.shaper).connect(this.lowpass).connect(this.body).connect(this.highcut).connect(this.fizz).connect(this.out)
    this.noise.connect(this.noiseBand).connect(this.noiseAM).connect(this.noiseGain).connect(this.lowpass)
    this.osc1.connect(this.amDepth).connect(this.noiseAM.gain)
    this.whine.connect(this.whineGain).connect(this.out)
    this.out.connect(out)

    for (const o of [this.osc1, this.osc2, this.sub, this.whine]) o.start(t)
    this.noise.start(t)
    this.level = 1
    this.dip = 0
  }

  // rpm, load (0..1 engine load), throttle (0..1), wheelSpeed (m/s), gear, limiter
  update({ rpm, throttle, load, speed = 0, gear = 1, limiter = false, shift = 0 }, t = this.ctx.currentTime, tc = 0.04) {
    const f = (rpm / 60) * 2
    const r = Math.min(rpm / 7000, 1.1)
    this.osc1.frequency.setTargetAtTime(f, t, tc)
    this.osc2.frequency.setTargetAtTime(f * 1.0035, t, tc)
    this.sub.frequency.setTargetAtTime(f * 0.5, t, tc)
    this.noiseBand.frequency.setTargetAtTime(f * 3.2 + 200, t, tc)

    const cutoff = 320 + rpm * 0.18 + throttle * (900 + 2600 * r)
    this.lowpass.frequency.setTargetAtTime(cutoff, t, tc * 1.5)
    this.drive.gain.setTargetAtTime(0.7 + throttle * 2.4 + load * 0.6, t, tc)
    this.body.frequency.setTargetAtTime(110 + r * 90, t, 0.1)
    this.noiseGain.gain.setTargetAtTime(0.025 + throttle * 0.11 * (0.3 + r), t, tc)

    let gain = (0.13 + throttle * 0.07 + r * 0.08) * this.level
    if (limiter) gain *= Math.sin(t * 2 * Math.PI * 14) > 0 ? 1 : 0.35
    if (shift) gain *= 0.45
    this.out.gain.setTargetAtTime(gain, t, shift ? 0.02 : tc)

    const whineF = Math.max(60, speed * (gear > 0 ? 38 + gear * 4 : 60))
    this.whine.frequency.setTargetAtTime(whineF, t, 0.05)
    this.whineGain.gain.setTargetAtTime(Math.min(speed / 30, 1) * 0.012 * (0.4 + throttle), t, 0.1)
  }

  setLevel(v) {
    this.level = v
  }
}
