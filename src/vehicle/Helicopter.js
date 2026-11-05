// Flyable helicopter: ignition start/stop with rotor spin-up and spin-down, collective
// lift with altitude-hold assist, attitude control (pitch / bank / yaw), coordinated
// turns, quadratic drag, skids that land anywhere. Plus the visual model.
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { U } from '../world/Uniforms.js'
import { clamp, damp } from '../core/math.js'

const _q = new THREE.Quaternion()
const _v = new THREE.Vector3()
const _w = new THREE.Vector3()

export class HeliPhysics {
  constructor(physics, spawn) {
    this.physics = physics
    this.kind = 'heli'
    const R = physics.RAPIER
    const world = physics.world
    this.mass = 1400
    this.body = world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(spawn.x, spawn.y + 0.3, spawn.z)
        .setRotation(_q.setFromAxisAngle(_v.set(0, 1, 0), spawn.heading ?? 0).clone())
        .setCanSleep(false)
        .setLinearDamping(0.05)
        .setAngularDamping(1.2)
        .setAdditionalMassProperties(this.mass, { x: 0, y: 0.9, z: -0.2 }, { x: 2600, y: 2400, z: 1400 }, { x: 0, y: 0, z: 0, w: 1 }),
    )
    const tag = { kind: 'car' }
    const col = (desc) => physics.tag(world.createCollider(desc.setDensity(0).setFriction(0.8).setRestitution(0.05)
      .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(9000), this.body), tag)
    col(R.ColliderDesc.cuboid(0.85, 0.72, 1.55).setTranslation(0, 1.25, 0.2))
    col(R.ColliderDesc.cuboid(0.16, 0.2, 2.3).setTranslation(0, 1.45, -3.4))
    for (const sx of [-0.85, 0.85]) col(R.ColliderDesc.cuboid(0.07, 0.06, 1.55).setTranslation(sx, 0.06, 0.15))
    this.state = 'off' // off | starting | running | stopping
    this.rotor = 0
    this.occupied = false
    this.altitude = 0
    this.grounded = true
    this.speed = 0
    this.throttle = 0
    this.rpm = 0
    this.gear = 0
    this.boosting = false
    this.braking = 0
    this.handbrake = false
    this.slip = [0, 0, 0, 0]
    this.wheelSurface = []
    this.landing = 0
    this.inWater = 0
    this.flippedTime = 0
    this.lift = 0
  }

  get position() {
    return this.body.translation()
  }

  basis() {
    const r = this.body.rotation()
    _q.set(r.x, r.y, r.z, r.w)
    return {
      quat: _q,
      fwd: new THREE.Vector3(0, 0, 1).applyQuaternion(_q),
      up: new THREE.Vector3(0, 1, 0).applyQuaternion(_q),
      right: new THREE.Vector3(-1, 0, 0).applyQuaternion(_q),
    }
  }

  // Toggle the engine: off/stopping -> starting, running/starting -> stopping
  ignition() {
    if (this.state === 'off' || this.state === 'stopping') this.state = 'starting'
    else this.state = 'stopping'
    return this.state
  }

  get ready() {
    return this.state === 'running' && this.rotor > 0.98
  }

  reset(frame) {
    this.body.setTranslation({ x: frame.x, y: frame.y + 0.4, z: frame.z }, true)
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    this.body.setRotation(_q.setFromAxisAngle(_v.set(0, 1, 0), frame.heading).clone(), true)
  }

  wheelState() {
    return { suspension: 0, rotation: 0, steering: 0, contact: this.grounded, point: null }
  }

  // input: { collective -1..1, pitch -1..1 (W = +1 nose down), bank -1..1, yaw -1..1 (A = +1 left) }
  update(dt, input, env = {}) {
    // Engine / rotor
    if (this.state === 'starting') {
      this.rotor = Math.min(1, this.rotor + dt / 5)
      if (this.rotor >= 1) this.state = 'running'
    } else if (this.state === 'stopping') {
      this.rotor = Math.max(0, this.rotor - dt / 7)
      if (this.rotor <= 0) this.state = 'off'
    }
    this.rpm = this.rotor
    if (!this.occupied) input = { collective: -1, pitch: 0, bank: 0, yaw: 0 }

    const b = this.body
    const p = b.translation()
    const lv = b.linvel()
    const av = b.angvel()
    const { fwd, up, right, quat } = this.basis()
    const g = 9.81

    // Altitude above whatever is below (terrain, roofs, roads)
    const ray = new this.physics.RAPIER.Ray({ x: p.x, y: p.y + 0.5, z: p.z }, { x: 0, y: -1, z: 0 })
    const hit = this.physics.world.castRay(ray, 300, true, undefined, undefined, undefined, b)
    this.altitude = hit ? hit.timeOfImpact - 0.5 : 300
    this.grounded = this.altitude < 0.3 && Math.abs(lv.y) < 1.5
    this.speed = Math.hypot(lv.x, lv.z)

    // Collective with altitude hold: input sets a climb rate, the governor holds it
    const power = this.rotor * this.rotor
    let climb = input.collective * 7
    if (this.grounded && input.collective <= 0.05) climb = -1.5
    const acc = clamp(g + (climb - lv.y) * 2.4, 0, g * 2.3) * power
    const thrust = (acc * this.mass) / Math.max(up.y, 0.55)
    this.lift = acc / g
    b.applyImpulse({ x: up.x * thrust * dt, y: up.y * thrust * dt, z: up.z * thrust * dt }, true)

    // Attitude control (needs rotor authority, eased off on the ground)
    const authority = clamp((this.rotor - 0.5) * 2, 0, 1) * (this.grounded && input.collective <= 0.05 ? 0.15 : 1)
    const pitchAngle = Math.asin(clamp(fwd.y, -1, 1))
    const bank = -Math.asin(clamp(right.y, -1, 1))
    const targetPitch = -0.42 * input.pitch
    const targetBank = 0.38 * input.bank - 0.15 * input.yaw * clamp(this.speed / 20, 0, 1)
    const wx = -(targetPitch - pitchAngle) * 3.2
    const wz = (targetBank - bank) * 3.2
    const yaw = input.yaw * 1.25 - bank * 0.9 * clamp(this.speed / 15, 0, 1)
    _w.set(wx, 0, wz).applyQuaternion(quat)
    _w.y += yaw
    const k = Math.min(1, 5 * dt) * authority
    b.setAngvel({ x: av.x + (_w.x - av.x) * k, y: av.y + (_w.y - av.y) * k, z: av.z + (_w.z - av.z) * k }, true)

    // Aerodynamic drag (quadratic + a little linear)
    const sp = Math.hypot(lv.x, lv.y, lv.z)
    if (sp > 0.1) {
      const d = (0.0016 * sp * sp + 0.06 * sp) * dt * this.mass
      b.applyImpulse({ x: (-lv.x / sp) * d, y: (-lv.y / sp) * d * 0.6, z: (-lv.z / sp) * d }, true)
    }
    this.throttle = clamp((input.collective + 1) * 0.5, 0, 1) * this.rotor
    this.flippedTime = up.y < 0.3 && this.grounded ? this.flippedTime + dt : 0
    void env
    void right
  }
}

