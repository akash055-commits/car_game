// Game orchestrator: builds the world, owns the fixed-step loop and wires systems together.
import * as THREE from 'three'
import { Loop } from './core/Loop.js'
import { Input } from './core/Input.js'
import { Tweens } from './core/Tween.js'
import { getQuality } from './core/Quality.js'
import { damp, clamp } from './core/math.js'
import { Physics } from './physics/Physics.js'
import { Renderer } from './render/Renderer.js'
import { Layout, WORLD } from './world/Layout.js'
import { U } from './world/Uniforms.js'

import { Terrain, buildTerrainPhysics } from './world/Terrain.js'
import { Town } from './world/Town.js'
import { Airport } from './world/Airport.js'
import { CrowdRig } from './characters/Rig.js'
import { Emotes, EMOTE } from './characters/Emotes.js'
import { People } from './characters/People.js'
import { Construction } from './characters/Construction.js'
import { Traffic } from './traffic/Traffic.js'
import { Water } from './world/Water.js'
import { Grass } from './world/Grass.js'
import { Foliage } from './world/Foliage.js'
import { Props } from './world/Props.js'
import { Sky } from './world/Sky.js'
import { Lighting } from './world/Lighting.js'
import { Seasons } from './atmosphere/Seasons.js'
import { DayCycle } from './atmosphere/DayCycle.js'
import { Particles } from './atmosphere/Particles.js'
import { VehiclePhysics, CAR, BIKE } from './vehicle/VehiclePhysics.js'
import { SedanVisual, SEDAN, VAN } from './vehicle/CarVisuals.js'
import { TANK, TankVisual, TankGunner } from './vehicle/Tank.js'
import { VehicleVisual } from './vehicle/VehicleVisual.js'
import { BikeVisual } from './vehicle/BikeVisual.js'
import { HeliPhysics, HeliVisual } from './vehicle/Helicopter.js'
import { Player } from './player/Player.js'
import { AIRPORT } from './world/Layout.js'
import { Aviation } from './aviation/Aviation.js'
import { CameraRig } from './vehicle/CameraRig.js'
import { Effects } from './vehicle/Effects.js'
import { Collectibles } from './gameplay/Collectibles.js'
import { Combat } from './combat/Combat.js'
import { Pickups } from './combat/Pickups.js'
import { Wanted } from './police/Wanted.js'
import { Police } from './police/Police.js'
import { FORT } from './world/Regions.js'
import { Missions } from './gameplay/Missions.js'
import { Activities } from './gameplay/Activities.js'

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)))

export class Game {
  constructor(container) {
    this.container = container
    this.uniforms = U
    this.started = false
    this.listeners = {}
  }

  on(name, fn) {
    ;(this.listeners[name] ||= []).push(fn)
  }

  emit(name, ...a) {
    for (const fn of this.listeners[name] || []) fn(...a)
  }

