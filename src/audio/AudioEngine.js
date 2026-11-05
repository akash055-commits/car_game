// Audio graph: engine + driving layers + sfx + ambience -> master -> compressor -> out.
// Music runs through Howler. Started on the first user gesture (browser autoplay rules).
import { EngineSynth, createNoiseBuffer } from './EngineSynth.js'
import { Sfx } from './Sfx.js'
import { Ambience } from './Ambience.js'
import { MusicPlayer } from './MusicPlayer.js'

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
    this.buildDrivingLayers()
    this.applyVolumes()
    this.music.start()
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

  // Called every frame with the driving + world state
  update(dt, st) {
    if (!this.ctx || this.ctx.state !== 'running') return
    const t = this.ctx.currentTime
    const vp = st.vehicle
    const speed = Math.abs(vp.speed)

    // Engine
    const shifting = vp.shiftTimer > 0.06
    if (vp.gear !== this.lastGear && vp.lastShift === 1 && vp.throttle > 0.5 && vp.rpm > 4500) this.sfx.pop(0.08)
    this.lastGear = vp.gear
    this.engine.update({
      rpm: vp.rpm,
      throttle: vp.throttle,
      load: vp.load,
      speed,
      gear: vp.gear,
      limiter: vp.rpm > 6850 && vp.throttle > 0.5 && !vp.boosting,
      shift: shifting,
    }, t)

    // Exhaust pops on lift-off from high revs
    if (this.prevThrottle > 0.6 && vp.throttle < 0.25 && vp.rpm > 3800) this.popBudget = 3 + Math.floor(Math.random() * 4)
    if (this.popBudget > 0 && Math.random() < dt * 9) {
      this.popBudget--
      this.sfx.pop(0.1 + Math.random() * 0.12)
    }
    this.prevThrottle = vp.throttle

    // Tyres + surfaces
    let roadSlip = 0, dirt = 0, contact = 0
    for (let i = 0; i < 4; i++) {
      if (!vp.wheelState(i).contact) continue
      contact++
      if (vp.wheelSurface[i] === 'dirt') dirt++
      else roadSlip = Math.max(roadSlip, vp.slip[i])
    }
    const onDirt = contact ? dirt / contact : 0
    const sp = Math.min(speed / 25, 1)
    const wet = st.wet
    const squeal = speed > 2.5 ? Math.max(0, roadSlip - 0.35) * 1.6 * (1 - wet * 0.7) : 0
    this.squeal.gain.setTargetAtTime(Math.min(squeal, 1) * 0.16, t, 0.05)
    this.squealOsc.frequency.setTargetAtTime(880 + Math.random() * 160 + sp * 120, t, 0.08)
    this.gravel.gain.setTargetAtTime(onDirt * sp * 0.16 * (contact ? 1 : 0), t, 0.08)
    this.roll.gain.setTargetAtTime(sp * (0.18 + onDirt * 0.12 + wet * 0.08) * (contact ? 1 : 0.2), t, 0.1)
    this.rollFilter.frequency.setTargetAtTime(160 + sp * 300 + wet * 500, t, 0.1)
    this.windRush.gain.setTargetAtTime(sp * sp * 0.09, t, 0.15)
    this.windFilter.frequency.setTargetAtTime(500 + sp * 1200, t, 0.15)
    this.splash.gain.setTargetAtTime(vp.inWater > 0 ? Math.min(speed / 8, 1) * 0.25 : wet * sp * 0.05, t, 0.1)

    if (vp.landing > 0.05) this.sfx.landing(vp.landing)

    this.ambience.update({ ...st.ambience, dt })
  }
}
