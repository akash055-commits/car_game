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
import { Emotes } from './characters/Emotes.js'
import { People } from './characters/People.js'
import { Construction } from './characters/Construction.js'
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
import { VehicleVisual } from './vehicle/VehicleVisual.js'
import { BikeVisual } from './vehicle/BikeVisual.js'
import { HeliPhysics, HeliVisual } from './vehicle/Helicopter.js'
import { Player } from './player/Player.js'
import { AIRPORT } from './world/Layout.js'
import { CameraRig } from './vehicle/CameraRig.js'
import { Effects } from './vehicle/Effects.js'
import { Collectibles } from './gameplay/Collectibles.js'

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
    progress(0.35, 'Lighting the streets')
    this.props = new Props(this.scene, this.physics, this.layout, this.town)
    this.collectibles = new Collectibles(this.scene, this.layout, this.props, this.town)
    await nextFrame()

    progress(0.45, 'Planting trees')
    this.foliage = new Foliage(this.scene, this.physics, this.layout, this.quality, this.town)
    const { heightTex, groundTex, roadTex } = this.layout.createTextures()
    U.uHeightTex.value = heightTex
    U.uGroundTex.value = groundTex
    U.uRoadTex.value = roadTex
    await nextFrame()

    progress(0.6, 'Painting the ground')
    this.terrain = new Terrain(this.scene, this.layout)
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
    this.crowd = new CrowdRig(this.scene, 220)
    this.emotes = new Emotes(this.scene, 90)
    this.people = new People(this.crowd, this.layout, this.town, this.props, this.quality)
    this.people.setBenches(this.props.benches)
    this.crowdCtx = {
      car: { x: 0, y: 0, z: 0, vx: 0, vz: 0, speed: 0 },
      ground: (x, z) => this.layout.getDriveHeight(x, z),
      emotes: this.emotes,
      carNear: (x, z, r) => {
        const c = this.crowdCtx.car
        return c.speed > 1.5 && (c.x - x) ** 2 + (c.z - z) ** 2 < r * r
      },
      onVoice: (kind, x, z) => this.emit('voice', kind, x, z),
      onHammer: (x, z) => this.emit('hammer', x, z),
    }
    this.construction = new Construction(this.scene, this.physics, this.layout, this.town, this.crowd, this.quality)
    this.construction.on('complete', (site) => this.emit('siteComplete', site))
    this.construction.on('smash', (site, n) => this.emit('siteSmash', site, n))
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
    this.player = new Player(this.physics, this.crowd, this.layout, { x: carFrame.x, y: carFrame.y, z: carFrame.z, heading: carFrame.heading })
    this.player.onStep = (k) => this.emit('footstep', k)
    this.enterVehicle(this.vehicles[0], true)
    this.carPos = new THREE.Vector3()
    this.carQuat = new THREE.Quaternion()
    this.rig = new CameraRig(this.camera, this.renderer.renderer.domElement, this.physics)
    this.input = new Input()
    this.input.enabled = false
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
      this.emit('impact', { force, strength: isCar ? strength : clamp(force / 8000, 0, 1), material: other?.material || 'ground', withCar: isCar, kind: other?.kind })
    }
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
      if (code === 'KeyR') this.respawn()
      if (code === 'KeyC') this.emit('camera', this.rig.toggle())
      if (code === 'Digit1') this.seasons.set('autumn')
      if (code === 'Digit2') this.seasons.set('spring')
      if (code === 'Digit3') this.seasons.set('monsoon')
      if (code === 'KeyN') this.toggleNight()
      if (code === 'KeyM') this.emit('toggleMusic')
    })
  }

  start() {
    this.started = true
    this.input.enabled = true
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
    this.physics.addDynamic(phys.body, (prev, curr, a) => {
      v.pos.set(prev.p.x + (curr.p.x - prev.p.x) * a, prev.p.y + (curr.p.y - prev.p.y) * a, prev.p.z + (curr.p.z - prev.p.z) * a)
      v.quat.set(prev.q.x, prev.q.y, prev.q.z, prev.q.w).slerp(tmp.set(curr.q.x, curr.q.y, curr.q.z, curr.q.w), a)
    })
    const t = phys.body.translation(), r = phys.body.rotation()
    v.pos.set(t.x, t.y, t.z)
    v.quat.set(r.x, r.y, r.z, r.w)
    this.vehicles.push(v)
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
      const d = Math.hypot(v.pos.x - p.x, v.pos.z - p.z) - v.length * 0.35
      if (d < bd && Math.abs(v.pos.y - p.y) < 3) { bd = d; best = v }
    }
    return bd < 2.6 ? best : null
  }

  enterVehicle(v, silent = false) {
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

  toggleVehicle() {
    if (this.active) return this.exitVehicle()
    const v = this.nearbyVehicle()
    if (v) this.enterVehicle(v)
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
      for (let i = 0; i < 4; i++) {
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
      this.rig.update(dt, { pos: this.player.pos, quat: this.carQuat, vel: lv, speed: this.player.speed, boosting: false, body: this.player.body, heading: this.player.heading })
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
      this.emit('prompt', active ? active : null, near)
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
    // People: threat = the player's vehicle
    const cc = this.crowdCtx.car
    cc.x = this.carPos.x; cc.y = this.carPos.y; cc.z = this.carPos.z
    cc.vx = lv.x; cc.vz = lv.z
    cc.speed = active && (active.type !== 'heli' || active.phys.altitude < 1.5) ? Math.hypot(lv.x, lv.z) : 0
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
    this.crowd.focus.set(this.camera.position.x, 0, this.camera.position.z)
    this.crowd.update(elapsed)
    this.emotes.update(dt)
    if (this.started) {
      this.collectibles.update(dt, elapsed, this.carPos)
    } else this.collectibles.update(dt, elapsed, new THREE.Vector3(1e4, 0, 0))

    this.updateEnvironment()
    this.emit('frame', dt)
    vp.landing = 0
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

