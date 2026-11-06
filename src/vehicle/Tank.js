// Main battle tank: tracked raycast vehicle (skid steering, pivots on the spot), a
// turret that slews toward where you aim, a cannon that fires explosive shells (2.5 s
// reload, recoil) and a coaxial machine gun. Crushes cars, shrugs off small arms.
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { CAR } from './VehiclePhysics.js'
import { U } from '../world/Uniforms.js'
import { damp, clamp, angleDelta } from '../core/math.js'

const wheels = []
for (const z of [2.0, 0.7, -0.7, -2.0]) for (const x of [1.42, -1.42]) wheels.push({ x, y: 0, z, front: z > 0 })

export const TANK = {
  ...CAR,
  kind: 'tank', mass: 9000, com: { x: 0, y: -0.55, z: 0 }, inertia: { x: 15000, y: 17000, z: 7000 },
  wheelRadius: 0.5, restLength: 0.32, wheels,
  chassis: { hx: 1.62, hy: 0.55, hz: 3.15, y: 0.38 }, cabin: { hx: 1.05, hy: 0.36, hz: 1.45, y: 1.28, z: -0.25 },
  gears: [24, 14, 8.4], reverse: 22, idle: 650, redline: 2600, upRpm: 2300, downRpm: 1100,
  torque: 520, drag: 1.2, rolling: 900, brake: 1400, steerLow: 0, steerHigh: 0, steerFade: 10,
  friction: { front: 2.6, rear: 2.6 }, stiffness: 45, maxSuspensionForce: 220000, frontShare: 0.5, balance: false, yawAssist: 0, downforce: 0,
  skidSteer: 3200, turnRate: 0.85, sideFriction: 0.22, slipRpm: 1300,
  vmax: 16.5, vmaxNitro: 0, nitroTime: 0, health: 6000, sound: 'tank', heavy: true,
}

const OLIVE = 0x5d6b45
const DARK = 0x454f35
const TRACK = 0x2a2824

