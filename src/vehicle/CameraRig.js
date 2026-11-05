// Camera: a high three-quarter "diorama" view (default) or a low chase cam.
// Spring-smoothed follow with speed look-ahead, drag-to-orbit, wheel-to-zoom,
// boost FOV kick and impact shake.
import * as THREE from 'three'
import { clamp, damp, angleDelta } from '../core/math.js'

const _v = new THREE.Vector3()
const _fwd = new THREE.Vector3()

export class CameraRig {
  constructor(camera, dom) {
    this.camera = camera
    this.mode = 'diorama'
    this.azimuth = -2.35 // radians around Y (camera sits south-west of the car by default)
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

    let dragging = false, lastX = 0, lastY = 0
    dom.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') return // touch drag is handled by the touch controls
      dragging = true
      lastX = e.clientX
      lastY = e.clientY
    })
    window.addEventListener('pointerup', () => (dragging = false))
    window.addEventListener('pointermove', (e) => {
      if (!dragging) return
      this.targetAzimuth -= (e.clientX - lastX) * 0.006
      this.elevation = clamp(this.elevation + (e.clientY - lastY) * 0.003, 0.35, 1.2)
      lastX = e.clientX
      lastY = e.clientY
    })
    dom.addEventListener('wheel', (e) => {
      this.targetDistance = clamp(this.targetDistance + e.deltaY * 0.02, 12, 46)
    }, { passive: true })
  }

  orbit(dx) {
    this.targetAzimuth -= dx
  }

  toggle() {
    this.mode = this.mode === 'diorama' ? 'chase' : 'diorama'
    return this.mode
  }

  addShake(amount) {
    this.shake = Math.min(1.2, this.shake + amount)
  }

  snap() {
    this.initialized = false
  }

  update(dt, carPos, carQuat, carVel, speed, boosting) {
    _fwd.set(0, 0, 1).applyQuaternion(carQuat)
    const cam = this.camera
    // Look ahead in the direction of travel
    const portrait = cam.aspect < 1
    _v.set(carVel.x, 0, carVel.z).multiplyScalar(portrait ? 0.14 : 0.32)
    if (_v.length() > (portrait ? 3 : 7)) _v.setLength(portrait ? 3 : 7)
    this.lookAhead.x = damp(this.lookAhead.x, _v.x, 2.5, dt)
    this.lookAhead.z = damp(this.lookAhead.z, _v.z, 2.5, dt)
    const target = _v.copy(carPos).add(this.lookAhead)
    if (!this.initialized) this.focus.copy(target)
    this.focus.x = damp(this.focus.x, target.x, 7, dt)
    this.focus.y = damp(this.focus.y, target.y, 4, dt)
    this.focus.z = damp(this.focus.z, target.z, 7, dt)

    this.azimuth += angleDelta(this.azimuth, this.targetAzimuth) * (1 - Math.exp(-8 * dt))
    this.distance = damp(this.distance, this.targetDistance, 6, dt)

    let desired, lookAt
    if (this.mode === 'diorama') {
      const d = this.distance * (1 + clamp(Math.abs(speed) / 30, 0, 1) * 0.12)
      desired = new THREE.Vector3(
        this.focus.x + Math.cos(this.azimuth) * Math.cos(this.elevation) * d,
        this.focus.y + Math.sin(this.elevation) * d,
        this.focus.z + Math.sin(this.azimuth) * Math.cos(this.elevation) * d,
      )
      lookAt = this.focus.clone()
      this.fov = damp(this.fov, 32 + (boosting ? 4 : 0), 3, dt)
    } else {
      const heading = Math.atan2(_fwd.x, _fwd.z)
      if (!this.initialized) this.chaseHeading = heading
      this.chaseHeading += angleDelta(this.chaseHeading, heading) * (1 - Math.exp(-4 * dt))
      const back = 7.5 + clamp(Math.abs(speed) / 30, 0, 1) * 1.5
      desired = new THREE.Vector3(
        carPos.x - Math.sin(this.chaseHeading) * back,
        carPos.y + 2.8,
        carPos.z - Math.cos(this.chaseHeading) * back,
      )
      lookAt = new THREE.Vector3(carPos.x + Math.sin(this.chaseHeading) * 4, carPos.y + 1.0, carPos.z + Math.cos(this.chaseHeading) * 4)
      this.fov = damp(this.fov, 58 + clamp(Math.abs(speed) / 28, 0, 1) * 8 + (boosting ? 6 : 0), 3, dt)
    }

    if (!this.initialized) {
      cam.position.copy(desired)
      this.initialized = true
    } else {
      const k = this.mode === 'diorama' ? 9 : 6
      cam.position.x = damp(cam.position.x, desired.x, k, dt)
      cam.position.y = damp(cam.position.y, desired.y, k, dt)
      cam.position.z = damp(cam.position.z, desired.z, k, dt)
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
    // Tall (portrait) screens: widen the vertical FOV so the horizontal view stays usable
    const minHalfH = (this.mode === 'diorama' ? 13.5 : 24) * (Math.PI / 180)
    const aspectFov = (2 * Math.atan(Math.tan(minHalfH) / cam.aspect) * 180) / Math.PI
    const fov = Math.max(this.fov, aspectFov)
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov
      cam.updateProjectionMatrix()
    }
  }
}
