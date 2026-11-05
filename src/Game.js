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
import { Road } from './world/Road.js'
import { Water } from './world/Water.js'
import { Grass } from './world/Grass.js'
import { Foliage } from './world/Foliage.js'
import { Props } from './world/Props.js'
import { Sky } from './world/Sky.js'
import { Lighting } from './world/Lighting.js'
import { Seasons } from './atmosphere/Seasons.js'
import { DayCycle } from './atmosphere/DayCycle.js'
import { Particles } from './atmosphere/Particles.js'
import { VehiclePhysics } from './vehicle/VehiclePhysics.js'
import { VehicleVisual } from './vehicle/VehicleVisual.js'
import { CameraRig } from './vehicle/CameraRig.js'
import { Effects } from './vehicle/Effects.js'
import { Circuit } from './gameplay/Circuit.js'
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

    progress(0.3, 'Placing lanterns & bridges')
    this.props = new Props(this.scene, this.physics, this.layout)
    this.circuit = new Circuit(this.scene, this.layout)
    this.collectibles = new Collectibles(this.scene, this.layout, this.props)
    await nextFrame()

    progress(0.45, 'Growing trees')
    this.foliage = new Foliage(this.scene, this.physics, this.layout, this.quality)
    const { heightTex, groundTex } = this.layout.createTextures()
    U.uHeightTex.value = heightTex
    U.uGroundTex.value = groundTex
    await nextFrame()

    progress(0.6, 'Painting the ground')
    this.terrain = new Terrain(this.scene, this.layout)
    buildTerrainPhysics(this.physics, this.layout)
    this.road = new Road(this.scene, this.layout)
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

    progress(0.85, 'Fuelling the buggy')
    this.spawnFrame = this.layout.roadFrame(this.layout.roadCount - 14)
    this.vehicle = new VehiclePhysics(this.physics, this.spawnFrame)
    this.visual = new VehicleVisual(this.scene, this.vehicle)
    this.effects = new Effects(this.scene, this.layout, this.quality)
    this.carPos = new THREE.Vector3()
    this.carQuat = new THREE.Quaternion()
    this.physics.addDynamic(this.vehicle.body, (prev, curr, a) => {
      this.carPos.set(prev.p.x + (curr.p.x - prev.p.x) * a, prev.p.y + (curr.p.y - prev.p.y) * a, prev.p.z + (curr.p.z - prev.p.z) * a)
      this.carQuat.set(prev.q.x, prev.q.y, prev.q.z, prev.q.w).slerp(new THREE.Quaternion(curr.q.x, curr.q.y, curr.q.z, curr.q.w), a)
    })
    this.rig = new CameraRig(this.camera, this.renderer.renderer.domElement)
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
    this.circuit.on('checkpoint', (n, t) => this.emit('checkpoint', n, t))
    this.circuit.on('lap', (t, best, lap) => this.emit('lap', t, best, lap))
    this.circuit.on('start', (lap) => this.emit('lapStart', lap))
    this.circuit.on('invalid', () => this.emit('lapInvalid'))
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

  respawn() {
    const q = this.layout.queryRoad(this.carPos.x, this.carPos.z)
    let idx = q.i >= 0 ? q.i : this.layout.roadCount - 14
    if (this.layout.isOnBridge(idx)) idx = (idx - this.layout.bridge.halfSamples - 20 + this.layout.roadCount) % this.layout.roadCount
    const f = this.layout.roadFrame(idx)
    this.vehicle.reset(f)
    this.physics.sync(1)
    this.emit('respawn')
  }

  fixedUpdate(dt, warmup = false) {
    const vp = this.vehicle
    const p = vp.position
    // Surface under each wheel (road / wood / dirt) drives grip, dust and audio
    for (let i = 0; i < 4; i++) {
      const s = vp.wheelState(i)
      if (!s.point || !s.contact) continue
      const q = this.layout.queryRoad(s.point.x, s.point.z)
      if (q.d < WORLD.roadHalfWidth + 0.3) vp.wheelSurface[i] = this.layout.isOnBridge(q.i) ? 'wood' : 'road'
      else {
        const ground = this.layout.getHeight(s.point.x, s.point.z)
        vp.wheelSurface[i] = s.point.y - ground > 0.25 ? 'wood' : 'dirt'
      }
    }
    const input = warmup ? { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false } : this.input.state
    vp.update(dt, input, { wet: U.uWet.value, waterLevel: WORLD.waterLevel, overWater: this.layout.isWater(p.x, p.z) })
    this.physics.step(dt)

    if (warmup) return
    // Recovery: flipped, sunk or fell out of the world
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

    const vp = this.vehicle
    const lv = vp.body.linvel()
    this.visual.update(dt, this.carPos, this.carQuat)
    this.rig.update(dt, this.carPos, this.carQuat, lv, vp.speed, vp.boosting)
    this.effects.update(dt, vp, this.visual)
    U.uCarPos.value.copy(this.carPos)
    U.uCarVel.value.set(lv.x, lv.y, lv.z)
    U.uFocus.value.copy(this.rig.focus)

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
    if (this.started) {
      this.circuit.update(elapsed, this.carPos)
      this.collectibles.update(dt, elapsed, this.carPos)
    } else this.collectibles.update(dt, elapsed, new THREE.Vector3(1e4, 0, 0))

    this.updateEnvironment()
    this.emit('frame', dt)
    vp.landing = 0
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
    return Math.abs(this.vehicle.speed) * 3.6
  }

  setQualityTiltShift(on) {
    this.renderer.setTiltShift(on)
  }
}