  async init(progress = () => {}) {
    this.quality = getQuality()
    progress(0.05, 'Waking up physics')
    this.physics = new Physics()
    await this.physics.init()
    await nextFrame()

    progress(0.15, 'Shaping the valley')
    this.layout = new Layout()
    this.tweens = new Tweens()
    this.renderer = new Renderer(this.container, this.quality)
    this.scene = this.renderer.scene
    this.camera = this.renderer.camera
    await nextFrame()

    progress(0.25, 'Building the town')
    this.town = new Town(this.scene, this.physics, this.layout)
    await nextFrame()
    this.airport = new Airport(this.scene, this.physics, this.layout, this.town)
    this.aviation = new Aviation(this.scene, this.physics, this.layout)
    this.aviation.onBlocked = (p) => this.emit('planeBlocked', p)
    progress(0.35, 'Lighting the streets')
    this.props = new Props(this.scene, this.physics, this.layout, this.town)
    this.collectibles = new Collectibles(this.scene, this.layout, this.props, this.town)
    await nextFrame()

    progress(0.45, 'Planting trees')
    this.foliage = new Foliage(this.scene, this.physics, this.layout, this.quality, this.town)
    const { heightTex, groundTex, roadTex, roadTex2 } = this.layout.createTextures()
    U.uHeightTex.value = heightTex
    U.uGroundTex.value = groundTex
    U.uRoadTex.value = roadTex
    U.uRoadTex2.value = roadTex2
    await nextFrame()

    progress(0.6, 'Painting the ground')
    this.terrain = new Terrain(this.scene, this.layout, this.quality)
    buildTerrainPhysics(this.physics, this.layout)
    this.water = new Water(this.scene)
    this.grass = new Grass(this.scene, this.quality)
    await nextFrame()

    progress(0.72, 'Setting the sky')
    this.sky = new Sky(this.scene)
    this.lighting = new Lighting(this.scene, this.quality)
    this.seasons = new Seasons(this.tweens)
    this.dayCycle = new DayCycle(this.seasons, this.tweens)
    this.particles = new Particles(this.scene, this.quality)
    this.scene.fog = new THREE.Fog(U.uFogColor.value.clone(), 70, 270)
    this.pmrem = new THREE.PMREMGenerator(this.renderer.renderer)
    this.envTimer = 0
    this.lanternLights = []
    for (let i = 0; i < 6; i++) {
      const l = new THREE.PointLight(0xffa860, 0, 13, 1.6)
      this.scene.add(l)
      this.lanternLights.push(l)
    }
    await nextFrame()

    progress(0.8, 'Waking up the townsfolk')
    this.crowd = new CrowdRig(this.scene, 460)
    this.emotes = new Emotes(this.scene, 90)
    this.people = new People(this.crowd, this.layout, this.town, this.props, this.quality)
    this.people.setBenches(this.props.benches)
    this.crowdCtx = {
      car: { x: 0, y: 0, z: 0, vx: 0, vz: 0, speed: 0 },
      ground: (x, z) => this.layout.getDriveHeight(x, z),
      emotes: this.emotes,
      carNear: (x, z, r) => {
        const c = this.crowdCtx.car
        return (c.speed > 1.5 && (c.x - x) ** 2 + (c.z - z) ** 2 < r * r) || (this.traffic && this.traffic.near(x, z, r))
      },
      onVoice: (kind, x, z) => this.emit('voice', kind, x, z),
      onHammer: (x, z) => this.emit('hammer', x, z),
      // run someone over / knock them down: a crime, and they may go down for a while
      onKnock: (c) => this.emit('knocked', c),
      onDowned: (c, kind) => this.emit('downed', c, kind),
      respawn: (c) => this.people.respawnFar(c, this.carPos),
    }
    this.people.emotes = this.emotes
    this.people.onVoice = (kind, x, z) => this.emit('voice', kind, x, z)
    this.people.onDowned = (c, kind) => this.emit('downed', c, kind)
    this.construction = new Construction(this.scene, this.physics, this.layout, this.town, this.crowd, this.quality)
    this.traffic = new Traffic(this.scene, this.physics, this.layout, this.crowd, this.quality)
    this.traffic.on('honk', (x, z) => this.emit('honk', x, z))
    this.traffic.on('wrecked', (c, kind) => this.emit('trafficWrecked', c, kind))
    this.construction.on('complete', (site) => this.emit('siteComplete', site))
    this.construction.on('smash', (site, n) => this.emit('siteSmash', site, n))
    this.activities = new Activities(this.scene, this.layout, this.town, this.construction, this.crowd, this.emotes)
    for (const ev of ['start', 'end', 'objective', 'coins', 'toast', 'countdown', 'checkpoint', 'rallyDone', 'delivered', 'fare', 'summary', 'passengerUpset'])
      this.activities.on(ev, (...a) => this.emit(`act:${ev}`, ...a))
    this.actCtx = {
      pos: () => this.carPos,
      speed: () => (this.active ? Math.abs(this.active.phys.speed) : this.player.speed),
      inVehicle: () => !!this.active && this.active.type !== 'heli',
      vehicleType: () => this.active?.type || 'foot',
      passengerSeat: () => this.passengerSeat(),
    }
    await nextFrame()

    progress(0.88, 'Fuelling the vehicles')
    this.effects = new Effects(this.scene, this.layout, this.quality)
    this.vehicles = []
    const carFrame = this.frameNear(-10, -26, Math.PI / 2)
    const car = new VehiclePhysics(this.physics, carFrame, CAR)
    this.addVehicle('car', 'Buggy', car, new VehicleVisual(this.scene, car), { seat: new THREE.Vector3(0.36, 0.6, -0.38), exitSide: 1, width: 1.9, length: 3.6 })
    const bikeY = this.layout.getDriveHeight(-14, -19.5)
    const bike = new VehiclePhysics(this.physics, { x: -14, y: bikeY, z: -19.5, heading: Math.PI / 2 }, BIKE)
    this.addVehicle('bike', 'Motorbike', bike, new BikeVisual(this.scene, bike), { seat: new THREE.Vector3(0, 0.78, -0.22), exitSide: 1, width: 1.1, length: 2.0 })
    const hp = AIRPORT.helipad
    const heli = new HeliPhysics(this.physics, { x: hp.x, y: this.layout.getHeight(hp.x, hp.z) + 0.1, z: hp.z, heading: 0 })
    this.addVehicle('heli', 'Helicopter', heli, new HeliVisual(this.scene, heli), { seat: new THREE.Vector3(0.38, 0.95, 0.75), exitSide: 1, width: 2.2, length: 9 })
    // More rides parked around the valley (kerbside, off the traffic loops)
    const kerb = (x, z, h, side = 2.4) => {
      const f = this.frameNear(x, z, h)
      return { ...f, x: f.x - f.tz * side, z: f.z + f.tx * side, y: this.layout.getDriveHeight(f.x - f.tz * side, f.z + f.tx * side) }
    }
    const dirtBike = new VehiclePhysics(this.physics, kerb(-545, -550, Math.PI / 2), BIKE)
    this.addVehicle('bike', 'Dirt bike', dirtBike, new BikeVisual(this.scene, dirtBike, 0xe8a33a), { seat: new THREE.Vector3(0, 0.78, -0.22), exitSide: 1, width: 1.1, length: 2.0 })
    const pineBike = new VehiclePhysics(this.physics, kerb(-25, 505, 0), BIKE)
    this.addVehicle('bike', 'Motorbike', pineBike, new BikeVisual(this.scene, pineBike, 0x2f6fd8), { seat: new THREE.Vector3(0, 0.78, -0.22), exitSide: 1, width: 1.1, length: 2.0 })
    const harborCar = new VehiclePhysics(this.physics, kerb(405, -25, Math.PI / 2), CAR)
    this.addVehicle('car', 'Buggy', harborCar, new VehicleVisual(this.scene, harborCar), { seat: new THREE.Vector3(0.36, 0.6, -0.38), exitSide: 1, width: 1.9, length: 3.6 })
    // The tank, parked in Fort Granite's depot
    const ts = this.town.fort.tankSpawn
    const tankPhys = new VehiclePhysics(this.physics, { x: ts.x, y: this.layout.getDriveHeight(ts.x, ts.z), z: ts.z, heading: ts.heading }, TANK)
    const tankVisual = new TankVisual(this.scene, tankPhys)
    this.tankVehicle = this.addVehicle('tank', 'Tank', tankPhys, tankVisual, { seat: tankVisual.seat, exitSide: 1, width: 3.6, length: 6.6 })
    this.tank = new TankGunner(this, this.tankVehicle)
    this.player = new Player(this.physics, this.crowd, this.layout, { x: carFrame.x, y: carFrame.y, z: carFrame.z, heading: carFrame.heading })
    this.player.onStep = (k) => {
      const p = this.player.pos
      const q = this.layout.queryRoad(p.x, p.z)
      const surf = q.d < WORLD.roadHalfWidth + WORLD.sidewalk + 0.3 ? 'road' : p.y - this.layout.getHeight(p.x, p.z) > 0.3 ? 'wood' : 'grass'
      this.emit('footstep', k, surf)
    }
    this.enterVehicle(this.vehicles[0], true)
    this.carPos = new THREE.Vector3()
    this.carQuat = new THREE.Quaternion()
    this.rig = new CameraRig(this.camera, this.renderer.renderer.domElement, this.physics)
    this.input = new Input()
    this.input.enabled = false
    this.input.attachMouse(this.renderer.renderer.domElement)
    this.combat = new Combat(this)
    this.pickups = new Pickups(this.scene, this.layout, this.town)
    this.wanted = new Wanted()
    this.police = new Police(this)
    this.missions = new Missions(this)
    // left click shoots (cursor aim) in the overhead view whenever a shot is possible
    this.rig.fireButton = (button) => button === 0 && this.started && (this.combat.canShoot() || this.active?.type === 'tank')
    this.rig.wheelLocked = () => !this.active && this.rig.mode === 'third'
    this.wireEvents()

    // Warm up: settle physics, compile shaders, bake the environment map
    for (let i = 0; i < 90; i++) this.fixedUpdate(1 / 60, true)
    this.physics.sync(1)
    this.frameUpdate(0.016, 0)
    this.updateEnvironment(true)
    this.renderer.renderer.compile(this.scene, this.camera)
    progress(1, 'Ready')

    this.loop = new Loop()
    this.loop.onFixed = (dt) => this.fixedUpdate(dt)
    this.loop.onFrame = (dt, alpha, elapsed) => this.frame(dt, alpha, elapsed)
    this.loop.start()
  }

