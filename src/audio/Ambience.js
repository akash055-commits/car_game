// Season ambience beds (wind + leaf rustle, birdsong, rain), night crickets, and
// lake water lapping that pans and fades with distance.

export class Ambience {
  constructor(ctx, out, buffers) {
    this.ctx = ctx
    this.out = out
    this.buffers = buffers
    const loop = (buf, rate = 1) => {
      const s = ctx.createBufferSource()
      s.buffer = buffers[buf]
      s.loop = true
      s.playbackRate.value = rate
      s.start(ctx.currentTime, Math.random())
      return s
    }
    const filter = (type, freq, q = 0.7) => {
      const f = ctx.createBiquadFilter()
      f.type = type
      f.frequency.value = freq
      f.Q.value = q
      return f
    }
    const gain = (v = 0) => {
      const g = ctx.createGain()
      g.gain.value = v
      return g
    }

    // Wind bed (all seasons, louder in monsoon)
    this.wind = gain()
    this.windFilter = filter('lowpass', 500, 0.5)
    loop('pink', 0.6).connect(this.windFilter).connect(this.wind).connect(out)

    // Leaf rustle (autumn)
    this.rustle = gain()
    loop('white').connect(filter('highpass', 2800)).connect(filter('lowpass', 7000)).connect(this.rustle).connect(out)

    // Rain: hiss + body + close drips
    this.rain = gain()
    loop('white').connect(filter('highpass', 600)).connect(filter('lowpass', 7500)).connect(this.rain).connect(out)
    this.rainBody = gain()
    loop('pink', 0.8).connect(filter('lowpass', 1100)).connect(this.rainBody).connect(out)

    // Water lapping, panned towards the lake
    this.water = gain()
    this.waterPan = ctx.createStereoPanner()
    this.waterAM = gain(0.6)
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 0.35
    const lfoDepth = gain(0.4)
    lfo.connect(lfoDepth).connect(this.waterAM.gain)
    lfo.start()
    loop('brown', 1.4).connect(filter('lowpass', 520, 0.8)).connect(this.waterAM).connect(this.water).connect(this.waterPan).connect(out)

    // Crickets (night): two close tones gated in chirp patterns
    this.crickets = gain()
    this.cricketGate = gain(0)
    const pulse = gain(0)
    const am = ctx.createOscillator()
    am.frequency.value = 32
    am.connect(pulse.gain)
    am.start()
    for (const f of [4350, 4620]) {
      const o = ctx.createOscillator()
      o.frequency.value = f
      o.connect(pulse)
      o.start()
    }
    pulse.connect(this.cricketGate).connect(filter('bandpass', 4500, 2)).connect(this.crickets).connect(out)

    this.birdTimer = 2
    this.cricketTimer = 0
    this.gust = 0
    this.gustTarget = 0.5
  }

  bird(t) {
    const ctx = this.ctx
    const pan = ctx.createStereoPanner()
    pan.pan.value = Math.random() * 1.6 - 0.8
    const g = ctx.createGain()
    g.gain.value = 0.035 + Math.random() * 0.03
    pan.connect(g).connect(this.out)
    const base = 2200 + Math.random() * 1800
    const notes = 2 + Math.floor(Math.random() * 5)
    const kind = Math.random()
    for (let i = 0; i < notes; i++) {
      const st = t + i * (0.09 + Math.random() * 0.08)
      const o = ctx.createOscillator()
      o.type = 'sine'
      const env = ctx.createGain()
      env.gain.setValueAtTime(0.0001, st)
      env.gain.exponentialRampToValueAtTime(1, st + 0.012)
      env.gain.exponentialRampToValueAtTime(0.0001, st + 0.075)
      const f0 = base * (kind < 0.5 ? 1 + i * 0.04 : 1.15 - i * 0.03)
      o.frequency.setValueAtTime(f0, st)
      o.frequency.exponentialRampToValueAtTime(f0 * (kind < 0.5 ? 1.5 : 0.7), st + 0.07)
      o.connect(env).connect(pan)
      o.start(st)
      o.stop(st + 0.1)
    }
  }

  // mix: { autumn, spring, rain, night, wind, waterDist, waterPan, dt }
  update(m) {
    const ctx = this.ctx
    const t = ctx.currentTime
    const set = (param, v, tc = 0.6) => param.setTargetAtTime(v, t, tc)
    this.gust += (this.gustTarget - this.gust) * Math.min(1, m.dt * 0.5)
    if (Math.abs(this.gust - this.gustTarget) < 0.05) this.gustTarget = 0.2 + Math.random() * 0.8
    const dryNight = m.night * (1 - m.rain)

    set(this.wind.gain, (0.05 + this.gust * 0.07) * (0.6 + m.wind * 0.5) * (1 + m.rain * 0.6))
    set(this.windFilter.frequency, 300 + this.gust * 500 + m.rain * 200, 0.8)
    set(this.rustle.gain, m.autumn * this.gust * 0.018 * (1 - m.night * 0.5))
    set(this.rain.gain, m.rain * 0.07)
    set(this.rainBody.gain, m.rain * 0.09)
    set(this.water.gain, Math.max(0, 1 - m.waterDist / 30) ** 2 * 0.25)
    set(this.waterPan.pan, m.waterPan, 0.3)
    set(this.crickets.gain, dryNight * 0.02)

    // Birdsong: lively in spring days, sparse in autumn
    this.birdTimer -= m.dt
    const birdiness = (m.spring * 1 + m.autumn * 0.3) * (1 - m.night) * (1 - m.rain)
    if (this.birdTimer <= 0) {
      this.birdTimer = 1 + Math.random() * 4 / Math.max(birdiness, 0.2)
      if (birdiness > 0.15 && Math.random() < birdiness + 0.2) this.bird(t + 0.05)
    }
    // Cricket chirp pattern
    this.cricketTimer -= m.dt
    if (this.cricketTimer <= 0 && dryNight > 0.05) {
      this.cricketTimer = 0.5 + Math.random() * 0.6
      const g = this.cricketGate.gain
      for (let i = 0; i < 3; i++) {
        g.setValueAtTime(1, t + i * 0.12)
        g.setValueAtTime(0, t + i * 0.12 + 0.07)
      }
    }
  }
}
