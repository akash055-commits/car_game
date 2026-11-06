// Raycast-vehicle physics with suspension, tyre grip, a 5-speed gearbox and drift handbrake.
// Pure simulation (no rendering) so it can be tuned headlessly.
import * as THREE from 'three'
import { clamp, damp, lerp, smoothstep } from '../core/math.js'

// Tunables per vehicle type. The car is the default; the motorbike overrides a few.
export const CAR = {
  kind: 'car', mass: 1000, com: { x: 0, y: -0.28, z: 0.05 }, inertia: { x: 1150, y: 1300, z: 520 },
  wheelRadius: 0.42, restLength: 0.38,
  wheels: [
    { x: 0.86, y: 0.0, z: 1.18, front: true }, { x: -0.86, y: 0.0, z: 1.18, front: true },
    { x: 0.86, y: 0.0, z: -1.12, front: false }, { x: -0.86, y: 0.0, z: -1.12, front: false },
  ],
  chassis: { hx: 0.92, hy: 0.3, hz: 1.78, y: 0.18 }, cabin: { hx: 0.72, hy: 0.32, hz: 0.95, y: 0.78, z: -0.25 },
  gears: [42, 24, 15.5, 11.0, 8.0], reverse: 40, idle: 900, redline: 6900, upRpm: 6300, downRpm: 2600,
  torque: 132, drag: 0.3, rolling: 80, brake: 78, steerLow: 0.62, steerHigh: 0.14, steerFade: 34,
  friction: { front: 2.3, rear: 2.2 }, stiffness: 34, frontShare: 0.35, balance: false, yawAssist: 3.2, downforce: 1.6,
  // top speed ~140 km/h, ~190 km/h on nitro. Nitro: seconds of burn, seconds to refill, force x, push m/s^2
  vmax: 39, vmaxNitro: 53, nitroTime: 6, nitroRecharge: 16, nitroForce: 2.1, nitroPush: 3.2,
  health: 1000, sound: 'car',
}
export const BIKE = {
  ...CAR,
  kind: 'bike', mass: 260, com: { x: 0, y: -0.3, z: 0 }, inertia: { x: 90, y: 95, z: 40 },
  wheelRadius: 0.33, restLength: 0.3,
  wheels: [
    { x: 0.17, y: 0.0, z: 0.74, front: true }, { x: -0.17, y: 0.0, z: 0.74, front: true },
    { x: 0.17, y: 0.0, z: -0.72, front: false }, { x: -0.17, y: 0.0, z: -0.72, front: false },
  ],
  chassis: { hx: 0.24, hy: 0.28, hz: 0.95, y: 0.22 }, cabin: null,
  gears: [28, 19.5, 14.8, 11.8, 9.6, 8.05], reverse: 0, idle: 1300, redline: 11000, upRpm: 10200, downRpm: 4800,
  torque: 48, drag: 0.2, rolling: 30, brake: 24, steerLow: 0.55, steerHigh: 0.1, steerFade: 36,
  friction: { front: 2.4, rear: 2.3 }, stiffness: 42, frontShare: 0, balance: true, yawAssist: 3.6, downforce: 0.6,
  // top speed ~170 km/h, ~230 km/h on nitro
  vmax: 47.5, vmaxNitro: 64, nitroTime: 5, nitroRecharge: 14, nitroForce: 2.3, nitroPush: 4.2,
  health: 600, sound: 'bike',
}

const _q = new THREE.Quaternion()
const _v = new THREE.Vector3()
const _fwd = new THREE.Vector3()
const _up = new THREE.Vector3()
const _right = new THREE.Vector3()