export class TankVisual {
  constructor(scene, vp) {
    this.vp = vp
    this.group = new THREE.Group()
    scene.add(this.group)
    const camo = new THREE.MeshStandardMaterial({ color: OLIVE, roughness: 0.85, metalness: 0.15 })
    const dark = new THREE.MeshStandardMaterial({ color: DARK, roughness: 0.9, metalness: 0.1 })
    const steel = new THREE.MeshStandardMaterial({ color: 0x3a3a36, roughness: 0.6, metalness: 0.6 })
    const trackMat = new THREE.MeshStandardMaterial({ color: TRACK, roughness: 0.95 })
    this.lightMat = new THREE.MeshStandardMaterial({ color: 0xfff1d0, emissive: 0xffe6b0, emissiveIntensity: 1 })
    const add = (geo, mat, x, y, z, parent = this.body, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat)
      m.position.set(x, y, z)
      m.rotation.set(rx, ry, rz)
      m.castShadow = true
      m.receiveShadow = true
      parent.add(m)
      return m
    }
    const yOff = -(vp.cfg.restLength * 0.7 + vp.wheelRadius) + 0.05
    this.body = new THREE.Group()
    this.body.position.y = yOff
    this.group.add(this.body)
    // hull
    add(new RoundedBoxGeometry(2.7, 0.9, 6.2, 2, 0.12), camo, 0, 0.95, 0)
    add(new RoundedBoxGeometry(2.6, 0.5, 1.6, 2, 0.1), camo, 0, 1.2, 2.55, this.body, -0.45)
    add(new RoundedBoxGeometry(3.3, 0.12, 6.4, 1, 0.04), dark, 0, 1.42, -0.05) // fenders
    for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.08, 0.55, 5.4), camo, sx * 1.66, 1.12, 0.05) // side skirts
    add(new THREE.BoxGeometry(2.2, 0.3, 1.6), dark, 0, 1.55, -2.3) // engine deck
    for (let k = 0; k < 5; k++) add(new THREE.BoxGeometry(2.0, 0.05, 0.12), steel, 0, 1.72, -1.7 - k * 0.28)
    for (const sx of [-0.9, 0.9]) add(new THREE.CylinderGeometry(0.12, 0.12, 0.08, 12), this.lightMat, sx, 1.25, 3.13, this.body, Math.PI / 2)
    this.exhaustLocal = new THREE.Vector3(0.9, yOff + 1.6, -3.1)
    // road wheels + track links
    this.roadWheels = []
    const wGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.42, 16).rotateZ(Math.PI / 2)
    for (const sx of [-1.42, 1.42]) {
      for (let k = 0; k < 6; k++) {
        const w = add(wGeo, dark, sx, 0.41, -2.45 + k * 0.98)
        this.roadWheels.push(w)
      }
      add(new THREE.CylinderGeometry(0.42, 0.42, 0.44, 14).rotateZ(Math.PI / 2), steel, sx, 0.57, 3.05)
      add(new THREE.CylinderGeometry(0.42, 0.42, 0.44, 14).rotateZ(Math.PI / 2), steel, sx, 0.57, -3.05)
    }
    // track belts: links moving around an oval loop on each side
    this.linkCount = 46
    this.links = new THREE.InstancedMesh(new THREE.BoxGeometry(0.62, 0.09, 0.3), trackMat, this.linkCount * 2)
    this.links.castShadow = true
    this.links.frustumCulled = false
    this.body.add(this.links)
    this.trackLen = 0
    this.loop = this.trackLoop()
    this.trackPos = [0, 0]
    // turret (yaw) and gun (pitch)
    this.turret = new THREE.Group()
    this.turret.position.set(0, 1.5, -0.25)
    this.body.add(this.turret)
    add(new RoundedBoxGeometry(2.2, 0.75, 2.9, 3, 0.22), camo, 0, 0.38, 0, this.turret)
    add(new RoundedBoxGeometry(1.4, 0.35, 0.8, 2, 0.1), camo, 0, 0.35, -1.6, this.turret) // bustle
    add(new THREE.CylinderGeometry(0.32, 0.36, 0.25, 14), dark, 0.45, 0.85, -0.3, this.turret) // hatch
    add(new THREE.BoxGeometry(0.1, 0.12, 0.7), steel, 0.45, 1.08, 0.05, this.turret) // roof MG
    for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) add(new THREE.CylinderGeometry(0.06, 0.06, 0.3, 8), steel, sx * 1.0, 0.55, 0.9 - k * 0.15, this.turret, 0.6 * sx, 0, 0) // smoke launchers
    this.gun = new THREE.Group()
    this.gun.position.set(0, 0.42, 1.35)
    this.turret.add(this.gun)
    add(new RoundedBoxGeometry(0.75, 0.55, 0.5, 2, 0.08), dark, 0, 0, 0.1, this.gun) // mantlet
    add(new THREE.CylinderGeometry(0.12, 0.14, 4.2, 14).rotateX(Math.PI / 2), steel, 0, 0, 2.3, this.gun)
    add(new THREE.CylinderGeometry(0.19, 0.19, 0.5, 14).rotateX(Math.PI / 2), steel, 0, 0, 1.6, this.gun) // fume extractor
    add(new THREE.CylinderGeometry(0.17, 0.15, 0.32, 12).rotateX(Math.PI / 2), steel, 0, 0, 4.4, this.gun) // muzzle brake
    add(new THREE.CylinderGeometry(0.035, 0.035, 0.5, 8).rotateX(Math.PI / 2), steel, 0.32, 0.05, 0.5, this.gun) // coax MG
    this.muzzleLocal = new THREE.Vector3(0, 0, 4.65)
    this.coaxLocal = new THREE.Vector3(0.32, 0.05, 0.8)
    this.recoil = 0
    this.turretYaw = 0
    this.gunPitch = 0
    this.seat = new THREE.Vector3(0.45, 1.6, -0.3)
  }

  // Oval track path (y, z) per side: bottom run, front curve, top run, rear curve
  trackLoop() {
    const pts = []
    const zf = 3.05, zr = -3.05, yb = -0.06, yt = 1.2
    const yc = (yb + yt) / 2, ry = (yt - yb) / 2, rz = 0.42
    const add = (y, z) => pts.push(new THREE.Vector2(y, z))
    for (let i = 0; i < 20; i++) add(yb, zr + (i / 20) * (zf - zr))
    for (let i = 0; i < 8; i++) { const a = -Math.PI / 2 + (i / 8) * Math.PI; add(yc + Math.sin(a) * ry, zf + Math.cos(a) * rz) }
    for (let i = 0; i < 20; i++) add(yt, zf - (i / 20) * (zf - zr))
    for (let i = 0; i < 8; i++) { const a = Math.PI / 2 + (i / 8) * Math.PI; add(yc + Math.sin(a) * ry, zr + Math.cos(a) * rz) }
    const len = [0]
    for (let i = 1; i <= pts.length; i++) len.push(len[i - 1] + pts[i % pts.length].distanceTo(pts[i - 1]))
    this.trackLen = len[len.length - 1]
    return { pts, len }
  }

  sampleTrack(s, out) {
    const { pts, len } = this.loop
    s = ((s % this.trackLen) + this.trackLen) % this.trackLen
    let i = 0
    while (i < len.length - 2 && len[i + 1] < s) i++
    const a = pts[i % pts.length], b = pts[(i + 1) % pts.length]
    const t = (s - len[i]) / (len[i + 1] - len[i] || 1)
    out.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, Math.atan2(b.x - a.x, b.y - a.y))
    return out
  }

  update(dt, pos, quat) {
    this.group.position.copy(pos)
    this.group.quaternion.copy(quat)
    const vp = this.vp
    // tracks run at ground speed, faster / backwards on the outside / inside of a turn
    const yawRate = vp.body.angvel().y
    const v = vp.speed
    const sides = [v - yawRate * 1.42, v + yawRate * 1.42] // x = -1.42 (index 0), +1.42 (index 1)
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const e = new THREE.Euler()
    const o = new THREE.Vector3()
    const sp = new THREE.Vector3(1, 1, 1)
    for (let side = 0; side < 2; side++) {
      this.trackPos[side] += sides[side] * dt
      const x = side === 0 ? -1.42 : 1.42
      for (let k = 0; k < this.linkCount; k++) {
        this.sampleTrack(this.trackPos[side] + (k / this.linkCount) * this.trackLen, o)
        q.setFromEuler(e.set(-o.z, 0, 0))
        m.compose(new THREE.Vector3(x, o.x, o.y), q, sp)
        this.links.setMatrixAt(side * this.linkCount + k, m)
      }
    }
    this.links.instanceMatrix.needsUpdate = true
    for (let i = 0; i < this.roadWheels.length; i++) this.roadWheels[i].rotation.x = this.trackPos[i < 6 ? 0 : 1] / 0.42
    // turret + gun
    this.turret.rotation.y = this.turretYaw
    this.recoil = damp(this.recoil, 0, 6, dt)
    this.gun.rotation.x = -this.gunPitch
    this.gun.position.z = 1.35 - this.recoil * 0.6
    this.lightMat.emissiveIntensity = 0.6 + U.uNight.value * 4
  }

  // world-space muzzle position + barrel direction
  muzzle(out = new THREE.Vector3(), dir = new THREE.Vector3()) {
    this.gun.updateMatrixWorld(true)
    out.copy(this.muzzleLocal).applyMatrix4(this.gun.matrixWorld)
    dir.set(0, 0, 1).transformDirection(this.gun.matrixWorld)
    return { pos: out, dir }
  }

  coax(out = new THREE.Vector3(), dir = new THREE.Vector3()) {
    this.gun.updateMatrixWorld(true)
    out.copy(this.coaxLocal).applyMatrix4(this.gun.matrixWorld)
    dir.set(0, 0, 1).transformDirection(this.gun.matrixWorld)
    return { pos: out, dir }
  }
}