  wireEvents() {
    this.physics.onImpact = (force, h1, h2) => {
      const t1 = this.physics.getTag(h1), t2 = this.physics.getTag(h2)
      const isCar = t1?.kind === 'car' || t2?.kind === 'car'
      const other = t1?.kind === 'car' ? t2 : t1
      const strength = clamp((force - 2000) / 60000, 0, 1)
      const now = performance.now()
      if (isCar && strength > 0.02 && (now - (this.lastShake || 0) > 280 || strength > (this.lastShakeStrength || 0) * 1.5)) {
        this.rig.addShake(strength * 0.9)
        this.lastShake = now
        this.lastShakeStrength = strength
      }
      if (isCar && strength > 0.18) this.activities.bump()
      // crashes hurt the vehicle; a hard crash throws you off a motorbike
      const a = this.active
      const tnow = performance.now()
      if (isCar && a && strength > 0.15 && tnow - (a.lastCrash || 0) > 300 && Math.abs(a.phys.speed) > (a.type === 'tank' ? 9 : 3)) {
        a.lastCrash = tnow
        this.combat.damageVehicle(a, strength * (a.type === 'tank' ? 25 : 200), null, 'crash')
      }
      if (isCar && a?.type === 'bike' && strength > 0.32 && Math.abs(a.phys.speed) > 11) this.ejectFromBike(a)
      if (isCar && other?.kind === 'traffic' && strength > 0.03) {
        const h = t1?.kind === 'traffic' ? h1 : h2
        const col = this.physics.world.getCollider(h)
        if (col) {
          this.traffic.rammed(col.parent(), this.emotes, (x, z) => this.emit('honk', x, z))
          const tc = this.traffic.byBody(col.parent())
          const heavy = this.active?.phys.cfg.heavy
          if (tc && heavy && strength > 0.04) {
            // the tank rolls right over cars
            const dir = this.active.phys.basis().fwd
            this.traffic.damage(tc, 999, { x: dir.x * 6000, y: 9000, z: dir.z * 6000 }, 'crush')
            this.emit('crush', tc)
          } else if (tc && strength > 0.25) this.traffic.damage(tc, strength * 45, null, 'ram')
        }
      }
      if (isCar && other?.kind === 'car' && strength > 0.1 && this.active) {
        const h = t1?.kind === 'car' && this.physics.world.getCollider(h1)?.parent() !== this.active.phys.body ? h1 : h2
        const otherBody = this.physics.world.getCollider(h)?.parent()
        const ov = this.allVehicles().find((k) => k.phys.body === otherBody && k !== this.active)
        if (ov && strength > 0.15) this.combat.damageVehicle(ov, strength * (this.active.type === 'tank' ? 900 : 260), null, 'player')
        const pv = this.police.vehicleByBody(otherBody)
        if (pv && performance.now() - (this.lastCopHit || 0) > 1500) {
          this.lastCopHit = performance.now()
          this.wanted.crime('copHit', this.carPos, true)
        }
      }
      this.emit('impact', { force, strength: isCar ? strength : clamp(force / 8000, 0, 1), material: other?.material || 'ground', withCar: isCar, kind: other?.kind })
    }
    this.wireCombat()
    this.wirePolice()
    this.collectibles.on('collect', (it, n, total) => {
      this.effects.burst(it.pos, 'sparkle', 34)
      this.emit('collect', n, total)
    })
    this.collectibles.on('complete', () => this.emit('collectComplete'))
    this.dayCycle.onThunder = (delay) => this.emit('thunder', delay)
    this.seasons.onChange((name) => {
      this.envDirty = 2.6
      this.emit('season', name)
    })

    this.input.on('press', (code) => {
      if (!this.started) return
      const inHeli = this.active?.type === 'heli'
      if (code === 'KeyF' || (code === 'KeyE' && !inHeli)) this.toggleVehicle()
      if (code === 'KeyI' && inHeli) this.emit('ignition', this.active.phys.ignition())
      if (code === 'KeyG') this.interact()
      if (code === 'KeyJ') this.emit('openActivities')
      if (code === 'KeyR') {
        if (this.active) this.respawn()
        else this.combat.reload()
      }
      if (code === 'Backspace') this.respawn()
      if (code === 'KeyC') this.emit('camera', this.rig.toggle())
      // weapons on 1-7, seasons on 8 / 9 / 0
      const slot = /^Digit([1-7])$/.exec(code)
      if (slot) this.combat.selectSlot(+slot[1])
      if (code === 'Digit8') this.seasons.set('autumn')
      if (code === 'Digit9') this.seasons.set('spring')
      if (code === 'Digit0') this.seasons.set('monsoon')
      if (code === 'Tab') this.emit('wheelOpen')
      if (code === 'KeyN') this.toggleNight()
      if (code === 'KeyM') this.emit('toggleMusic')
    })
  }

