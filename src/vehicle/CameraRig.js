// Camera modes:
//  • diorama — high three-quarter view (the signature look), drag to orbit, wheel to zoom
//  • chase   — low eye-level camera behind a car / bike / helicopter
//  • third   — over-the-shoulder eye-level camera when walking (mouse look)
// Cameras that sit behind the player are pulled in when a wall is in the way.
import * as THREE from 'three'
import { clamp, damp, angleDelta } from '../core/math.js'

const _v = new THREE.Vector3()
const _fwd = new THREE.Vector3()

const MODES = { foot: ['third', 'diorama'], car: ['diorama', 'chase'], bike: ['diorama', 'chase'], heli: ['chase', 'diorama'] }

export class CameraRig {
  constructor(camera, dom, physics) {
    this.camera = camera
    this.physics = physics
    this.dom = dom
    this.modeIndex = { foot: 0, car: 0, bike: 0, heli: 0 }
    this.kind = 'car'
    this.azimuth = -2.35
    this.targetAzimuth = this.azimuth
    this.elevation = 0.72
    this.distance = 26
    this.targetDistance = 26
    this.focus = new THREE.Vector3()
    this.lookAhead = new THREE.Vector3()
    this.shake = 0
    this.fov = 32
    this.initialized = false
    this.chaseHeading = 0
    // third-person orbit
    this.yaw = 0
    this.pitch = 0.18
    this.thirdDist = 3.6
    this.lastLook = -10
    this.lift = 0 // extra diorama elevation while a building is in the way
    this.liftTarget = 0
    this.liftTimer = 0
    this.time = 0

    let dragging = false, lastX = 0, lastY = 0
    dom.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') return
      dragging = true
      lastX = e.clientX
      lastY = e.clientY
      if (this.mode !== 'diorama' && document.pointerLockElement !== dom && dom.requestPointerLock) {
        try { dom.requestPointerLock() } catch {}
      }
    })
    window.addEventListener('pointerup', () => (dragging = false))
    window.addEventListener('pointermove', (e) => {
      if (document.pointerLockElement === dom) {
        this.look(e.movementX * 0.0035, e.movementY * 0.0028)
        return
      }
      if (!dragging) return
      this.look((e.clientX - lastX) * 0.006, (e.clientY - lastY) * 0.004)
      lastX = e.clientX
      lastY = e.clientY
    })
    dom.addEventListener('wheel', (e) => {
      if (this.mode === 'diorama') this.targetDistance = clamp(this.targetDistance + e.deltaY * 0.02, 12, 60)
      else this.thirdDist = clamp(this.thirdDist + e.deltaY * 0.004, 2.2, 9)
    }, { passive: true })
  }

  get mode() {
    return MODES[this.kind][this.modeIndex[this.kind]]
  }

  setKind(kind) {
    if (kind !== this.kind) {
      this.kind = kind
      this.initialized = false
    }
  }

  look(dx, dy) {
    if (this.mode === 'diorama') {
      this.targetAzimuth -= dx
      this.elevation = clamp(this.elevation + dy * 0.75, 0.3, 1.25)
    } else {
      this.yaw -= dx
      this.pitch = clamp(this.pitch + dy, -0.35, 1.1)
      this.lastLook = this.time
    }
  }

  orbit(dx) {
    this.look(dx, 0)
  }

  toggle() {
    const list = MODES[this.kind]
    this.modeIndex[this.kind] = (this.modeIndex[this.kind] + 1) % list.length
    this.initialized = false
    if (this.mode === 'diorama' && document.pointerLockElement) document.exitPointerLock?.()
    return this.mode
  }

  addShake(amount) {
    this.shake = Math.min(1.2, this.shake + amount)
  }

  snap() {
    this.initialized = false
  }

  // Heading the player should treat as "forward" for on-foot controls
  forwardYaw() {
    _v.copy(this.focus).sub(this.camera.position)
    return Math.atan2(_v.x, _v.z)
  }

  // Shorten a camera boom if something solid is between the pivot and the camera
  // Pull the camera in front of whatever blocks the line from the pivot (buildingsOnly:
  // ignore lamps, trees and props so the high camera doesn't twitch past them)
  collide(pivot, desired, exclude, buildingsOnly = false) {
    const hit = this.blocker(pivot, desired, exclude, buildingsOnly)
    if (!hit) return desired
    const d = Math.max(0.6, hit.toi - 0.35)
    return pivot.clone().addScaledVector(hit.dir, d)
  }

  blocker(pivot, desired, exclude, buildingsOnly = false) {
    if (!this.physics) return null
    const dir = new THREE.Vector3().copy(desired).sub(pivot)
    const len = dir.length()
    if (len < 0.01) return null
    dir.divideScalar(len)
    const ray = new this.physics.RAPIER.Ray({ x: pivot.x, y: pivot.y, z: pivot.z }, { x: dir.x, y: dir.y, z: dir.z })
    const pred = buildingsOnly ? (col) => this.physics.getTag(col.handle)?.kind === 'building' : undefined
    const hit = this.physics.world.castRay(ray, len, true, undefined, undefined, undefined, exclude, pred)
    return hit ? { toi: hit.timeOfImpact, dir } : null
  }

  // target: { pos, quat, vel, speed, boosting, body, heading }
  update(dt, target) {
    this.time += dt
    const cam = this.camera
    const { pos, quat, vel } = target
    _fwd.set(0, 0, 1).applyQuaternion(quat)
    const heading = target.heading ?? Math.atan2(_fwd.x, _fwd.z)
    const speed = target.speed ?? 0
    const mode = this.mode

    // Focus with a little look-ahead in the direction of travel
    const portrait = cam.aspect < 1
    const ahead = mode === 'diorama' ? (portrait ? 0.14 : 0.32) : 0.12
    _v.set(vel.x, 0, vel.z).multiplyScalar(ahead)
    const maxAhead = mode === 'diorama' ? (portrait ? 3 : 7) : 3
    if (_v.length() > maxAhead) _v.setLength(maxAhead)
    this.lookAhead.x = damp(this.lookAhead.x, _v.x, 2.5, dt)
    this.lookAhead.z = damp(this.lookAhead.z, _v.z, 2.5, dt)
    const tgt = new THREE.Vector3(pos.x + this.lookAhead.x, pos.y, pos.z + this.lookAhead.z)
    if (!this.initialized) {
      this.focus.copy(tgt)
      this.chaseHeading = heading
      this.yaw = heading
    }
    this.focus.x = damp(this.focus.x, tgt.x, mode === 'third' ? 18 : 7, dt)
    this.focus.y = damp(this.focus.y, tgt.y, mode === 'third' ? 14 : 4, dt)
    this.focus.z = damp(this.focus.z, tgt.z, mode === 'third' ? 18 : 7, dt)

    this.azimuth += angleDelta(this.azimuth, this.targetAzimuth) * (1 - Math.exp(-8 * dt))
    this.distance = damp(this.distance, this.targetDistance, 6, dt)

    let desired, lookAt, fov, stiff = 9
    if (mode === 'diorama') {
      const d = this.distance * (1 + clamp(speed / 30, 0, 1) * 0.12) * (this.kind === 'heli' ? 1.35 : 1)
      const at = (el) => new THREE.Vector3(
        this.focus.x + Math.cos(this.azimuth) * Math.cos(el) * d,
        this.focus.y + Math.sin(el) * d,
        this.focus.z + Math.sin(this.azimuth) * Math.cos(el) * d,
      )
      // A tall building in the way? Tilt towards top-down until the view clears.
      const pivot = new THREE.Vector3(this.focus.x, this.focus.y + 1.2, this.focus.z)
      this.liftTimer -= dt
      if (this.liftTimer <= 0) {
        this.liftTimer = 0.12
        let extra = 0
        for (const e of [0, 0.2, 0.4, 0.62]) {
          extra = e
          if (this.elevation + e > 1.42 || !this.blocker(pivot, at(this.elevation + e), target.body, true)) break
        }
        this.liftTarget = Math.min(extra, 1.42 - this.elevation)
      }
      this.lift = damp(this.lift, this.liftTarget, 3.5, dt)
      desired = this.collide(pivot, at(this.elevation + this.lift), target.body, true)
      lookAt = this.focus.clone()
      fov = 32 + (target.boosting ? 4 : 0)
    } else if (mode === 'third') {
      // auto-swing behind the player when walking and the mouse is idle
      if (speed > 0.5 && this.time - this.lastLook > 1.6) this.yaw += angleDelta(this.yaw, heading) * Math.min(1, dt * 1.2)
      const pivot = new THREE.Vector3(this.focus.x, this.focus.y + 1.55, this.focus.z)
      const side = new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw)).multiplyScalar(0.45) // over the right shoulder
      const back = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch)).multiplyScalar(this.thirdDist)
      const shoulder = pivot.clone().add(side)
      desired = this.collide(shoulder, shoulder.clone().add(back), target.body)
      lookAt = shoulder.clone().add(new THREE.Vector3(Math.sin(this.yaw), -Math.sin(this.pitch) * 0.6 + 0.05, Math.cos(this.yaw)).multiplyScalar(4))
      fov = 55 + clamp(speed / 6, 0, 1) * 6
      stiff = 22
    } else {
      // chase: behind the vehicle, mouse can swing it around temporarily
      this.chaseHeading += angleDelta(this.chaseHeading, heading) * (1 - Math.exp(-(this.kind === 'heli' ? 2.5 : 4) * dt))
      const looking = this.time - this.lastLook < 2.0
      if (!looking) this.yaw += angleDelta(this.yaw, this.chaseHeading) * Math.min(1, dt * 3)
      const yaw = looking ? this.yaw : this.chaseHeading
      const heli = this.kind === 'heli'
      const back = (heli ? 13 : this.kind === 'bike' ? 5.2 : 6.6) + clamp(speed / 30, 0, 1) * 1.5
      const up = heli ? 4.2 : 2.1 + this.pitch * 2
      const pivot = new THREE.Vector3(pos.x, pos.y + (heli ? 2 : 1.2), pos.z)
      desired = this.collide(pivot, new THREE.Vector3(pos.x - Math.sin(yaw) * back, pos.y + up, pos.z - Math.cos(yaw) * back), target.body)
      lookAt = new THREE.Vector3(pos.x + Math.sin(yaw) * 4, pos.y + (heli ? 1.5 : 1.1), pos.z + Math.cos(yaw) * 4)
      fov = (heli ? 55 : 58) + clamp(speed / 28, 0, 1) * 8 + (target.boosting ? 6 : 0)
      stiff = heli ? 5 : 7
    }

    if (!this.initialized) {
      cam.position.copy(desired)
      this.initialized = true
    } else {
      cam.position.x = damp(cam.position.x, desired.x, stiff, dt)
      cam.position.y = damp(cam.position.y, desired.y, stiff, dt)
      cam.position.z = damp(cam.position.z, desired.z, stiff, dt)
    }
    cam.lookAt(lookAt)

    if (this.shake > 0.001) {
      const s = this.shake * this.shake * 0.5
      const t = performance.now() * 0.05
      cam.position.x += Math.sin(t * 1.7) * s
      cam.position.y += Math.sin(t * 2.3 + 1) * s
      cam.position.z += Math.sin(t * 1.9 + 2) * s
      this.shake = damp(this.shake, 0, 5, dt)
    }
    this.fov = damp(this.fov, fov, 3, dt)
    const minHalfH = (mode === 'diorama' ? 13.5 : 24) * (Math.PI / 180)
    const aspectFov = (2 * Math.atan(Math.tan(minHalfH) / cam.aspect) * 180) / Math.PI
    const f = Math.max(this.fov, aspectFov)
    if (Math.abs(cam.fov - f) > 0.01) {
      cam.fov = f
      cam.updateProjectionMatrix()
    }
  }
}
