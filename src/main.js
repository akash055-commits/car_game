import '@fontsource/nunito/600.css'
import '@fontsource/nunito/800.css'
import './ui/ui.css'
import { Game } from './Game.js'
import { AudioEngine } from './audio/AudioEngine.js'
import { UI } from './ui/UI.js'
import { TouchControls } from './ui/TouchControls.js'
import { formatTime } from './gameplay/Circuit.js'
import { SEASONS } from './atmosphere/Seasons.js'
import { saveQuality } from './core/Quality.js'

const app = document.getElementById('app')
const ui = new UI()
const audio = new AudioEngine()
const game = new Game(app)
window.__game = game
window.__audio = audio

function toggleFullscreen() {
  const d = document
  if (!d.fullscreenElement) d.documentElement.requestFullscreen?.().catch(() => {})
  else d.exitFullscreen?.()
  return !d.fullscreenElement
}

game
  .init((p, label) => ui.progress(p, label))
  .then(() => {
    ui.setSeason(game.seasons.current)
    ui.setNight(false)
    ui.setEmbers(game.collectibles.count, game.collectibles.total)
    ui.setMusic(!audio.settings.musicMuted)
    ui.setSound(!audio.settings.muted)
    ui.ready()
    wire()
  })
  .catch((err) => {
    console.error(err)
    ui.progress(1, 'Something went wrong loading the valley. Please refresh.')
  })

let started = false
function wire() {
  ui.on('start', () => {
    if (started) return
    started = true
    audio.start()
    ui.hideLoader()
    game.start()
    if (game.quality.isTouch) new TouchControls(game.input, game.rig, game.renderer.renderer.domElement)
    setTimeout(() => ui.toast(`Welcome to <em>${SEASONS[game.seasons.current].label}</em> in the valley`), 900)
  })

  // Toolbar / settings
  ui.on('season', (name) => {
    game.seasons.set(name)
    audio.sfx?.click()
  })
  ui.on('night', () => game.toggleNight())
  ui.on('camera', () => {
    const mode = game.rig.toggle()
    ui.setCamera(mode)
    return mode === 'chase'
  })
  const toggleMusic = () => {
    const on = audio.toggleMusic()
    ui.setMusic(on)
    ui.toast(on ? 'Music on' : 'Music off', { duration: 1200 })
    return on
  }
  const toggleSound = () => {
    const on = audio.toggleMute()
    ui.setSound(on)
    return on
  }
  ui.on('music', toggleMusic)
  ui.on('sound', toggleSound)
  ui.on('fullscreen', toggleFullscreen)
  ui.on('settings', () => ui.openSettings(audio, { camera: game.rig.mode, tilt: game.renderer.tiltH.enabled, quality: game.quality.name }))
  ui.on('volume', (key, v) => audio.setVolume(key, v))
  ui.on('setting:music', toggleMusic)
  ui.on('setting:sound', toggleSound)
  ui.on('setting:camera', () => ui.fire('camera'))
  ui.on('setting:tilt', () => {
    const on = !game.renderer.tiltH.enabled
    game.renderer.setTiltShift(on)
    return on
  })
  ui.on('setting:fullscreen', () => { toggleFullscreen(); return false })
  ui.on('setting:reset-embers', () => {
    game.collectibles.reset()
    ui.setEmbers(0, game.collectibles.total)
    ui.toast('Embers reset. Happy hunting!')
    return false
  })
  ui.on('setting:reset-best', () => {
    game.circuit.best = null
    try { localStorage.removeItem('sv-best-lap') } catch {}
    ui.toast('Best lap cleared')
    return false
  })
  ui.on('quality', (q) => {
    saveQuality(q)
    location.reload()
  })

  // Game -> UI / audio
  game.on('season', (name) => {
    ui.setSeason(name)
    ui.toast(`<em>${SEASONS[name].label}</em>`, { duration: 1800 })
    audio.sfx?.whoosh()
  })
  game.on('daynight', (toNight) => ui.setNight(toNight))
  game.on('camera', (mode) => ui.setCamera(mode))
  game.on('toggleMusic', toggleMusic)
  game.on('impact', (e) => audio.sfx?.impact(e.material, e.strength, e.withCar))
  game.on('collect', (n, total) => {
    audio.sfx?.pickup()
    ui.setEmbers(n, total, true)
    ui.toast(`Ember found <em>${n} / ${total}</em>`, { duration: 1800 })
  })
  game.on('collectComplete', () => {
    audio.sfx?.complete()
    ui.toast('All embers found. The valley glows for you ✦', { big: true, duration: 5000 })
  })
  game.on('lapStart', (lap) => { if (lap === 1) ui.toast('Lap started. Go!', { duration: 1500 }) })
  game.on('checkpoint', (n, t) => {
    audio.sfx?.checkpoint()
    ui.toast(`Checkpoint ${n}/6 <em>${formatTime(t)}</em>`, { duration: 1500 })
  })
  game.on('lap', (t, best) => {
    audio.sfx?.lap(best)
    ui.toast(best ? `New best lap <em>${formatTime(t)}</em>` : `Lap <em>${formatTime(t)}</em>`, { big: true, duration: 3200 })
  })
  game.on('lapInvalid', () => {
    audio.sfx?.invalid()
    ui.toast('Missed a checkpoint. New lap started', { duration: 2200 })
  })
  game.on('thunder', (delay) => audio.sfx?.thunder(delay))
  game.on('respawn', () => audio.sfx?.click())
  audio.music.onTrack = (name) => ui.nowPlaying(name)

  game.input.on('press', (code) => { if (code === 'KeyH') audio.sfx?.hornOn() })
  window.addEventListener('keyup', (e) => { if (e.code === 'KeyH') audio.sfx?.hornOff() })

  // Per-frame HUD + audio
  const lake = game.layout.lake
  game.on('frame', (dt) => {
    ui.update(game)
    if (!audio.ctx) return
    const dx = lake.x - game.carPos.x, dz = lake.z - game.carPos.z
    const shoreDist = Math.max(0, Math.hypot(dx, dz) - lake.r)
    // pan: project lake direction onto the camera's right vector
    const right = { x: game.camera.matrixWorld.elements[0], z: game.camera.matrixWorld.elements[2] }
    const len = Math.hypot(dx, dz) || 1
    const pan = Math.max(-1, Math.min(1, (dx * right.x + dz * right.z) / len))
    const U = game.uniforms
    audio.update(dt, {
      vehicle: game.vehicle,
      wet: U.uWet.value,
      ambience: {
        autumn: U.uAutumn.value, spring: U.uSpring.value, rain: U.uRain.value, night: U.uNight.value,
        wind: U.uWindStrength.value, waterDist: shoreDist, waterPan: pan * 0.8,
      },
    })
  })
}