  start() {
    this.started = true
    this.input.enabled = true
  }

  // Every drivable / driving vehicle: yours, the police's and the current mission's
  allVehicles() {
    return [...this.vehicles, ...this.police.vehicles, ...this.missions.vehicles]
  }

  // Is a police officer / car within r metres of p?
  copNear(p, r) {
    for (const u of this.police.units) {
      if (u.v && Math.hypot(u.v.pos.x - p.x, u.v.pos.z - p.z) < r) return true
      for (const c of u.crew) if (!c.down && c.visible && Math.hypot(c.x - p.x, c.z - p.z) < r) return true
    }
    return !!this.police.heli && Math.hypot(this.police.heli.pos.x - p.x, this.police.heli.pos.z - p.z) < r * 1.5
  }

  // Did anybody see it? (townsfolk within 40 m, or the police)
  witnessed(p) {
    if (this.copNear(p, 90)) return true
    for (const c of this.crowd.list) {
      if (!c.visible || c.isPlayer || c.down || c.drive > 0.5) continue
      if ((c.x - p.x) ** 2 + (c.z - p.z) ** 2 < 40 * 40) return true
    }
    return false
  }

  wirePolice() {
    const W = this.wanted
    const C = this.combat
    this.police.on('bust', () => this.knockedOut('arrest', true))
    W.on('cleared', () => this.police.standDown())
    // gunfire is reported by anyone who sees or hears it (passers-by, drivers, the police)
    C.on('disturbance', (p, seen, owner) => {
      if (owner !== 'player') return
      const drivers = this.traffic.cars.some((c) => c.state === 'drive' && c.pos.distanceTo(p) < 70)
      W.crime('shots', p, seen > 0 || drivers || this.copNear(p, 110) || Math.random() < 0.4)
    })
    C.on('hitChar', (c, downed, owner, kind) => {
      if (owner !== 'player' || c.officer) return
      if (downed) W.crime('downed', this.carPos, this.witnessed(this.carPos))
      else if (kind === 'melee') W.crime('assault', this.carPos, this.witnessed(this.carPos))
    })
    C.on('explosion', (p, size, owner) => { if (owner === 'player') W.crime('explosion', p, true) })
    C.on('vehicleDamaged', (v, amount, owner) => {
      if (v.police && owner === 'player' && performance.now() - (this.lastCopHit || 0) > 1500) {
        this.lastCopHit = performance.now()
        W.crime('copHit', this.carPos, true)
      }
    })
    this.on('downed', (c, kind) => {
      if (kind !== 'vehicle' || !this.active) return
      W.crime(c.officer ? 'copDowned' : 'downed', this.carPos, this.witnessed(this.carPos))
    })
    this.on('knocked', () => { if (this.active) W.crime('assault', this.carPos, this.witnessed(this.carPos)) })
    this.on('carjack', () => W.crime('carjack', this.carPos, this.witnessed(this.carPos)))
    this.on('trafficWrecked', (c) => W.crime('wreck', c.pos, true))
    this.on('crush', () => W.crime('wreck', this.carPos, true))
  }

  wireCombat() {
    this.input.on('release', (code) => { if (code === 'Tab') this.emit('wheelClose') })
    this.input.on('wheel', (dir) => { if (this.started && this.rig.wheelLocked()) this.combat.cycle(dir) })
    this.input.on('cycleWeapon', (dir) => this.combat.cycle(dir))
    this.input.on('look', (dx, dy) => this.emit('wheelLook', dx, dy))
    this.traffic.on('explode', (c) => this.combat.explode(c.pos.clone().setY(c.pos.y + 0.8), { radius: 6.5, damage: 180, owner: 'world', size: 1.1 }))
    this.player.on('dead', (kind) => this.knockedOut(kind))
    this.pickups.on('collect', (kind, it) => {
      const p = this.player
      if (kind === 'health') p.heal(60)
      else if (kind === 'armor') p.armor = 100
      else if (kind === 'ammo') { for (const id of ['pistol', 'smg', 'shotgun', 'rifle', 'sniper']) this.combat.addAmmo(id, { pistol: 36, smg: 60, shotgun: 12, rifle: 60, sniper: 5 }[id]) }
      else if (kind === 'rocket') this.combat.addAmmo('rocket', 3)
      else if (kind === 'nitro' && this.active) this.active.phys.nitro = 1
      this.emit('pickup', kind, it)
    })
  }

  // G: start an activity / mission, open a gun shop, or quit what you're doing
  interact() {
    if (this.missions.current) return this.missions.quit()
    const ms = !this.activities.current && this.missions.nearStart(this.carPos)
    if (ms) return this.missions.start(ms.id)
    if (!this.active) {
      const shop = this.nearPlace(this.town.gunShops, 4.5)
      if (shop) return this.emit('openShop', shop)
    }
    this.toggleActivity()
  }

  nearPlace(list, r) {
    const p = this.carPos
    for (const s of list || []) {
      const d = s.door || s
      if ((d.x - p.x) ** 2 + (d.z - p.z) ** 2 < r * r) return s
    }
    return null
  }

