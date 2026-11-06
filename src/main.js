import '@fontsource/nunito/600.css'
import '@fontsource/nunito/800.css'
import './ui/ui.css'
import { Game } from './Game.js'
import { AudioEngine } from './audio/AudioEngine.js'
import { EngineSynth, ENGINE_PROFILES, createNoiseBuffer } from './audio/EngineSynth.js'
import { UI } from './ui/UI.js'
import { TouchControls } from './ui/TouchControls.js'
import { formatTime } from './gameplay/Circuit.js'
import { SEASONS } from './atmosphere/Seasons.js'
import { saveQuality } from './core/Quality.js'
import { Minimap } from './ui/Minimap.js'
import { CombatHud } from './ui/CombatHud.js'
import { WEAPONS, WEAPON_BY_ID } from './combat/Weapons.js'
import { ACTIVITY_INFO } from './gameplay/Activities.js'

const app = document.getElementById('app')
const ui = new UI()
const audio = new AudioEngine()
const game = new Game(app)
window.__game = game
window.__audio = audio
window.__engineLab = { EngineSynth, ENGINE_PROFILES, createNoiseBuffer } // for offline sound checks

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
    ui.setCoins(game.activities.coins)
    audio.season = game.seasons.current
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
let minimap = null
let hud = null
function wire() {
  const listener = () => game.camera.position
  const dist = (x, z) => Math.hypot(x - listener().x, z - listener().z)
  // stereo pan of a world point relative to the camera (-1 left .. 1 right)
  const pan = (x, z) => {
    const e = game.camera.matrixWorld.elements
    const dx = x - listener().x, dz = z - listener().z
    const l = Math.hypot(dx, dz) || 1
    return Math.max(-1, Math.min(1, (dx * e[0] + dz * e[2]) / l)) * Math.min(1, l / 6)
  }
  const fade = document.createElement('div')
  fade.className = 'fade-black'
  ui.hud.prepend(fade) // under the HUD so the big message stays readable
  ui.on('start', () => {
    if (started) return
    started = true
    audio.start()
    ui.hideLoader()
    game.start()
    if (game.quality.isTouch) game.touch = new TouchControls(game.input, game.rig, game.renderer.renderer.domElement)
    minimap = new Minimap(ui.hud, game)
    hud = new CombatHud(ui.hud)
    window.__hud = hud
    setTimeout(() => ui.toast(`Welcome to Maple Hollow · <em>${SEASONS[game.seasons.current].label}</em>`), 900)
    setTimeout(() => ui.toast('Press <kbd>J</kbd> for activities · <kbd>F</kbd> to get out and walk', { duration: 4200 }), 3600)
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
    game.activities.best = {}
    game.activities.save()
    ui.toast('Activity records cleared')
    return false
  })
  ui.on('activities', () => ui.openActivities(game.activities))
  ui.on('route', (id) => {
    game.activities.route(id)
    ui.toast(`Follow the arrow to <em>${ACTIVITY_INFO[id].name}</em>`, { duration: 2200 })
  })
  ui.on('promptTap', (key) => game.input.emit('press', `Key${key}`))
  ui.on('quality', (q) => {
    saveQuality(q)
    location.reload()
  })

  // Game -> UI / audio
  game.on('season', (name) => {
    audio.setSeason(name)
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
  game.on('openActivities', () => ui.openActivities(game.activities))
  game.on('prompt', (active, near, start, jack, shop) => {
    if (shop) return ui.prompt('G', 'Bullseye Arms: buy ammo & armour')
    if (start) return ui.prompt('G', `Start ${ACTIVITY_INFO[start.id].name}`)
    if (active?.type === 'heli' && (active.phys.state === 'off' || active.phys.state === 'stopping')) return ui.prompt('I', 'Start the engine')
    if (active?.type === 'heli' && active.phys.state === 'running' && active.phys.grounded && Math.abs(active.phys.speed) < 1) return ui.prompt('F', 'Get out · I to shut down')
    if (near) return ui.prompt('F', near.type === 'heli' ? 'Fly the helicopter' : near.type === 'bike' ? `Ride the ${near.name.toLowerCase()}` : near.type === 'tank' ? 'Drive the tank' : `Drive the ${near.name.toLowerCase()}`)
    if (jack) return ui.prompt('F', jack.kind === 'van' ? 'Steal the van' : 'Steal the car')
    ui.prompt(null)
  })
  game.on('enter', (v) => {
    audio.sfx?.door(true)
    if (v.type === 'heli' && v.phys.state === 'off') ui.toast('Press <kbd>I</kbd> to start the engine, then hold <kbd>Space</kbd> to lift off', { duration: 3600 })
  })
  game.on('exit', () => audio.sfx?.door(false))
  game.on('notice', (text) => ui.toast(text, { duration: 2200 }))
  game.on('carjack', (c, v) => {
    audio.sfx?.door(true)
    audio.sfx?.voice('angry', 2)
    ui.toast(`You pulled the driver out and took the <em>${v.name.toLowerCase()}</em>`, { duration: 2400 })
  })
  let lastPlaneNote = 0
  game.on('planeBlocked', (p) => {
    audio.sfx?.honk(dist(p.pos.x, p.pos.z) * 0.5)
    if (performance.now() - lastPlaneNote > 15000 && dist(p.pos.x, p.pos.z) < 120) {
      lastPlaneNote = performance.now()
      ui.toast('An airliner has stopped for you. Clear the taxiway!', { duration: 2600 })
    }
  })
  game.on('ignition', (state) => {
    if (state === 'starting') {
      audio.sfx?.starter()
      ui.toast('Engine starting… wait for full rotor speed', { duration: 2600 })
    } else ui.toast('Engine shutting down', { duration: 1800 })
  })
  game.on('footstep', (k, surf) => audio.sfx?.footstep(surf, k > 0.6, k >= 1))
  game.on('voice', (kind, x, z) => audio.sfx?.voice(kind, dist(x, z)))
  game.on('hammer', (x, z) => audio.sfx?.hammer(dist(x, z)))
  game.on('honk', (x, z) => audio.sfx?.honk(dist(x, z)))
  let lastSmash = 0
  game.on('siteSmash', (site, n) => {
    audio.sfx?.smash(dist(site.x, site.z))
    const now = performance.now()
    if (now - lastSmash > 6000 && n > 2) {
      lastSmash = now
      ui.toast(`You knocked down part of the <em>${site.name}</em>. The builders sigh and start again.`, { duration: 3200 })
    }
  })
  game.on('siteComplete', (site) => {
    if (dist(site.x, site.z) < 140) {
      audio.sfx?.fanfare()
      ui.toast(`The <em>${site.name}</em> is finished! Everyone cheers`, { duration: 3200 })
    }
  })

  // ---------------------------------------------------------------- combat
  const C = game.combat
  const SOUND = { pistol: 'pistol', smg: 'smg', shotgun: 'shotgun', rifle: 'rifle', sniper: 'sniper', rocket: 'rocket' }
  let lastImpact = 0
  C.on('shot', (w, o, owner) => {
    if (w.id === 'rocket') audio.sfx?.rocketLaunch(dist(o.x, o.z), pan(o.x, o.z))
    else audio.sfx?.gunshot(SOUND[w.id] || 'pistol', dist(o.x, o.z), pan(o.x, o.z))
    if (owner === 'player' && w.id !== 'rocket') audio.sfx?.casing()
  })
  C.on('explosion', (p, size) => audio.sfx?.explosion(dist(p.x, p.z), pan(p.x, p.z), size))
  C.on('impact', (p, material) => {
    const now = performance.now()
    if (now - lastImpact < 40) return
    lastImpact = now
    audio.sfx?.bulletHit(material, dist(p.x, p.z))
  })
  C.on('hitChar', (c, downed, owner) => {
    if (owner === 'player') hud?.hitMarker(downed)
    audio.sfx?.bulletHit('flesh', dist(c.x, c.z))
  })
  C.on('hitVehicle', (c, owner) => { if (owner === 'player') hud?.hitMarker(false) })
  C.on('reload', () => audio.sfx?.reload())
  C.on('empty', (w) => {
    audio.sfx?.emptyClick()
    ui.toast(`Out of ammo for the ${w.name}. Buy more at Bullseye Arms (orange G on the map)`, { duration: 2200 })
  })
  C.on('switch', () => audio.sfx?.click())
  C.on('punch', (hit) => audio.sfx?.punch(hit))
  C.on('whiz', (o) => audio.sfx?.bulletWhiz(pan(o.x, o.z)))
  C.on('notice', (t) => ui.toast(t, { duration: 1800 }))
  C.on('vehicleWrecked', (v) => { if (game.active === v || game.lastVehicle === v) ui.toast(`Your ${v.name.toLowerCase()} is a burnt-out wreck`, { duration: 2400 }) })
  let lastHurtSound = 0
  game.player.on('hurt', (amount, from) => {
    let ang = null
    if (from) {
      const e = game.camera.matrixWorld.elements
      const fx = -e[8], fz = -e[10] // camera forward
      const dx = from.x - game.player.pos.x, dz = from.z - game.player.pos.z
      ang = Math.atan2(dx * -fz + dz * fx, dx * fx + dz * fz) // + = to the right
    }
    hud?.hurt(ang)
    if (performance.now() - lastHurtSound > 450) { lastHurtSound = performance.now(); audio.sfx?.hurt() }
  })
  game.on('knockedOut', () => {
    fade.classList.add('on')
    audio.sfx?.stinger(false)
    hud?.big('KNOCKED OUT', 'Patched up at the nearest hospital…', 0, 'bad')
  })
  game.on('arrested', () => {
    fade.classList.add('on')
    audio.sfx?.stinger(false)
    hud?.big('ARRESTED', 'Released from the police station…', 0, 'blue')
  })
  game.on('revived', (place, fee, arrested) => {
    fade.classList.remove('on')
    hud?.hideBig()
    ui.toast(arrested ? `Released with a <em>${fee}</em> coin fine (and half your ammo confiscated)` : `Hospital bill: <em>${fee}</em> coins`, { duration: 3200 })
    ui.setCoins(game.activities.coins, true)
  })
  game.on('pickup', (kind) => {
    audio.sfx?.pickup()
    ui.toast({ health: '+ Health', armor: '+ Body armour', ammo: '+ Ammo', rocket: '+ 3 rockets', nitro: 'Nitro refilled' }[kind], { duration: 1300 })
  })
  game.on('ejected', () => ui.toast('Thrown off the bike!', { duration: 1600 }))
  game.on('sprayed', (s, v, lost) => {
    audio.sfx?.whoosh()
    ui.toast(lost ? 'New paint job: <em>the police lose interest</em>' : `<em>Spray & Fix</em>: your ${v.name.toLowerCase()} is good as new`, { duration: 2600 })
  })
  // ---------------------------------------------------------------- wanted / police
  const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n)
  game.wanted.on('level', (n, before) => {
    audio.sfx?.stinger(false)
    ui.toast(`Wanted <em>${stars(n)}</em>${before === 0 ? ' · lose the police or hide in a Spray & Fix' : ''}`, { duration: 2600 })
  })
  game.wanted.on('cleared', (reason, before) => {
    if (reason === 'lost') {
      audio.sfx?.stinger(true)
      ui.toast('You lost the police', { big: true, duration: 2600 })
    }
  })
  game.wanted.on('spotted', () => ui.toast('Spotted! The police are back on you', { duration: 1600 }))
  game.police.on('heli', () => ui.toast('A police helicopter is overhead', { duration: 2200 }))
  game.police.on('heliDown', () => ui.toast('You brought the police helicopter down!', { duration: 2400 }))
  game.police.on('roadblock', () => ui.toast('<em>Roadblock</em> ahead!', { duration: 2000 }))
  game.police.on('disembark', (u) => audio.sfx?.voice('halt', dist(u.v.pos.x, u.v.pos.z)))
  game.on('openShop', () => {
    const items = [
      ...WEAPONS.filter((w) => !w.melee).map((w) => ({ id: w.id, name: `${w.icon} ${w.name} ammo`, desc: `+${w.clip * (w.id === 'rocket' ? 3 : 3)} rounds`, price: w.price })),
      { id: 'armor', name: '🦺 Body armour', desc: 'Soaks up two thirds of the damage you take', price: 30 },
      { id: 'all', name: '🧰 Full refill', desc: 'Every weapon back to a full load', price: 160 },
    ]
    ui.openShop('Bullseye Arms', items, game.activities.coins, (id) => {
      const it = items.find((i) => i.id === id)
      if (!it || game.activities.coins < it.price) return false
      game.activities.coins -= it.price
      if (id === 'armor') game.player.armor = 100
      else if (id === 'all') C.refillAll()
      else C.addAmmo(id, WEAPON_BY_ID[id].clip * 3)
      game.activities.save()
      ui.setCoins(game.activities.coins, true)
      audio.sfx?.coin(1)
      return game.activities.coins
    })
  })
  game.on('wheelOpen', () => hud?.openWheel(C))
  game.on('wheelClose', () => { if (hud?.wheelOpen) C.select(hud.closeWheel()) })
  window.addEventListener('mousemove', (e) => { if (hud?.wheelOpen) hud.moveWheel(e.movementX, e.movementY, C) })

  // Activities
  const fmtCoins = (n) => `<em>+${n}</em> coins`
  game.on('act:start', (id) => {
    audio.sfx?.checkpoint()
    ui.toast(`<em>${ACTIVITY_INFO[id].name}</em> · ${ACTIVITY_INFO[id].blurb}`, { big: true, duration: 3600 })
  })
  game.on('act:end', (id, reason) => {
    if (reason === 'quit') {
      audio.sfx?.invalid()
      ui.toast(`${ACTIVITY_INFO[id].name} cancelled`, { duration: 1800 })
    }
  })
  game.on('act:objective', (a) => {
    if (a.id !== 'rally' || a.next === 0) audio.sfx?.click()
  })
  game.on('act:coins', (n, total) => {
    audio.sfx?.coin(n)
    ui.setCoins(total, true)
  })
  game.on('act:toast', (text) => ui.toast(text, { duration: 2400 }))
  game.on('act:countdown', (n) => {
    audio.sfx?.beep(n === 0)
    ui.countdown(n)
  })
  game.on('act:checkpoint', (n, total, t) => {
    audio.sfx?.checkpoint()
    ui.toast(`Hoop ${n}/${total} <em>${formatTime(t)}</em>`, { duration: 1300 })
  })
  game.on('act:rallyDone', (t, medal, best) => {
    audio.sfx?.lap(best)
    const m = medal ? `${medal[0].toUpperCase()}${medal.slice(1)} medal` : 'Finished'
    ui.toast(`${m} · <em>${formatTime(t)}</em>${best ? ' · new record!' : ''}`, { big: true, duration: 4200 })
  })
  game.on('act:delivered', (step, total) => ui.toast(`Parcel delivered ${step}/${total}`, { duration: 1600 }))
  game.on('act:fare', (fare, tip, step, total) => ui.toast(`Fare ${step}/${total}: ${fmtCoins(fare)}${tip > 0 ? ` + ${tip} tip` : ''}`, { duration: 2200 }))
  game.on('act:summary', (id, coins, best) => {
    audio.sfx?.lap(best)
    ui.toast(`${ACTIVITY_INFO[id].name} complete · ${fmtCoins(coins)}${best ? ' · new record!' : ''}`, { big: true, duration: 4200 })
  })
  game.on('act:passengerUpset', () => ui.toast('Your passenger did not enjoy that. Tip shrinking!', { duration: 1800 }))
  game.on('thunder', (delay) => audio.sfx?.thunder(delay))
  game.on('respawn', () => audio.sfx?.click())
  audio.music.onTrack = (name) => ui.nowPlaying(name)

  game.input.on('press', (code) => { if (code === 'KeyH' && game.active && game.active.type !== 'heli') { audio.sfx?.hornOn(); game.honk() } })
  window.addEventListener('keyup', (e) => { if (e.code === 'KeyH') audio.sfx?.hornOff() })

  // Per-frame HUD + audio
  const lake = game.layout.lake
  const heli = game.vehicles.find((v) => v.type === 'heli')
  game.on('frame', (dt) => {
    ui.update(game)
    hud?.update(game)
    minimap?.draw()
    game.touch?.setMode(game.active ? game.active.type : 'foot')
    if (!audio.ctx) return
    const cam = game.camera.position
    const dx = lake.x - cam.x, dz = lake.z - cam.z
    const shoreDist = Math.max(0, Math.hypot(dx, dz) - lake.r)
    // pan: project lake direction onto the camera's right vector
    const right = { x: game.camera.matrixWorld.elements[0], z: game.camera.matrixWorld.elements[2] }
    const len = Math.hypot(dx, dz) || 1
    const pan = Math.max(-1, Math.min(1, (dx * right.x + dz * right.z) / len))
    const U = game.uniforms
    audio.update(dt, {
      active: game.active,
      heli,
      listener: cam,
      right,
      sirens: game.police.sirens(),
      policeHeli: game.police.heli,
      planes: game.aviation.planes,
      wet: U.uWet.value,
      ambience: {
        autumn: U.uAutumn.value, spring: U.uSpring.value, rain: U.uRain.value, night: U.uNight.value,
        wind: U.uWindStrength.value, waterDist: shoreDist, waterPan: pan * 0.8,
      },
    })
  })
}