export class VehiclePhysics {
  constructor(physics, spawn, cfg = CAR) {
    this.physics = physics
    this.cfg = cfg
    this.kind = cfg.kind
    const R = physics.RAPIER
    const world = physics.world

    this.mass = cfg.mass
    this.wheelRadius = cfg.wheelRadius
    this.restLength = cfg.restLength
    this.wheelPositions = cfg.wheels.map((w) => ({ ...w }))
    this.nWheels = this.wheelPositions.length

    const bodyDesc = R.RigidBodyDesc.dynamic()
      .setTranslation(spawn.x, spawn.y + 1.2, spawn.z)
      .setCanSleep(false)
      .setLinearDamping(0.02)
      .setAngularDamping(0.35)
      .setCcdEnabled(true)
      // Full mass is specified explicitly with a low centre of mass for stability
      .setAdditionalMassProperties(this.mass, cfg.com, cfg.inertia, { x: 0, y: 0, z: 0, w: 1 })
    this.body = world.createRigidBody(bodyDesc)
    this.setHeading(spawn.heading)

    const ch = cfg.chassis
    const chassis = R.ColliderDesc.cuboid(ch.hx, ch.hy, ch.hz)
      .setTranslation(0, ch.y, 0)
      .setDensity(0)
      .setFriction(0.4)
      .setRestitution(0.15)
      .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS | R.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(2500)
    this.collider = world.createCollider(chassis, this.body)
    physics.tag(this.collider, { kind: 'car' })

    if (cfg.cabin) {
      const cb = cfg.cabin
      const cabin = R.ColliderDesc.cuboid(cb.hx, cb.hy, cb.hz)
        .setTranslation(0, cb.y, cb.z)
        .setDensity(0)
        .setFriction(0.3)
        .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(2500)
      this.cabinCollider = world.createCollider(cabin, this.body)
      physics.tag(this.cabinCollider, { kind: 'car' })
    }

    this.controller = world.createVehicleController(this.body)
    this.controller.indexUpAxis = 1
    this.controller.setIndexForwardAxis = 2
    for (const w of this.wheelPositions) {
      this.controller.addWheel({ x: w.x, y: w.y, z: w.z }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, this.restLength, this.wheelRadius)
    }
    this.baseFriction = { ...cfg.friction }
    for (let i = 0; i < this.nWheels; i++) {
      this.controller.setWheelSuspensionStiffness(i, cfg.stiffness)
      this.controller.setWheelSuspensionCompression(i, 3.2)
      this.controller.setWheelSuspensionRelaxation(i, 2.6)
      this.controller.setWheelMaxSuspensionTravel(i, 0.3)
      this.controller.setWheelMaxSuspensionForce(i, cfg.maxSuspensionForce || 60000)
      this.controller.setWheelFrictionSlip(i, this.wheelPositions[i].front ? this.baseFriction.front : this.baseFriction.rear)
      this.controller.setWheelSideFrictionStiffness(i, 1.0)
    }

    // Drivetrain state
    this.gear = 1 // 1..5, -1 reverse
    this.rpm = cfg.idle
    this.shiftTimer = 0
    this.engineOn = true
    this.occupied = false
    this.lastShift = 0 // +1 up / -1 down, consumed by audio
    this.throttle = 0
    this.braking = 0
    this.steer = 0
    this.speed = 0 // signed forward m/s
    this.boosting = false
    this.handbrake = false
    this.grounded = 0 // wheels in contact
    this.airTime = 0
    this.landing = 0 // impact strength on landing (consumed by fx)
    this.slip = new Array(this.nWheels).fill(0)
    this.sideSlip = new Array(this.nWheels).fill(0) // lateral-only slip (drives the tyre squeal)
    this.wheelSurface = new Array(this.nWheels).fill('dirt')
    // Nitro tank (0..1). Empty -> locked until you let go of the button.
    this.nitro = 1
    this.nitroLock = false
    this.wheelie = 0
    // Damage
    this.maxHealth = cfg.health || 1000
    this.health = this.maxHealth
    this.gripScale = 1
    this.inWater = 0
    this.flippedTime = 0
    this.load = 0
  }