  // Health hit zero: fall, fade, wake up at the nearest hospital (or the police station)
  knockedOut(kind = 'down', arrested = false) {
    if (this.koTimer) return
    if (this.active) {
      const v = this.active
      v.phys.occupied = false
      this.player.mode = 'foot'
      this.player.vehicle = null
      this.player.setEnabled(true)
      const spot = this.player.exitSpot(v)
      this.player.placeAt(spot.x, spot.y, spot.z)
      this.rig.setKind('foot')
    }
    this.player.dead = true
    this.input.enabled = false
    this.wanted.clear(arrested ? 'busted' : 'wasted')
    this.emit(arrested ? 'arrested' : 'knockedOut', kind)
    this.koTimer = setTimeout(() => {
      this.koTimer = null
      const list = arrested ? this.town.policeStations : this.town.hospitals
      const p = this.player.pos
      let best = list[0], bd = Infinity
      for (const h of list) {
        const d = (h.door.x - p.x) ** 2 + (h.door.z - p.z) ** 2
        if (d < bd) { bd = d; best = h }
      }
      const out = { x: best.door.x + Math.sin(best.rot) * 3, z: best.door.z + Math.cos(best.rot) * 3 }
      this.player.revive()
      this.player.armor = 0
      this.player.placeAt(out.x, this.layout.getDriveHeight(out.x, out.z) + 0.1, out.z, best.rot)
      this.rig.yaw = best.rot
      this.rig.snap()
      const fee = Math.min(this.activities.coins, Math.round(this.activities.coins * 0.1) + (arrested ? 20 : 10))
      this.activities.coins -= fee
      this.activities.save()
      if (arrested) for (const id of ['smg', 'shotgun', 'rifle', 'sniper', 'rocket']) this.combat.inv[id].ammo = Math.floor(this.combat.inv[id].ammo / 2)
      this.input.enabled = true
      this.emit('revived', best, fee, arrested)
    }, 4500)
  }

  // G: start the activity whose marker you're standing / parked in, or quit the current one
  toggleActivity() {
    const acts = this.activities
    if (acts.current) return acts.stop('quit')
    const s = acts.nearStart(this.carPos)
    if (!s) return this.emit('notice', 'Find a glowing marker to start an activity (J for the list)')
    if (!this.active || this.active.type === 'heli') return this.emit('notice', 'Grab the buggy or the motorbike first')
    acts.clearWaypoint()
    acts.start(s.id, this.actCtx)
  }

  // Horn: nearby people stop, turn to look and some grumble or wave
  honk() {
    const p = this.carPos
    const now = performance.now()
    if (now - (this.lastHonk || 0) < 700) return
    this.lastHonk = now
    let n = 0
    for (const c of this.people.all) {
      if (c.reaction || !c.visible || c.sit > 0.5) continue
      const d2 = (c.x - p.x) ** 2 + (c.z - p.z) ** 2
      if (d2 > 16 * 16) continue
      c.heading = Math.atan2(p.x - c.x, p.z - c.z)
      c.reaction = { type: 'recover', t: 0, d: 0.8 + Math.random() * 0.6 }
      if (n++ < 4) {
        const r = Math.random()
        this.emotes.show(c, r < 0.4 ? EMOTE.angry : r < 0.7 ? EMOTE.question : EMOTE.wave, 1.4)
        if (r < 0.4) c.fist = 1
        if (n === 1) this.emit('voice', r < 0.4 ? 'angry' : 'hey', c.x, c.z)
      }
    }
  }

  // Where a taxi passenger sits in the current vehicle (world space)
  passengerSeat() {
    const v = this.active || this.lastVehicle
    const local = v.type === 'bike' ? new THREE.Vector3(0, 0.82, -0.62) : new THREE.Vector3(-0.36, 0.6, -0.38)
    const p = local.applyQuaternion(v.quat).add(v.pos)
    const heading = new THREE.Euler().setFromQuaternion(v.quat, 'YXZ').y
    return { x: p.x, y: p.y, z: p.z, heading, lean: v.visual.leanAngle || 0 }
  }

  toggleNight() {
    const toNight = this.dayCycle.toggleNight()
    this.envDirty = 3.6
    this.emit('daynight', toNight)
    return toNight
  }

  // Road frame nearest to a point, oriented as close as possible to a heading
  frameNear(x, z, heading) {
    const L = this.layout
    const q = L.queryRoad(x, z)
    let i = q.i >= 0 ? q.i : 0
    const e = L.edges[L.roadEdge[i]]
    while (L.isOnBridge(i) && i > e.start) i--
    const f = L.roadFrame(i)
    const d = Math.atan2(Math.sin(heading - f.heading), Math.cos(heading - f.heading))
    return Math.abs(d) > Math.PI / 2 ? L.roadFrame(i, true) : f
  }

  addVehicle(type, name, phys, visual, opts) {
    const v = { type, name, phys, visual, pos: new THREE.Vector3(), quat: new THREE.Quaternion(), ...opts }
    const tmp = new THREE.Quaternion()
    v.dyn = this.physics.addDynamic(phys.body, (prev, curr, a) => {
      v.pos.set(prev.p.x + (curr.p.x - prev.p.x) * a, prev.p.y + (curr.p.y - prev.p.y) * a, prev.p.z + (curr.p.z - prev.p.z) * a)
      v.quat.set(prev.q.x, prev.q.y, prev.q.z, prev.q.w).slerp(tmp.set(curr.q.x, curr.q.y, curr.q.z, curr.q.w), a)
    })
    const t = phys.body.translation(), r = phys.body.rotation()
    v.pos.set(t.x, t.y, t.z)
    v.quat.set(r.x, r.y, r.z, r.w)
    v.home = { x: t.x, y: t.y - 1.2, z: t.z, heading: new THREE.Euler().setFromQuaternion(v.quat, 'YXZ').y }
    this.vehicles.push(v)
    return v
  }

  // Remove a vehicle completely (stolen cars that are no longer needed)
  removeVehicle(v) {
    const i = this.vehicles.indexOf(v)
    if (i < 0 || v === this.active) return
    this.vehicles.splice(i, 1)
    const d = this.physics.dynamics.indexOf(v.dyn)
    if (d >= 0) this.physics.dynamics.splice(d, 1)
    if (v.phys.controller) this.physics.world.removeVehicleController(v.phys.controller)
    this.physics.world.removeRigidBody(v.phys.body)
    v.visual.group.removeFromParent()
    if (this.lastVehicle === v) this.lastVehicle = null
  }

  // A burnt-out vehicle: stolen ones vanish, the valley's own vehicles return home repaired
  recycleVehicle(v) {
    if (v.stolen) return this.removeVehicle(v)
    v.phys.reset(v.home)
    this.combat.repairVehicle(v)
    this.physics.sync(1)
  }