export class HeliVisual {
  constructor(scene, hp) {
    this.hp = hp
    this.group = new THREE.Group()
    scene.add(this.group)
    const paint = new THREE.MeshPhysicalMaterial({ color: 0xf2b33d, roughness: 0.32, metalness: 0.15, clearcoat: 0.7 })
    const white = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.4 })
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.5, metalness: 0.3 })
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x86b8c8, roughness: 0.05, transparent: true, opacity: 0.45 })
    const add = (geo, mat, x, y, z, parent = this.group, shadow = true) => {
      const m = new THREE.Mesh(geo, mat)
      m.position.set(x, y, z)
      m.castShadow = shadow
      parent.add(m)
      return m
    }
    add(new RoundedBoxGeometry(1.7, 1.45, 3.0, 4, 0.55), paint, 0, 1.3, 0.1)
    add(new RoundedBoxGeometry(1.74, 0.3, 2.9, 2, 0.12), white, 0, 0.72, 0.1)
    add(new THREE.SphereGeometry(0.9, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2).scale(0.95, 0.85, 1.1).translate(0, 1.38, 1.45), glass, 0, 0, 0, this.group, false)
    add(new THREE.CylinderGeometry(0.16, 0.32, 4.2, 12).rotateX(Math.PI / 2), paint, 0, 1.45, -3.0)
    add(new THREE.BoxGeometry(0.08, 1.1, 0.7), paint, 0, 1.95, -4.95).rotation.x = -0.3
    add(new THREE.BoxGeometry(1.5, 0.06, 0.45), white, 0, 1.45, -4.3)
    add(new THREE.CylinderGeometry(0.1, 0.12, 0.45, 10), dark, 0, 2.18, 0.0)
    add(new RoundedBoxGeometry(0.9, 0.35, 1.2, 2, 0.12), paint, 0, 2.05, -0.4)
    // skids
    for (const sx of [-0.85, 0.85]) {
      add(new THREE.CylinderGeometry(0.05, 0.05, 3.2, 8).rotateX(Math.PI / 2), dark, sx, 0.06, 0.15)
      for (const z of [-0.6, 0.9]) {
        const s = add(new THREE.CylinderGeometry(0.035, 0.035, 0.7, 6), dark, sx * 0.8, 0.4, z)
        s.rotation.z = sx > 0 ? 0.3 : -0.3
      }
    }
    // main rotor: blades + blur disc
    this.mainRotor = new THREE.Group()
    this.mainRotor.position.set(0, 2.42, 0)
    this.group.add(this.mainRotor)
    this.bladeMat = new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.5, transparent: true })
    for (let i = 0; i < 4; i++) {
      const bl = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.04, 4.6).translate(0, 0, 2.35), this.bladeMat)
      bl.rotation.y = (i / 4) * Math.PI * 2
      bl.castShadow = true
      this.mainRotor.add(bl)
    }
    this.mainRotor.add(new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.16, 12), dark))
    this.discMat = new THREE.MeshBasicMaterial({ color: 0x2a2f36, transparent: true, opacity: 0, depthWrite: false })
    this.disc = add(new THREE.CircleGeometry(4.8, 40).rotateX(-Math.PI / 2), this.discMat, 0, 2.43, 0, this.group, false)
    // tail rotor
    this.tailRotor = new THREE.Group()
    this.tailRotor.position.set(0.12, 1.95, -5.0)
    this.group.add(this.tailRotor)
    for (let i = 0; i < 2; i++) {
      const tb = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.1, 0.12), dark)
      tb.rotation.x = (i * Math.PI) / 2
      this.tailRotor.add(tb)
    }
    // lights
    const light = (color, x, y, z) => add(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color }), x, y, z, this.group, false)
    light(new THREE.Color(4, 0.3, 0.2), -0.85, 1.1, 0.3)
    light(new THREE.Color(0.3, 4, 0.6), 0.85, 1.1, 0.3)
    this.beacon = light(new THREE.Color(5, 0.5, 0.2), 0, 2.28, -0.9)
    this.strobe = light(new THREE.Color(6, 6, 6), 0, 2.5, -5.25)
    this.landingLight = new THREE.SpotLight(0xfff1d8, 0, 60, 0.45, 0.6, 1.2)
    this.landingLight.position.set(0, 0.6, 1.4)
    this.landingLight.target.position.set(0, -6, 8)
    this.group.add(this.landingLight, this.landingLight.target)
    this.seat = new THREE.Vector3(0.38, 0.95, 0.75)
    this.angle = 0
  }

  update(dt, pos, quat, t) {
    this.group.position.copy(pos)
    this.group.quaternion.copy(quat)
    const r = this.hp.rotor
    this.angle += r * 44 * dt
    this.mainRotor.rotation.y = this.angle
    this.tailRotor.rotation.x = this.angle * 2.2
    this.bladeMat.opacity = 1 - clamp((r - 0.35) * 1.4, 0, 0.85)
    this.discMat.opacity = clamp((r - 0.3) * 0.5, 0, 0.32)
    this.disc.visible = r > 0.3
    this.beacon.visible = this.hp.state !== 'off' && (t % 1.2) < 0.15
    this.strobe.visible = this.hp.state !== 'off' && (t % 1.5) < 0.06
    this.landingLight.intensity = this.hp.state === 'off' ? 0 : U.uNight.value * 120
    void damp
  }
}