// Turret aiming + firing while you drive the tank
export class TankGunner {
  constructor(game, v) {
    this.game = game
    this.v = v
    this.reload = 0
    this.mgCool = 0
    this.listeners = {}
  }

  on(n, fn) {
    ;(this.listeners[n] ||= []).push(fn)
  }

  emit(n, ...a) {
    for (const fn of this.listeners[n] || []) fn(...a)
  }

  update(dt, input) {
    const g = this.game
    const vis = this.v.visual
    this.reload = Math.max(0, this.reload - dt)
    this.mgCool = Math.max(0, this.mgCool - dt)
    if (g.active !== this.v) {
      vis.gunPitch = damp(vis.gunPitch, 0, 2, dt)
      return
    }
    // aim point from the camera (screen centre / cursor)
    const aim = g.combat.aim()
    const hullYaw = new THREE.Euler().setFromQuaternion(this.v.quat, 'YXZ').y
    const tp = vis.turret.getWorldPosition(new THREE.Vector3())
    const want = Math.atan2(aim.point.x - tp.x, aim.point.z - tp.z) - hullYaw
    const d = angleDelta(vis.turretYaw, want)
    vis.turretYaw += clamp(d, -1.1 * dt, 1.1 * dt)
    const flat = Math.hypot(aim.point.x - tp.x, aim.point.z - tp.z)
    const pitch = clamp(Math.atan2(aim.point.y - (tp.y + 0.4), flat), -0.12, 0.35)
    vis.gunPitch += clamp(pitch - vis.gunPitch, -0.6 * dt, 0.6 * dt)
    this.aligned = Math.abs(d) < 0.05
    // cannon: left mouse / Ctrl / touch FIRE
    if (input.fire && this.reload <= 0) {
      this.reload = 2.5
      const { pos, dir } = vis.muzzle()
      g.combat.launchRocket(pos, dir, 'player', 'shell', this.v.phys.body)
      g.effects.muzzle(pos, dir)
      for (let k = 0; k < 10; k++) g.effects.smokeTrail(pos.clone().addScaledVector(dir, k * 0.3), 1.2, k < 3)
      g.combat.flashAt(pos, 120, 30)
      vis.recoil = 1
      const m = this.v.phys.mass
      this.v.phys.body.applyImpulse({ x: -dir.x * m * 0.6, y: 0, z: -dir.z * m * 0.6 }, true)
      g.rig.addShake(0.6)
      g.combat.disturb(pos, 80)
      this.emit('cannon', pos)
    }
    // coaxial machine gun: right mouse
    if ((input.mouse[2] || input.touch.aim) && this.mgCool <= 0) {
      this.mgCool = 0.09
      const { pos } = vis.coax()
      const dir = aim.point.clone().sub(pos).normalize()
      dir.x += (Math.random() - 0.5) * 0.03
      dir.y += (Math.random() - 0.5) * 0.02
      dir.z += (Math.random() - 0.5) * 0.03
      dir.normalize()
      g.combat.hitscan(pos, dir, 170, 20, 'player', true)
      g.effects.muzzle(pos, dir)
      g.combat.flashAt(pos, 18, 8)
      g.combat.disturb(pos, 45)
      this.emit('mg', pos)
    }
  }
}