  // Pull a traffic driver out and take the car
  carjack(c) {
    const info = this.traffic.carjack(c, this.player.pos)
    if (!info) return null
    const cfg = info.kind === 'van' ? VAN : SEDAN
    const phys = new VehiclePhysics(this.physics, { x: info.x, y: info.y - 0.7, z: info.z, heading: info.heading }, cfg)
    const visual = new SedanVisual(this.scene, phys, info.kind === 'van' ? 'van' : info.kind, info.color)
    const v = this.addVehicle('car', info.kind === 'van' ? 'Van' : 'Sedan', phys, visual, { seat: visual.seat, exitSide: 1, width: 2.0, length: 4.2, stolen: true })
    v.stolenAt = performance.now()
    // keep at most four stolen cars around: drop the oldest one out of sight
    const stolen = this.vehicles.filter((k) => k.stolen && k !== v && k !== this.active)
    if (stolen.length > 3) {
      stolen.sort((a, b) => a.stolenAt - b.stolenAt)
      this.removeVehicle(stolen[0])
    }
    this.enterVehicle(v)
    this.emit('carjack', c, v)
    return v
  }

  get active() {
    return this.player?.mode === 'vehicle' ? this.player.vehicle : null
  }

  // Compatibility: the physics of the vehicle being driven (or the last one used)
  get vehicle() {
    return (this.active || this.lastVehicle || this.vehicles[0]).phys
  }

  // Nearest vehicle the player could get into
  nearbyVehicle() {
    const p = this.player.pos
    let best = null, bd = Infinity
    for (const v of this.vehicles) {
      if (v.wrecked) continue
      const d = Math.hypot(v.pos.x - p.x, v.pos.z - p.z) - v.length * 0.35
      if (d < bd && Math.abs(v.pos.y - p.y) < 3) { bd = d; best = v }
    }
    return bd < 2.6 ? best : null
  }

  enterVehicle(v, silent = false) {
    if (v.type === 'tank' && !silent && this.wanted) {
      const pp = v.pos
      if (pp.x > FORT.x0 - 15 && pp.x < FORT.x1 + 15 && pp.z > FORT.z0 - 15 && pp.z < FORT.z1 + 15) this.wanted.crime('military', pp, true)
    }
    this.player.mode = 'vehicle'
    this.player.vehicle = v
    this.player.setEnabled(false)
    v.phys.occupied = true
    this.lastVehicle = v
    if (!silent) this.emit('enter', v)
    this.rig?.setKind(v.type)
  }

  exitVehicle() {
    const v = this.active
    if (!v) return
    if (v.type === 'heli' && !(v.phys.grounded && v.phys.speed < 2)) {
      this.emit('notice', 'Land the helicopter before getting out')
      return
    }
    if (v.type !== 'heli' && Math.abs(v.phys.speed) > 4) {
      this.emit('notice', 'Slow down to get out')
      return
    }
    const spot = this.player.exitSpot(v)
    v.phys.occupied = false
    this.player.mode = 'foot'
    this.player.vehicle = null
    this.player.setEnabled(true)
    const heading = new THREE.Euler().setFromQuaternion(v.quat, 'YXZ').y
    this.player.placeAt(spot.x, spot.y, spot.z, heading)
    this.player.char.drive = this.player.char.ride = 0
    this.player.char.lean = 0
    this.rig.setKind('foot')
    this.rig.yaw = heading
    this.emit('exit', v)
  }

  // Thrown over the handlebars
  ejectFromBike(v) {
    if (!this.active || this.koTimer) return
    const lv = v.phys.body.linvel()
    v.phys.occupied = false
    this.player.mode = 'foot'
    this.player.vehicle = null
    this.player.setEnabled(true)
    this.player.placeAt(v.pos.x, v.pos.y + 0.8, v.pos.z)
    this.player.knockOver(lv.x * 0.6, 5, lv.z * 0.6)
    this.player.damage(10 + Math.min(30, Math.hypot(lv.x, lv.z)), null, 'crash')
    this.rig.setKind('foot')
    this.emit('ejected', v)
  }

  toggleVehicle() {
    if (this.active) return this.exitVehicle()
    const v = this.nearbyVehicle()
    if (v) return this.enterVehicle(v)
    // a police car whose crew is out
    const pc = this.police.freeCarNear(this.player.pos)
    if (pc) {
      this.police.takeCar(pc)
      this.enterVehicle(pc)
      this.wanted.crime('copCar', this.carPos, true)
      return
    }
    // no parked vehicle nearby: carjack a slow traffic car
    const p = this.player.pos
    const c = this.traffic.nearestDriving(p.x, p.z, 3.6)
    if (c && c.speed < 7) this.carjack(c)
  }

  respawn() {
    const v = this.active
    if (!v) {
      const q = this.layout.queryRoad(this.player.pos.x, this.player.pos.z)
      const side = WORLD.roadHalfWidth + 1.2
      this.player.placeAt(this.layout.roadX[q.i] - this.layout.roadTZ[q.i] * side, this.layout.roadH[q.i] + 0.2, this.layout.roadZ[q.i] + this.layout.roadTX[q.i] * side)
      return
    }
    if (v.type === 'heli') {
      const p = v.phys.position
      const heading = new THREE.Euler().setFromQuaternion(v.quat, 'YXZ').y
      v.phys.reset({ x: p.x, y: Math.max(p.y, this.layout.getDriveHeight(p.x, p.z)) + 0.5, z: p.z, heading })
    } else {
      const { fwd } = v.phys.basis()
      const f = this.frameNear(v.pos.x, v.pos.z, Math.atan2(fwd.x, fwd.z))
      v.phys.reset(f)
    }
    this.physics.sync(1)
    this.emit('respawn')
  }

