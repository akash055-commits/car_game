// Continuous machine sounds that aren't the player's engine: the helicopter (blade slap,
// rotor wash, tail-rotor buzz and turbine whine, all scaled by rotor speed and distance)
// and airliner jet roar from aircraft near the listener.

export function pulseTrain(ctx, sharpness = 6, harmonics = 24) {
  // periodic "slap": narrow positive pulses, used as an amplitude envelope
  const real = new Float32Array(harmonics)
  const imag = new Float32Array(harmonics)
  for (let n = 1; n < harmonics; n++) real[n] = Math.exp(-n / sharpness)
  return ctx.createPeriodicWave(real, imag, { disableNormalization: false })
}

export class HeliSynth {
  constructor(ctx, out, buffers) {
    this.ctx = ctx
    const loop = (buf) => {
      const s = ctx.createBufferSource()
      s.buffer = buffers[buf]
      s.loop = true
      s.start(0, Math.random())
      return s
    }
    this.out = ctx.createGain()
    this.out.gain.value = 0
    this.cabin = ctx.createBiquadFilter() // muffles the sound when you're inside
    this.cabin.type = 'lowpass'
    this.cabin.frequency.value = 9000
    this.out.connect(this.cabin).connect(out)

    // Blade slap: noise through a low band, amplitude-modulated by a pulse train
    this.slapLfo = ctx.createOscillator()
    this.slapLfo.setPeriodicWave(pulseTrain(ctx, 5))
    this.slapLfo.frequency.value = 0
    this.slapDepth = ctx.createGain()
    this.slapDepth.gain.value = 0
    this.slapAmp = ctx.createGain()
    this.slapAmp.gain.value = 0
    this.slapLfo.connect(this.slapDepth).connect(this.slapAmp.gain)
    const slapBand = ctx.createBiquadFilter()
    slapBand.type = 'bandpass'
    slapBand.frequency.value = 220
    slapBand.Q.value = 0.9
    loop('brown').connect(slapBand).connect(this.slapAmp).connect(this.out)
    this.slapLfo.start()
    // Thump: a low sine pulsed by the same LFO
    this.thump = ctx.createOscillator()
    this.thump.frequency.value = 55
    this.thumpAmp = ctx.createGain()
    this.thumpAmp.gain.value = 0
    this.thumpDepth = ctx.createGain()
    this.thumpDepth.gain.value = 0
    this.slapLfo.connect(this.thumpDepth).connect(this.thumpAmp.gain)
    this.thump.connect(this.thumpAmp).connect(this.out)
    this.thump.start()

    // Rotor wash: broadband air
    this.wash = ctx.createGain()
    this.wash.gain.value = 0
    this.washFilter = ctx.createBiquadFilter()
    this.washFilter.type = 'bandpass'
    this.washFilter.frequency.value = 700
    this.washFilter.Q.value = 0.5
    loop('pink').connect(this.washFilter).connect(this.wash).connect(this.out)

    // Tail rotor buzz
    this.tail = ctx.createOscillator()
    this.tail.type = 'sawtooth'
    this.tail.frequency.value = 0
    const tailF = ctx.createBiquadFilter()
    tailF.type = 'lowpass'
    tailF.frequency.value = 700
    this.tailAmp = ctx.createGain()
    this.tailAmp.gain.value = 0
    this.tail.connect(tailF).connect(this.tailAmp).connect(this.out)
    this.tail.start()

    // Turbine whine: two inharmonic sines
    this.turbAmp = ctx.createGain()
    this.turbAmp.gain.value = 0
    this.turb = [ctx.createOscillator(), ctx.createOscillator()]
    this.turb.forEach((o) => { o.type = 'sine'; o.frequency.value = 0; o.connect(this.turbAmp); o.start() })
    this.turbAmp.connect(this.out)
  }

  // rotor 0..1, load 0..1 (collective), dist from the camera, inside = player is flying it
  update(t, { rotor, load, dist, inside, speed = 0 }) {
    const r = rotor
    const bladeRate = r * 10.5 // two blades * ~5.3 rev/s at full speed
    this.slapLfo.frequency.setTargetAtTime(Math.max(0.01, bladeRate), t, 0.1)
    const slap = r * r * (0.32 + load * 0.5 + Math.min(speed / 40, 1) * 0.2)
    this.slapDepth.gain.setTargetAtTime(slap, t, 0.1)
    this.thumpDepth.gain.setTargetAtTime(r * r * (0.08 + load * 0.08), t, 0.1)
    this.thump.frequency.setTargetAtTime(40 + r * 22, t, 0.1)
    this.wash.gain.setTargetAtTime(r * r * (0.05 + load * 0.06), t, 0.15)
    this.washFilter.frequency.setTargetAtTime(400 + r * 700 + load * 300, t, 0.15)
    this.tail.frequency.setTargetAtTime(Math.max(1, r * 58), t, 0.1)
    this.tailAmp.gain.setTargetAtTime(r * 0.035, t, 0.1)
    // the turbine spools a little ahead of the rotor so start-up has a rising whine
    const spool = Math.min(1, r * 1.35)
    this.turb[0].frequency.setTargetAtTime(600 + spool * 2600, t, 0.2)
    this.turb[1].frequency.setTargetAtTime(950 + spool * 3700, t, 0.2)
    this.turbAmp.gain.setTargetAtTime(spool > 0.02 ? 0.006 + spool * 0.01 : 0, t, 0.2)
    const atten = inside ? 0.7 : 1 / (1 + (dist / 28) ** 2)
    this.out.gain.setTargetAtTime(r > 0.005 ? atten : 0, t, 0.12)
    this.cabin.frequency.setTargetAtTime(inside ? 2600 : 9000, t, 0.2)
  }
}

export class JetNoise {
  constructor(ctx, out, buffers) {
    const loop = (buf, rate = 1) => {
      const s = ctx.createBufferSource()
      s.buffer = buffers[buf]
      s.loop = true
      s.playbackRate.value = rate
      s.start(0, Math.random())
      return s
    }
    this.rumble = ctx.createGain()
    this.rumble.gain.value = 0
    this.rumbleF = ctx.createBiquadFilter()
    this.rumbleF.type = 'lowpass'
    this.rumbleF.frequency.value = 300
    loop('brown').connect(this.rumbleF).connect(this.rumble).connect(out)
    this.roar = ctx.createGain()
    this.roar.gain.value = 0
    const roarF = ctx.createBiquadFilter()
    roarF.type = 'bandpass'
    roarF.frequency.value = 1600
    roarF.Q.value = 0.6
    loop('pink', 0.8).connect(roarF).connect(this.roar).connect(out)
    this.whine = ctx.createOscillator()
    this.whine.frequency.value = 3200
    this.whineAmp = ctx.createGain()
    this.whineAmp.gain.value = 0
    this.whine.connect(this.whineAmp).connect(out)
    this.whine.start()
  }

  // level 0..1 (already distance-weighted), whine 0..1 (taxiing/idle engines)
  update(t, level, whine) {
    this.rumble.gain.setTargetAtTime(level * 0.5, t, 0.3)
    this.rumbleF.frequency.setTargetAtTime(160 + level * 260, t, 0.3)
    this.roar.gain.setTargetAtTime(level * 0.12, t, 0.3)
    this.whineAmp.gain.setTargetAtTime(whine * 0.012, t, 0.4)
  }
}