  setHeading(heading) {
    _q.setFromAxisAngle(_v.set(0, 1, 0), heading)
    this.body.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }, true)
  }

  reset(frame) {
    this.body.setTranslation({ x: frame.x, y: frame.y + 1.0, z: frame.z }, true)
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    this.setHeading(frame.heading)
    this.gear = 1
    this.rpm = this.cfg.idle
    this.flippedTime = 0
    this.inWater = 0
  }

  repair() {
    this.health = this.maxHealth
  }

  get position() {
    return this.body.translation()
  }

  basis() {
    const r = this.body.rotation()
    _q.set(r.x, r.y, r.z, r.w)
    _fwd.set(0, 0, 1).applyQuaternion(_q)
    _up.set(0, 1, 0).applyQuaternion(_q)
    _right.set(-1, 0, 0).applyQuaternion(_q)
    return { fwd: _fwd, up: _up, right: _right, quat: _q }
  }

  wheelRatio() {
    return this.gear === -1 ? (this.cfg.reverse || this.cfg.gears[0] * 0.9) : this.cfg.gears[this.gear - 1]
  }

  // Engine torque curve (Nm) – broad mid-range, falls off near redline
  torque(rpm) {
    const x = clamp(rpm / this.cfg.redline, 0, 1.1)
    return this.cfg.torque * (0.55 + 1.2 * x - 1.0 * x * x) + this.cfg.torque * 0.085
  }

  update(dt, input, env = {}) {
    const c = this.controller
    const cfg = this.cfg
    if (!this.occupied) input = { throttle: 0, brake: 0, steer: 0, handbrake: true, boost: false }
    const { fwd, up } = this.basis()
    const lv = this.body.linvel()
    const forwardSpeed = lv.x * fwd.x + lv.y * fwd.y + lv.z * fwd.z
    this.speed = forwardSpeed
    const absSpeed = Math.abs(forwardSpeed)

    // ---- intent -> throttle / brake / reverse
    let throttle = 0, brake = 0
    const wantForward = input.throttle > 0.05
    const wantBack = input.brake > 0.05
    if (wantForward) {
      if (forwardSpeed < -1.0) brake = input.throttle
      else {
        throttle = input.throttle
        if (this.gear === -1) this.gear = 1
      }
    }
    if (wantBack) {
      if (forwardSpeed > 1.0) brake = Math.max(brake, input.brake)
      else {
        throttle = input.brake
        this.gear = -1
      }
    }
    this.throttle = damp(this.throttle, throttle, 10, dt)
    this.braking = brake
    this.handbrake = input.handbrake
    // ---- nitro: burns while held, refills slowly; an empty tank locks until released
    const wantNitro = input.boost && throttle > 0 && this.gear > 0
    if (!input.boost) this.nitroLock = false
    this.boosting = wantNitro && !this.nitroLock && this.nitro > 0 && !!cfg.nitroTime
    if (this.boosting) {
      this.nitro = Math.max(0, this.nitro - dt / cfg.nitroTime)
      if (this.nitro <= 0) this.nitroLock = true
    } else if (cfg.nitroRecharge) this.nitro = Math.min(1, this.nitro + dt / cfg.nitroRecharge)

    // ---- gearbox
    const wheelRpm = (absSpeed / (2 * Math.PI * this.wheelRadius)) * 60
    this.shiftTimer = Math.max(0, this.shiftTimer - dt)
    if (this.gear > 0 && this.shiftTimer === 0) {
      const rpmNow = wheelRpm * cfg.gears[this.gear - 1]
      if (rpmNow > cfg.upRpm && this.gear < cfg.gears.length && this.throttle > 0.3) {
        this.gear++
        this.shiftTimer = 0.22
        this.lastShift = 1
      } else if (rpmNow < cfg.downRpm && this.gear > 1) {
        this.gear--
        this.shiftTimer = 0.15
        this.lastShift = -1
      }
    }
    const ratio = this.wheelRatio()
    // Clutch slip at low speed lets the engine rev above wheel speed
    const coupled = wheelRpm * ratio
    const slipRpm = cfg.idle + this.throttle * (cfg.slipRpm || 2600)
    let targetRpm = Math.max(coupled, lerp(cfg.idle, slipRpm, smoothstep(12, 0, coupled / 100)))
    if (this.grounded === 0) targetRpm = cfg.idle + this.throttle * (cfg.redline - cfg.idle) // free revving in the air
    if (this.shiftTimer > 0) targetRpm = Math.min(targetRpm, this.rpm)
    targetRpm = Math.min(targetRpm, cfg.redline + (this.boosting ? 400 : 0))
    this.rpm = damp(this.rpm, targetRpm, this.shiftTimer > 0 ? 6 : 14, dt)

    // ---- engine force
    let engineForce = 0
    if (this.shiftTimer === 0 && this.throttle > 0) {
      const limiter = this.rpm >= cfg.redline - 30 && !this.boosting ? 0.15 : 1
      engineForce = (this.torque(this.rpm) * ratio * 0.88 * this.throttle * limiter) / this.wheelRadius
      if (this.boosting) engineForce *= cfg.nitroForce || 1.55
      if (this.gear === -1) engineForce = absSpeed > (cfg.kind === 'bike' ? 2.2 : 7) ? 0 : -engineForce
      // top-speed governor (higher while the nitro burns)
      const cap = this.boosting ? cfg.vmaxNitro || 60 : cfg.vmax || 60
      if (this.gear > 0) engineForce *= clamp((cap - forwardSpeed) / 3, 0, 1)
    }
    // Nitro shove straight along the chassis (only with wheels on the ground)
    if (this.boosting && this.grounded > 0 && forwardSpeed < (cfg.vmaxNitro || 60)) {
      const k = (cfg.nitroPush || 0) * cfg.mass * dt
      this.body.applyImpulse({ x: fwd.x * k, y: 0, z: fwd.z * k }, true)
    }
    // Bike: the front wheel lifts on a nitro launch (visual only)
    this.wheelie = damp(this.wheelie, cfg.kind === 'bike' && this.boosting && absSpeed < 22 && this.grounded > 0 ? 0.32 * (1 - absSpeed / 22) + 0.06 : 0, 4, dt)
    this.load = clamp(Math.abs(engineForce) / 9000, 0, 1)

    // Resistance (aero drag + rolling) acts on the body: Rapier ignores a wheel's
    // brake whenever that wheel also has engine force, so keep the two separate.
    if (absSpeed > 0.3) {
      const planar = Math.hypot(lv.x, lv.z)
      const drag = (cfg.drag * planar * planar + cfg.rolling) * dt
      const k = drag / Math.max(planar, 1e-3)
      this.body.applyImpulse({ x: -lv.x * k, y: 0, z: -lv.z * k }, true)
    }
    if (brake > 0) engineForce = 0

    // Rear-biased all-wheel drive (rear wheels uncoupled while the handbrake is on).
    // Tracked vehicles drive every wheel and steer by splitting force left / right.
    if (cfg.skidSteer) {
      const per = engineForce / this.nWheels
      for (let i = 0; i < this.nWheels; i++) {
        const left = this.wheelPositions[i].x > 0
        const turn = input.steer * cfg.skidSteer * (left ? -1 : 1)
        c.setWheelEngineForce(i, per + turn)
      }
    } else {
      const nFront = this.wheelPositions.filter((w) => w.front).length || 1
      const nRear = this.nWheels - nFront || 1
      for (let i = 0; i < this.nWheels; i++) {
        const front = this.wheelPositions[i].front
        const share = front ? cfg.frontShare / nFront : (1 - cfg.frontShare) / nRear
        c.setWheelEngineForce(i, input.handbrake && !front ? 0 : engineForce * share)
      }
    }

    // ---- brakes
    const idle = !wantForward && !wantBack && absSpeed < 2.5 ? 6 : 0
    const brakeImpulse = brake * cfg.brake + idle * (cfg.mass / 1000)
    for (let i = 0; i < this.nWheels; i++) {
      const front = this.wheelPositions[i].front
      let b = brakeImpulse * (front ? 0.6 : 0.4) * (4 / this.nWheels)
      if (this.handbrake && !front) b = Math.max(b, 30 * (cfg.mass / 1000))
      c.setWheelBrake(i, b)
    }

    // ---- steering (speed sensitive, smoothed)
    const maxSteer = lerp(cfg.steerLow, cfg.steerHigh, smoothstep(0, cfg.steerFade, absSpeed))
    const targetSteer = input.steer * maxSteer
    const steerRate = Math.abs(targetSteer) < Math.abs(this.steer) ? 10 : 6
    this.steer = damp(this.steer, targetSteer, steerRate, dt)
    if (!cfg.skidSteer) {
      for (let i = 0; i < this.nWheels; i++) if (this.wheelPositions[i].front) c.setWheelSteering(i, this.steer)
    }

    // ---- grip (surface, weather, handbrake drift)
    const wet = env.wet ?? 0
    for (let i = 0; i < this.nWheels; i++) {
      const front = this.wheelPositions[i].front
      const surface = this.wheelSurface[i]
      let grip = front ? this.baseFriction.front : this.baseFriction.rear
      if (surface === 'dirt') grip *= 0.82
      else if (surface === 'wood') grip *= 0.92
      grip *= 1 - wet * 0.22
      if (!front && this.handbrake) grip *= 0.6
      c.setWheelFrictionSlip(i, grip)
      c.setWheelSideFrictionStiffness(i, cfg.sideFriction ?? (!front && this.handbrake ? 0.75 : 1))
    }

    c.updateVehicle(dt)

    // ---- post-update telemetry
    let grounded = 0
    for (let i = 0; i < this.nWheels; i++) {
      if (c.wheelIsInContact(i)) grounded++
      const side = Math.abs(c.wheelSideImpulse(i) || 0)
      const fwdImp = Math.abs(c.wheelForwardImpulse(i) || 0)
      this.slip[i] = c.wheelIsInContact(i) ? clamp(side / 70 + (this.handbrake && !this.wheelPositions[i].front ? absSpeed / 25 : 0) + (fwdImp > 80 ? 0.4 : 0), 0, 1) : 0
      this.sideSlip[i] = c.wheelIsInContact(i) ? clamp(side / 70 + (this.handbrake && !this.wheelPositions[i].front ? absSpeed / 30 : 0), 0, 1) : 0
    }
    if (grounded === 0) this.airTime += dt
    else {
      if (this.airTime > 0.35) this.landing = clamp(this.airTime * 0.8 + Math.abs(lv.y) * 0.08, 0, 1)
      this.airTime = 0
    }
    this.grounded = grounded

    // Stability assist: damp excess yaw so slides stay catchable (eased off while drifting)
    if (cfg.skidSteer && grounded >= 2) {
      // Tracks: pivot turns at a commanded yaw rate (also on the spot)
      const av = this.body.angvel()
      const dir = forwardSpeed < -0.5 ? -1 : 1
      const want = input.steer * (cfg.turnRate || 0.8) * dir * (1 - smoothstep(4, 14, absSpeed) * 0.45)
      const ny = av.y + (want - av.y) * Math.min(1, 14 * dt)
      this.body.setAngvel({ x: av.x * (1 - Math.min(1, 3 * dt)), y: ny, z: av.z * (1 - Math.min(1, 3 * dt)) }, true)
      // tracks don't slide sideways much
      const lv2 = this.body.linvel()
      const { right } = this.basis()
      const side = lv2.x * right.x + lv2.z * right.z
      const k = Math.min(1, 5 * dt)
      this.body.setLinvel({ x: lv2.x - right.x * side * k, y: lv2.y, z: lv2.z - right.z * side * k }, true)
    } else if (grounded >= 3) {
      const av = this.body.angvel()
      const expected = (this.steer * forwardSpeed) / 2.3
      const assist = this.handbrake ? 0.8 : cfg.yawAssist
      const ny = av.y + (expected - av.y) * Math.min(1, assist * dt) * smoothstep(2, 8, absSpeed)
      this.body.setAngvel({ x: av.x, y: ny, z: av.z }, true)
    }

    // Downforce keeps the car planted at speed
    const down = cfg.downforce * absSpeed * absSpeed * (grounded > 0 ? 1 : 0.2) * (cfg.mass / 1000)
    this.body.applyImpulse({ x: -up.x * down * dt, y: -up.y * down * dt, z: -up.z * down * dt }, true)

    // Light air control: level out and allow a little yaw so jumps feel controllable
    if (grounded === 0) {
      const av = this.body.angvel()
      const k = 0.6 * dt
      this.body.setAngvel({ x: av.x * (1 - k), y: av.y + input.steer * 1.2 * dt, z: av.z * (1 - k) }, true)
    }

    // Water: drag + buoyancy, respawn handled by game
    const p = this.body.translation()
    const waterDepth = (env.waterLevel ?? -100) - p.y + 0.3
    if (waterDepth > 0 && env.overWater) {
      this.inWater += dt
      const v = this.body.linvel()
      const k = Math.min(1, 2.5 * dt)
      this.body.setLinvel({ x: v.x * (1 - k), y: v.y * (1 - k) + Math.min(waterDepth, 1) * 14 * dt, z: v.z * (1 - k) }, true)
    } else this.inWater = Math.max(0, this.inWater - dt)

    // Motorbike balance assist: the physics body stays upright, the visual leans
    if (cfg.balance) {
      const av = this.body.angvel()
      const errX = -up.z, errZ = up.x // axis (up × worldUp) that rotates up back to vertical
      const k = 30 * dt, damp2 = Math.min(1, 6 * dt)
      const fx = fwd.x, fz = fwd.z
      const rollErr = errX * fx + errZ * fz
      const rollRate = av.x * fx + av.z * fz
      const corr = (rollErr * 30 - rollRate * 6) * dt
      this.body.setAngvel({ x: av.x + fx * corr, y: av.y, z: av.z + fz * corr }, true)
      void k
      void damp2
    }

    // Flip detection
    if (up.y < 0.35 && absSpeed < 3) this.flippedTime += dt
    else this.flippedTime = 0
  }

  // Wheel state for visuals: suspension length, rotation, steering
  wheelState(i) {
    const c = this.controller
    return {
      suspension: c.wheelSuspensionLength(i) ?? this.restLength,
      rotation: c.wheelRotation(i) ?? 0,
      steering: c.wheelSteering(i) ?? 0,
      contact: c.wheelIsInContact(i),
      point: c.wheelContactPoint(i),
    }
  }
}