  fixedUpdate(dt, warmup = false) {
    const active = this.active
    for (const v of this.vehicles) {
      const vp = v.phys
      const p = vp.position
      const mine = v === active && !warmup
      if (v.type === 'heli') {
        vp.update(dt, mine ? this.input.heli : { collective: 0, pitch: 0, bank: 0, yaw: 0 }, {})
        continue
      }
      // Surface under each wheel (road / dirt / deck) drives grip, dust and audio
      for (let i = 0; i < vp.nWheels; i++) {
        const s = vp.wheelState(i)
        if (!s.point || !s.contact) continue
        const q = this.layout.queryRoad(s.point.x, s.point.z)
        if (q.d < WORLD.roadHalfWidth + WORLD.sidewalk + 0.3) vp.wheelSurface[i] = 'road'
        else {
          const ground = this.layout.getHeight(s.point.x, s.point.z)
          vp.wheelSurface[i] = s.point.y - ground > 0.25 ? 'wood' : 'dirt'
        }
      }
      const input = mine ? this.input.state : { throttle: 0, brake: 0, steer: 0, handbrake: true, boost: false }
      vp.update(dt, input, { wet: U.uWet.value, waterLevel: WORLD.waterLevel, overWater: this.layout.isWater(p.x, p.z) })
    }
    if (!active && !warmup) this.player.updateFoot(dt, this.input.foot, this.rig.forwardYaw())
    if (!warmup && this.police) this.police.fixedUpdate(dt)
    if (!warmup && this.missions) this.missions.fixedUpdate(dt)
    this.physics.step(dt)

    if (warmup || !active) return
    // Recovery: flipped, sunk or fell out of the world
    const vp = active.phys
    const p = vp.position
    if (vp.flippedTime > 2.2 || vp.inWater > 2.2 || p.y < -12) this.respawn()
  }

  frame(dt, alpha, elapsed) {
    this.physics.sync(alpha)
    this.frameUpdate(dt, elapsed)
    this.renderer.render(elapsed)
  }

  frameUpdate(dt, elapsed) {
    U.uTime.value = elapsed
    this.tweens.update(dt)
    this.dayCycle.update(dt)

    for (const v of this.vehicles) {
      if (v.type === 'heli') v.visual.update(dt, v.pos, v.quat, elapsed)
      else v.visual.update(dt, v.pos, v.quat)
    }
    const active = this.active
    const vp = this.vehicle
    let lv
    if (active) {
      lv = active.phys.body.linvel()
      this.player.updateSeated(active, dt)
      this.carPos.copy(active.pos)
      this.carQuat.copy(active.quat)
      const heading = new THREE.Euler().setFromQuaternion(active.quat, 'YXZ').y
      this.rig.update(dt, { pos: active.type === 'heli' ? active.pos.clone().setY(active.pos.y + 1) : active.pos, quat: active.quat, vel: lv, speed: Math.abs(active.phys.speed), boosting: active.phys.boosting, body: active.phys.body, heading })
    } else {
      lv = this.player.vel
      this.carPos.copy(this.player.pos)
      this.carQuat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.player.heading)
      this.rig.update(dt, { pos: this.player.pos, quat: this.carQuat, vel: lv, speed: this.player.speed, boosting: this.player.sprinting && this.player.speed > 5, body: this.player.body, heading: this.player.heading })
    }
    this.effects.update(dt, active && active.type !== 'heli' ? active.phys : null, active?.visual, active?.type === 'heli' ? active.phys : null)
    U.uCarPos.value.copy(this.carPos)
    U.uCarVel.value.set(lv.x, lv.y, lv.z)
    U.uFocus.value.copy(this.rig.focus)
    // interaction prompt
    this.promptTimer = (this.promptTimer || 0) - dt
    if (this.promptTimer <= 0) {
      this.promptTimer = 0.2
      const near = !active ? this.nearbyVehicle() : null
      const start = this.missions.current ? null : this.activities.nearStart(this.carPos)
      const mstart = this.activities.current ? null : this.missions.nearStart(this.carPos)
      let jack = null
      const shop = !active && !start ? this.nearPlace(this.town.gunShops, 4.5) : null
      if (!active && !near && !shop) {
        const c = this.traffic.nearestDriving(this.player.pos.x, this.player.pos.z, 3.6)
        if (c && c.speed < 7) jack = c
      }
      this.emit('prompt', active ? active : null, near, start, jack, shop, mstart)
    }

    // Atmosphere
    const b = this.seasons.base
    const r = this.renderer
    r.renderer.toneMappingExposure = this.dayCycle.exposure
    this.lighting.sun.intensity = this.dayCycle.sunIntensity * (1 + U.uLightning.value * 1.5)
    this.lighting.sun.color.copy(U.uSunColor.value)
    this.lighting.hemi.intensity = this.dayCycle.hemiIntensity + U.uLightning.value * 2
    this.lighting.hemi.color.copy(b.hemiSky).lerp(new THREE.Color('#3a4f7a'), U.uNight.value)
    this.lighting.hemi.groundColor.copy(b.hemiGround).lerp(new THREE.Color('#1a1a2a'), U.uNight.value)
    this.lighting.update(this.rig.focus)
    this.scene.fog.color.copy(U.uFogColor.value)
    this.scene.fog.near = this.dayCycle.fog.near
    this.scene.fog.far = this.dayCycle.fog.far
    this.sky.update(this.camera.position)
    this.terrain.update(dt, this.camera.position)
    this.particles.update(b, U.uNight.value)
    const g = r.grade.uniforms
    g.uLift.value = [b.lift.x, b.lift.y + U.uNight.value * 0.015, b.lift.z + U.uNight.value * 0.04]
    g.uGain.value = [b.gain.x, b.gain.y, b.gain.z]
    g.uSaturation.value = b.saturation * (1 - U.uNight.value * 0.15)
    g.uContrast.value = b.contrast
    g.uFlash.value = U.uLightning.value * 0.08
    U.uWindDir.value.set(Math.cos(elapsed * 0.05) * 0.86, 0.5 + Math.sin(elapsed * 0.07) * 0.3).normalize()

