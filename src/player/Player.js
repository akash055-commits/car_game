// The player's character. On foot it uses Rapier's kinematic character controller
// (collides with buildings, props and vehicles, climbs kerbs, snaps to the ground,
// can jump and sprint). It gets in / out of the car, motorbike and helicopter and is
// shown seated while driving or flying.
import * as THREE from 'three'
import { makeCharacter } from '../characters/Rig.js'
import { makeRandom, damp, angleDelta, clamp } from '../core/math.js'

const WALK = 2.0
const RUN = 4.6 // stick pushed fully on touch, or Shift held while out of breath
const SPRINT = 7.4 // hold Shift (SPRINT button on touch)
const SPRINT_TIME = 9 // seconds of sprint on a full stamina bar

export class Player {
  constructor(physics, crowd, layout, spawn) {
    this.physics = physics
    this.layout = layout
    const R = physics.RAPIER
    const world = physics.world
    const rnd = makeRandom(9)
    this.char = crowd.add(makeCharacter(rnd, {
      kind: 'adult', female: false, hairStyle: 'short', beard: false, hat: 'none', longSleeves: true, scale: 1.02, width: 1,
      colors: { shirt: '#2b9e96', pants: '#3d4f7a', shoes: '#f2f0ea', hair: '#2a1d16', skin: '#e3b48e' },
    }))
    this.char.noReact = true
    this.char.isPlayer = true
    this.char.trackHands = true
    // Health + body armour; regenerates up to half after a few quiet seconds
    this.health = 100
    this.armor = 0
    this.lastHurt = -99
    this.dead = false
    this.knock = null // knocked over (blast / bike crash): ballistic tumble, then get up
    this.aiming = false
    this.listeners = {}
    this.body = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y + 0.95, spawn.z))
    this.collider = world.createCollider(R.ColliderDesc.capsule(0.55, 0.3), this.body)
    physics.tag(this.collider, { kind: 'player' })
    this.controller = world.createCharacterController(0.03)
    this.controller.enableAutostep(0.45, 0.2, true)
    this.controller.enableSnapToGround(0.45)
    this.controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180)
    this.controller.setMinSlopeSlideAngle((60 * Math.PI) / 180)
    this.controller.setApplyImpulsesToDynamicBodies(true)
    this.controller.setCharacterMass(75)
    this.vy = 0
    this.grounded = true
    this.mode = 'foot'
    this.vehicle = null
    this.heading = spawn.heading ?? 0
    this.speed = 0
    this.vel = new THREE.Vector3()
    this.pos = new THREE.Vector3(spawn.x, spawn.y, spawn.z)
    this.stepAcc = 0
    this.onStep = null
    this.stamina = 1
    this.tired = false // out of breath: no sprint until stamina recovers a bit
    this.sprinting = false
  }

  get position() {
    return this.pos
  }

  on(n, fn) {
    ;(this.listeners[n] ||= []).push(fn)
  }

  emit(n, ...a) {
    for (const fn of this.listeners[n] || []) fn(...a)
  }

  // Damage with armour soaking up two thirds. from: {x, z} for the hit-direction indicator
  damage(amount, from = null, kind = 'bullet') {
    if (this.dead || amount <= 0) return
    if (this.armor > 0) {
      const soak = Math.min(this.armor, amount * 0.66)
      this.armor -= soak
      amount -= soak
    }
    this.health = Math.max(0, this.health - amount)
    this.lastHurt = performance.now() / 1000
    this.emit('hurt', amount, from, kind)
    if (this.health <= 0) {
      this.dead = true
      this.emit('dead', kind)
    }
  }

  heal(amount) {
    this.health = Math.min(100, this.health + amount)
  }

  revive() {
    this.dead = false
    this.health = 100
    this.knock = null
    const c = this.char
    c.lie = 0
    c.tumble = 0
    c.spin = 0
    c.expr = null
  }

  // Thrown by an explosion or off a crashing bike
  knockOver(vx, vy, vz) {
    this.knock = { t: 0, vx, vy, vz, phase: 'fly' }
    this.vy = vy
  }

  updateHealth(dt) {
    const now = performance.now() / 1000
    if (!this.dead && this.health < 50 && now - this.lastHurt > 5) this.health = Math.min(50, this.health + dt * 4)
  }

  setEnabled(on) {
    this.collider.setEnabled(on)
  }

  placeAt(x, y, z, heading) {
    this.body.setTranslation({ x, y: y + 0.95, z }, true)
    this.body.setNextKinematicTranslation({ x, y: y + 0.95, z })
    this.pos.set(x, y, z)
    if (heading !== undefined) this.heading = heading
    this.vy = 0
  }

  // input: { x: -1..1 strafe (right +), y: -1..1 forward, sprint, run, jump }, camYaw = camera heading
  updateFoot(dt, input, camYaw) {
    const c = this.char
    this.updateHealth(dt)
    if (this.dead || this.knock) return this.updateDown(dt)
    // movement relative to the camera
    const len = Math.min(1, Math.hypot(input.x, input.y))
    const fx = Math.sin(camYaw), fz = Math.cos(camYaw)
    const rx = -fz, rz = fx
    let mx = fx * input.y + rx * input.x
    let mz = fz * input.y + rz * input.x
    const ml = Math.hypot(mx, mz) || 1
    mx /= ml
    mz /= ml
    // Gait + stamina: sprint drains the bar; when it's empty you can only run until it refills
    const moving = len > 0.05
    this.aiming = !!input.aim
    const wantSprint = input.sprint && moving && !this.aiming
    if (wantSprint && !this.tired) {
      this.stamina -= dt / SPRINT_TIME
      if (this.stamina <= 0) { this.stamina = 0; this.tired = true }
    } else this.stamina = Math.min(1, this.stamina + dt / (moving ? 6 : 3.5))
    if (this.tired && this.stamina > 0.35) this.tired = false
    this.sprinting = wantSprint && !this.tired
    const gait = this.aiming ? WALK * 1.1 : this.sprinting ? SPRINT : input.sprint || input.run ? RUN : WALK
    const target = moving ? gait * (input.run || input.sprint ? Math.max(len, 0.85) : len) : 0
    this.speed = damp(this.speed, target, target > this.speed ? (this.sprinting ? 5 : 8) : 12, dt)
    if (this.aiming || this.faceYaw !== undefined) {
      // aiming: face where the camera looks and strafe
      const want = this.faceYaw ?? camYaw
      this.heading += angleDelta(this.heading, want) * Math.min(1, dt * 18)
    } else if (len > 0.05) {
      const want = Math.atan2(mx, mz)
      this.heading += angleDelta(this.heading, want) * Math.min(1, dt * 12)
    }
    const strafe = this.aiming || this.faceYaw !== undefined
    const hx = strafe ? (len > 0.05 ? mx : 0) : Math.sin(this.heading), hz = strafe ? (len > 0.05 ? mz : 0) : Math.cos(this.heading)
    // gravity + jump
    if (this.grounded && input.jump) {
      this.vy = 6.2
      this.grounded = false
    }
    this.vy -= 22 * dt
    if (this.grounded && this.vy < -2) this.vy = -2
    const desired = { x: hx * this.speed * dt, y: this.vy * dt, z: hz * this.speed * dt }
    this.controller.computeColliderMovement(this.collider, desired, this.physics.RAPIER.QueryFilterFlags.EXCLUDE_SENSORS)
    const mv = this.controller.computedMovement()
    const wasGrounded = this.grounded
    const fallSpeed = this.vy
    this.grounded = this.controller.computedGrounded()
    // landing hard hurts
    if (!wasGrounded && this.grounded && fallSpeed < -15) this.damage((-fallSpeed - 15) * 7, null, 'fall')
    if (this.grounded && this.vy < 0) this.vy = -1
    const t = this.body.translation()
    const nx = t.x + mv.x, ny = t.y + mv.y, nz = t.z + mv.z
    this.body.setNextKinematicTranslation({ x: nx, y: ny, z: nz })
    this.vel.set(mv.x / dt, mv.y / dt, mv.z / dt)
    this.pos.set(nx, ny - 0.95, nz)
    // fell out of the world: back to the nearest street
    if (ny < -20) {
      const q = this.layout.queryRoad(nx, nz)
      this.placeAt(this.layout.roadX[q.i], this.layout.roadH[q.i] + 1, this.layout.roadZ[q.i])
    }

    // animate
    const actual = Math.hypot(mv.x, mv.z) / dt
    c.x = this.pos.x
    c.y = this.pos.y
    c.z = this.pos.z
    c.heading = this.heading
    c.walk = damp(c.walk, actual > 0.2 && actual < 3.6 ? 1 : actual >= 3.6 ? 0.2 : 0, 10, dt)
    c.run = damp(c.run, actual >= 3.6 ? 1 : 0, 10, dt)
    c.sprint = damp(c.sprint, this.sprinting && actual > 5.6 ? 1 : 0, 6, dt)
    // cadence: ~2.8 steps/s walking, ~3.4 running, ~4.5 sprinting
    const prevPhase = c.walkPhase
    c.walkPhase += dt * actual * (c.run > 0.5 ? 2.35 - c.sprint * 0.45 : 4.4)
    c.air = damp(c.air, this.grounded ? 0 : 1, 10, dt)
    c.drive = c.ride = c.sit = 0
    c.pitch = 0
    c.visible = true
    if (!wasGrounded && this.grounded && this.onStep) this.onStep(1)
    // footsteps
    if (this.grounded && actual > 0.4) {
      if (Math.floor(c.walkPhase / Math.PI) !== Math.floor(prevPhase / Math.PI) && this.onStep) this.onStep(c.sprint > 0.5 ? 1 : c.run > 0.5 ? 0.8 : 0.45)
    }
  }

  // Knocked over or out cold: ballistic tumble with the character controller, then lie / get up
  updateDown(dt) {
    const c = this.char
    const k = this.knock
    let mvx = 0, mvz = 0
    if (k && k.phase === 'fly') {
      k.t += dt
      mvx = k.vx
      mvz = k.vz
      c.tumble = 1
      c.spin += dt * 9
      k.vx *= 1 - Math.min(1, dt * 0.6)
      k.vz *= 1 - Math.min(1, dt * 0.6)
    } else {
      c.tumble = 0
      c.spin = 0
    }
    this.vy -= 22 * dt
    if (this.grounded && this.vy < -2) this.vy = -2
    this.controller.computeColliderMovement(this.collider, { x: mvx * dt, y: this.vy * dt, z: mvz * dt }, this.physics.RAPIER.QueryFilterFlags.EXCLUDE_SENSORS)
    const mv = this.controller.computedMovement()
    this.grounded = this.controller.computedGrounded()
    if (this.grounded && this.vy < 0) this.vy = -1
    const t = this.body.translation()
    this.body.setNextKinematicTranslation({ x: t.x + mv.x, y: t.y + mv.y, z: t.z + mv.z })
    this.pos.set(t.x + mv.x, t.y + mv.y - 0.95, t.z + mv.z)
    this.vel.set(mv.x / dt, mv.y / dt, mv.z / dt)
    this.speed = 0
    if (k) {
      if (k.phase === 'fly' && k.t > 0.25 && this.grounded) { k.phase = 'lie'; k.t = 0 }
      else if (k.phase === 'lie') {
        k.t += dt
        c.lie = Math.min(1, k.t * 4)
        if (k.t > 1.4 && !this.dead) { k.phase = 'up'; k.t = 0 }
      } else if (k.phase === 'up') {
        k.t += dt
        c.lie = Math.max(0, 1 - k.t / 0.6)
        if (k.t > 0.6) { this.knock = null; c.lie = 0 }
      }
    } else if (this.dead) c.lie = Math.min(1, (c.lie || 0) + dt * 2.5)
    c.x = this.pos.x
    c.y = this.pos.y
    c.z = this.pos.z
    c.heading = this.heading
    c.walk = c.run = c.sprint = 0
    c.drive = c.ride = c.sit = 0
    c.visible = true
  }

  // Seat the character in a vehicle (pose follows the vehicle each frame)
  updateSeated(vehicleObj, dt) {
    const c = this.char
    const g = vehicleObj.visual.group
    const holder = vehicleObj.visual.lean || g
    g.updateMatrixWorld(true)
    const seat = holder.localToWorld(vehicleObj.seat.clone())
    c.x = seat.x
    c.y = seat.y - (vehicleObj.type === 'bike' ? 0.62 : 0.5)
    this.updateHealth(dt)
    c.z = seat.z
    const e = new THREE.Euler().setFromQuaternion(g.quaternion, 'YXZ')
    c.heading = e.y
    c.walk = c.run = c.air = 0
    c.drive = vehicleObj.type === 'bike' ? 0 : 1
    c.ride = vehicleObj.type === 'bike' ? 1 : 0
    c.lean = vehicleObj.type === 'bike' ? vehicleObj.visual.leanAngle : 0
    c.pitch = vehicleObj.type === 'bike' ? -(vehicleObj.phys.wheelie || 0) : 0
    c.steer = clamp((vehicleObj.phys.steer || 0) * 2, -1, 1)
    c.visible = vehicleObj.type !== 'tank' // the tank crew sits inside the hull
    this.pos.set(c.x, c.y, c.z)
  }

  // Find a free spot beside a vehicle to step out
  exitSpot(vehicleObj) {
    const g = vehicleObj.visual.group
    const side = new THREE.Vector3(1, 0, 0).applyQuaternion(g.quaternion).setY(0).normalize()
    for (const s of [vehicleObj.exitSide, -vehicleObj.exitSide, 0]) {
      const off = s === 0 ? new THREE.Vector3(0, 0, -1).applyQuaternion(g.quaternion).setY(0).normalize().multiplyScalar(vehicleObj.length * 0.6 + 1) : side.clone().multiplyScalar(s * vehicleObj.width)
      const x = g.position.x + off.x, z = g.position.z + off.z
      const y = this.layout.getDriveHeight(x, z)
      const shape = new this.physics.RAPIER.Capsule(0.5, 0.3)
      const hit = this.physics.world.intersectionWithShape({ x, y: y + 1.0, z }, { x: 0, y: 0, z: 0, w: 1 }, shape, undefined, undefined, this.collider)
      if (!hit) return { x, y: Math.max(y, g.position.y - 0.4), z }
    }
    return { x: g.position.x, y: g.position.y + 2.5, z: g.position.z }
  }
}
