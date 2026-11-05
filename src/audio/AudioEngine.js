// Audio graph: engine + driving layers + sfx + ambience -> master -> compressor -> out.
// Music runs through Howler. Started on the first user gesture (browser autoplay rules).
import { EngineSynth, createNoiseBuffer } from './EngineSynth.js'
import { Sfx } from './Sfx.js'
import { Ambience } from './Ambience.js'
import { MusicPlayer } from './MusicPlayer.js'
import { HeliSynth, JetNoise } from './Machines.js'

const DEFAULTS = { master: 0.8, music: 0.3, sfx: 0.9, musicMuted: false, muted: false }

function impulseResponse(ctx, seconds = 2.4, decay = 3) {
  const len = Math.floor(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(2, len, ctx.sampleRate)
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay)
  }
  return buf
}

export class AudioEngine {
  constructor() {
    let saved = {}
    try { saved = JSON.parse(localStorage.getItem('sv-audio') || '{}') } catch {}
    this.settings = { ...DEFAULTS, ...saved }
    this.ctx = null
    this.music = new MusicPlayer(this.settings)
    this.prevThrottle = 0
    this.popBudget = 0
    this.lastGear = 1
    this.engineLevel = 0
    this.voiceKind = 'car'
    this.season = 'autumn'

    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return
      if (document.hidden) {
        this.ctx.suspend()
        this.music.pause()
      } else {
        this.ctx.resume()
        this.music.resume()
      }
    })
  }

  save() {
    try { localStorage.setItem('sv-audio', JSON.stringify(this.settings)) } catch {}
  }

  start() {
    if (this.ctx) {
      this.ctx.resume()
      return
    }
    const Ctx = window.AudioContext || window.webkitAudioContext
    const ctx = new Ctx({ latencyHint: 'interactive' })
    this.ctx = ctx
    this.buffers = {
      white: createNoiseBuffer(ctx, 2, 'white'),
      pink: createNoiseBuffer(ctx, 3, 'pink'),
      brown: createNoiseBuffer(ctx, 3, 'brown'),
    }

    this.compressor = ctx.createDynamicsCompressor()
    this.compressor.threshold.value = -16
    this.compressor.ratio.value = 4
    this.compressor.attack.value = 0.005
    this.compressor.release.value = 0.2
    this.master = ctx.createGain()
    this.master.connect(this.compressor).connect(ctx.destination)
    this.sfxBus = ctx.createGain()
    this.sfxBus.connect(this.master)

    this.reverb = ctx.createConvolver()
    this.reverb.buffer = impulseResponse(ctx)
    this.reverbSend = ctx.createGain()
    this.reverbSend.gain.value = 0.5
    this.reverbSend.connect(this.reverb).connect(this.sfxBus)

    this.engine = new EngineSynth(ctx, this.sfxBus, this.buffers.white)
    this.sfx = new Sfx(ctx, this.sfxBus, this.reverbSend, this.buffers)
    this.ambience = new Ambience(ctx, this.sfxBus, this.buffers)
    this.heli = new HeliSynth(ctx, this.sfxBus, this.buffers)
    this.jets = new JetNoise(ctx, this.sfxBus, this.buffers)
    this.buildDrivingLayers()
    this.applyVolumes()
    this.music.start(this.season)
  }

  setSeason(name) {
    this.season = name
    this.music.setSeason(name)
  }

  buildDrivingLayers() {
    const ctx = this.ctx
    const loop = (buf, rate = 1) => {
      const s = ctx.createBufferSource()
      s.buffer = this.buffers[buf]
      s.loop = true
      s.playbackRate.value = rate
      s.start()
      return s
    }
    const filt = (type, f, q = 0.7) => {
      const b = ctx.createBiquadFilter()
      b.type = type
      b.frequency.value = f
      b.Q.value = q
      return b
    }
    const gain = () => {
      const g = ctx.createGain()
      g.gain.value = 0
      return g
    }
    // Tyre squeal: wobbling tone + band noise
    this.squeal = gain()
    this.squealOsc = ctx.createOscillator()
    this.squealOsc.type = 'triangle'
    this.squealOsc.frequency.value = 950
    const vib = ctx.createOscillator()
    vib.frequency.value = 7
    const vibDepth = ctx.createGain()
    vibDepth.gain.value = 35
    vib.connect(vibDepth).connect(this.squealOsc.frequency)
    vib.start()
    const sqTone = ctx.createGain()
    sqTone.gain.value = 0.35
    this.squealOsc.connect(sqTone).connect(filt('bandpass', 1100, 3)).connect(this.squeal)
    this.squealOsc.start()
    loop('white').connect(filt('bandpass', 1500, 4)).connect(this.squeal)
    this.squeal.connect(this.sfxBus)

    // Gravel crunch (dirt) — granular via noise AM
    this.gravel = gain()
    const grain = ctx.createGain()
    grain.gain.value = 0.5
    const grainLfo = loop('white', 0.004)
    const grainDepth = ctx.createGain()
    grainDepth.gain.value = 0.9
    grainLfo.connect(filt('lowpass', 40)).connect(grainDepth).connect(grain.gain)
    loop('white').connect(filt('bandpass', 2400, 0.8)).connect(grain).connect(this.gravel).connect(this.sfxBus)

    // Rolling road noise
    this.roll = gain()
    this.rollFilter = filt('lowpass', 220)
    loop('brown').connect(this.rollFilter).connect(this.roll).connect(this.sfxBus)

    // Wind rush with speed
    this.windRush = gain()
    this.windFilter = filt('bandpass', 600, 0.6)
    loop('pink').connect(this.windFilter).connect(this.windRush).connect(this.sfxBus)

    // Splashing through water
    this.splash = gain()
    loop('white', 0.7).connect(filt('bandpass', 900, 0.6)).connect(this.splash).connect(this.sfxBus)
  }

  applyVolumes() {
    if (!this.ctx) return
    const s = this.settings
    this.master.gain.setTargetAtTime(s.muted ? 0 : s.master, this.ctx.currentTime, 0.05)
    this.sfxBus.gain.setTargetAtTime(s.sfx, this.ctx.currentTime, 0.05)
    this.music.refreshVolume()
    this.save()
  }

  setVolume(key, v) {
    this.settings[key] = v
    this.applyVolumes()
  }

  toggleMusic() {
    this.settings.musicMuted = !this.settings.musicMuted
    this.applyVolumes()
    return !this.settings.musicMuted
  }

  toggleMute() {
    this.settings.muted = !this.settings.muted
    this.applyVolumes()
    if (this.settings.muted) this.music.howl?.mute(true)
    else this.music.howl?.mute(false)
    return !this.settings.muted
  }

  // Called every frame with the vehicle + world state.
  // st: { active (vehicle entry or null), heli (heli entry), listener {x,y,z}, planes, wet, ambience }
  update(dt, st) {
    if (!this.ctx || this.ctx.state !== 'running') return
    const t = this.ctx.currentTime
    const active = st.active
    const ground = active && active.type !== 'heli' ? active.phys : null

    // Engine: only while you're driving the buggy or riding the bike
    this.engineLevel += ((ground ? 1 : 0) - this.engineLevel) * Math.min(1, dt * (ground ? 6 : 3))
    this.engine.setLevel(this.engineLevel)
    if (ground && active.type !== this.voiceKind) {
      this.voiceKind = active.type
      this.engine.setVoice(active.type)
    }
    const vp = ground
    const speed = vp ? Math.abs(vp.speed) : 0
    if (vp) {
      const shifting = vp.shiftTimer > 0.06
      if (vp.gear !== this.lastGear && vp.lastShift === 1 && vp.throttle > 0.5 && vp.rpm > vp.cfg.upRpm * 0.7) this.sfx.pop(0.06)
      this.lastGear = vp.gear
      this.engine.update({
        rpm: vp.rpm, throttle: vp.throttle, load: vp.load, speed, gear: vp.gear,
        limiter: vp.rpm > vp.cfg.redline - 50 && vp.throttle > 0.5 && !vp.boosting, shift: shifting,
      }, t)
      // Exhaust pops on lift-off from high revs (fewer, softer)
      if (this.prevThrottle > 0.6 && vp.throttle < 0.25 && vp.rpm > vp.cfg.upRpm * 0.62) this.popBudget = 1 + Math.floor(Math.random() * 3)
      if (this.popBudget > 0 && Math.random() < dt * 7) {
        this.popBudget--
        this.sfx.pop(0.06 + Math.random() * 0.06)
      }
      this.prevThrottle = vp.throttle
    } else this.engine.update({ rpm: 900, throttle: 0, load: 0, speed: 0, gear: 1 }, t)

    // Tyres + surfaces. The squeal now only follows real sideways sliding (drifts, hard
    // cornering) — never plain acceleration or braking — and sits well under the engine.
    let side = 0, dirt = 0, contact = 0
    if (vp) {
      for (let i = 0; i < 4; i++) {
        if (!vp.wheelState(i).contact) continue
        contact++
        if (vp.wheelSurface[i] === 'dirt') dirt++
        else side = Math.max(side, vp.sideSlip[i])
      }
    }
    const onDirt = contact ? dirt / contact : 0
    const sp = Math.min(speed / 25, 1)
    const wet = st.wet
    const bike = active?.type === 'bike'
    const squeal = speed > 5 ? Math.max(0, side - 0.5) * 2 * (1 - wet * 0.8) * (bike ? 0.4 : 1) : 0
    this.squeal.gain.setTargetAtTime(Math.min(squeal, 1) * 0.055, t, 0.12)
    this.squealOsc.frequency.setTargetAtTime(820 + Math.random() * 90 + sp * 80, t, 0.12)
    this.gravel.gain.setTargetAtTime(onDirt * sp * 0.13 * (contact ? 1 : 0), t, 0.08)
    this.roll.gain.setTargetAtTime(vp ? sp * (0.15 + onDirt * 0.1 + wet * 0.07) * (contact ? 1 : 0.2) : 0, t, 0.1)
    this.rollFilter.frequency.setTargetAtTime(160 + sp * 300 + wet * 500, t, 0.1)
    // wind: from any vehicle's airspeed (bike riders hear more of it)
    const air = active ? Math.min(Math.abs(active.phys.speed) / 25, 1.4) : 0
    this.windRush.gain.setTargetAtTime(air * air * (bike ? 0.12 : 0.07), t, 0.15)
    this.windFilter.frequency.setTargetAtTime(500 + air * 1100, t, 0.15)
    this.splash.gain.setTargetAtTime(vp && vp.inWater > 0 ? Math.min(speed / 8, 1) * 0.22 : vp ? wet * sp * 0.04 : 0, t, 0.1)
    if (vp && vp.landing > 0.05) this.sfx.landing(vp.landing)

    // Helicopter (heard whether you're flying it or watching it spin up)
    const L = st.listener
    if (st.heli) {
      const h = st.heli.phys
      const p = st.heli.pos
      const inside = active === st.heli
      this.heli.update(t, { rotor: h.rotor, load: inside ? Math.max(0, h.throttle || 0) : 0.4, dist: Math.hypot(p.x - L.x, p.y - L.y, p.z - L.z), inside, speed: Math.abs(h.speed) })
    }

    // Airliners: roar from the loudest nearby aircraft
    let jet = 0, whine = 0
    for (const pl of st.planes || []) {
      const d = Math.hypot(pl.pos.x - L.x, pl.pos.y - L.y, pl.pos.z - L.z)
      const thrust = pl.phase === 'takeoff' ? (pl.s < 420 ? 1 : 0.45) : pl.phase === 'rollout' ? 0.65 : pl.phase === 'park' ? 0.03 : 0.18
      const size = pl.model.kind === 'jet' ? 1 : 0.35
      const ref = pl.model.kind === 'jet' ? 70 : 35
      const a = 1 / (1 + (d / ref) ** 2)
      jet = Math.max(jet, thrust * size * a)
      if (pl.phase !== 'park') whine = Math.max(whine, size * a * (thrust < 0.5 ? 1 : 0.5))
    }
    this.jets.update(t, Math.min(1, jet), Math.min(1, whine))

    this.ambience.update({ ...st.ambience, dt })
  }
}