    // Night lighting: lanterns glow, nearest lanterns get real point lights
    const night = U.uNight.value
    this.props.lanternGlass.emissiveIntensity = 1.2 + night * 6
    this.props.windowMat.emissiveIntensity = 0.1 + night * 3
    this.lightTimer = (this.lightTimer || 0) - dt
    if (this.lightTimer <= 0) {
      this.lightTimer = 0.25
      const sorted = this.props.lanterns
        .map((l) => ({ l, d: l.distanceToSquared(this.rig.focus) }))
        .sort((a, c) => a.d - c.d)
      this.lanternLights.forEach((light, i) => sorted[i] && light.position.copy(sorted[i].l))
    }
    for (const light of this.lanternLights) light.intensity = night * 14

    // Gameplay
    this.town.update(this.dayCycle.time, night)
    this.airport.update(elapsed, night, U.uWindDir.value)
    this.aviation.update(Math.min(dt, 0.05), elapsed, [{ x: this.carPos.x, y: this.carPos.y, z: this.carPos.z }])
    for (const pl of this.aviation.planes) {
      if (!(pl.smoke > 0)) continue
      pl.smoke -= dt
      pl.smokeAcc = (pl.smokeAcc || 0) + dt * 14
      while (pl.smokeAcc > 1) { pl.smokeAcc -= 1; this.effects.smokeTrail(pl.pos, 1.2, pl.smoke > 30) }
    }
    // People: threat = the player's vehicle
    const cc = this.crowdCtx.car
    cc.x = this.carPos.x; cc.y = this.carPos.y; cc.z = this.carPos.z
    cc.vx = lv.x; cc.vz = lv.z
    cc.speed = active && (active.type !== 'heli' || active.phys.altitude < 1.5) ? Math.hypot(lv.x, lv.z) : 0
    cc.heavy = active?.type === 'tank'
    if (!active) {
      // people step aside for the player on foot
      const p = this.player.pos
      for (const c of this.people.walkers) {
        const dx = c.x - p.x, dz = c.z - p.z, d2 = dx * dx + dz * dz
        if (d2 < 0.64 && d2 > 1e-4) {
          const d = Math.sqrt(d2), push = (0.8 - d) * 0.5
          c.x += (dx / d) * push
          c.z += (dz / d) * push
        }
      }
    }
    this.people.update(Math.min(dt, 0.05), elapsed, this.crowdCtx)
    let vinfo = null
    if (active) {
      const r = active.type === 'car' ? 1.3 : active.type === 'bike' ? 0.7 : 2.2
      vinfo = { x: this.carPos.x, y: this.carPos.y + (active.type === 'heli' ? 1 : 0.5), z: this.carPos.z, vx: lv.x, vz: lv.z, speed: Math.hypot(lv.x, lv.z), r, h: active.type === 'heli' ? 1.6 : 1.0, mass: active.phys.mass }
    }
    this.construction.update(Math.min(dt, 0.05), elapsed, this.crowdCtx, vinfo)
    this.traffic.update(Math.min(dt, 0.05), { player: active ? { x: this.carPos.x, z: this.carPos.z } : { x: this.player.pos.x, z: this.player.pos.z }, walkers: this.people.walkers })
    this.crowd.focus.set(this.camera.position.x, 0, this.camera.position.z)
    this.crowd.update(elapsed)
    this.emotes.update(dt)
    if (this.started) {
      this.wanted.update(Math.min(dt, 0.05), this.carPos)
      this.police.update(Math.min(dt, 0.05), this.crowdCtx)
      this.combat.update(Math.min(dt, 0.05), this.input)
      this.tank.update(Math.min(dt, 0.05), this.input)
      this.missions.update(Math.min(dt, 0.05), elapsed)
      this.pickups.update(dt, elapsed, this.carPos, active ? active.type : 'foot')
      this.checkSprayShop(dt)
    }
    this.activities.update(Math.min(dt, 0.05), elapsed, this.actCtx)
    this.activities.checkWaypoint(this.carPos)
    if (this.started) {
      this.collectibles.update(dt, elapsed, this.carPos)
    } else this.collectibles.update(dt, elapsed, new THREE.Vector3(1e4, 0, 0))

    this.updateEnvironment()
    this.emit('frame', dt)
    vp.landing = 0
  }

  // Drive slowly into a Spray & Fix bay: repaired (and, later, a fresh paint job loses the cops)
  checkSprayShop(dt) {
    this.sprayCool = Math.max(0, (this.sprayCool || 0) - dt)
    const v = this.active
    if (!v || v.type === 'heli' || this.sprayCool > 0 || Math.abs(v.phys.speed) > 4) return
    for (const s of this.town.sprayShops) {
      const b = s.bay || s.door
      if ((b.x - v.pos.x) ** 2 + (b.z - v.pos.z) ** 2 < 6 * 6) {
        this.sprayCool = 20
        this.combat.repairVehicle(v)
        let lost = false
        if (this.wanted.level > 0) {
          if (this.wanted.unseen > 1.5) { this.wanted.clear('sprayed'); lost = true }
          else return this.emit('notice', 'Not with the police watching! Lose them first')
        }
        this.emit('sprayed', s, v, lost)
        return
      }
    }
  }

  get onFoot() {
    return !this.active
  }

  updateEnvironment(force = false) {
    this.envDirty = Math.max(0, (this.envDirty || 0) - 0.016)
    this.envTimer -= 0.016
    if (!force && (this.envTimer > 0 || (this.envDirty <= 0 && this.envBaked))) return
    this.envTimer = this.envDirty > 0 ? 0.5 : 8
    this.sky.envGround.material.color.copy(this.seasons.base.hemiGround).multiplyScalar(0.5 * (1 - U.uNight.value * 0.8))
    const rt = this.pmrem.fromScene(this.sky.envScene, 0, 0.1, 50)
    if (this.envRT) this.envRT.dispose()
    this.envRT = rt
    this.scene.environment = rt.texture
    this.scene.environmentIntensity = 0.3
    this.envBaked = true
  }

  get speedKmh() {
    return this.active ? Math.abs(this.active.phys.speed) * 3.6 : this.player.speed * 3.6
  }

  setQualityTiltShift(on) {
    this.renderer.setTiltShift(on)
  }
}

