// Sport motorbike model. Wheels spin and the fork steers; the whole bike (and rider)
// leans into corners based on speed × yaw rate, while the physics body stays upright.
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { U } from '../world/Uniforms.js'
import { damp, clamp } from '../core/math.js'

export class BikeVisual {
  constructor(scene, vp, color = 0xd84b3a) {
    this.vp = vp
    this.group = new THREE.Group() // follows physics
    this.tilt = new THREE.Group() // wheelie pitch around the rear tyre contact
    this.tilt.position.set(0, -0.62, -0.72)
    this.pivot = new THREE.Group()
    this.pivot.position.set(0, 0.62, 0.72)
    this.lean = new THREE.Group() // visual lean around the forward axis
    this.group.add(this.tilt)
    this.tilt.add(this.pivot)
    this.pivot.add(this.lean)
    scene.add(this.group)
    const paint = new THREE.MeshPhysicalMaterial({ color, roughness: 0.3, metalness: 0.2, clearcoat: 0.8 })
    const black = new THREE.MeshStandardMaterial({ color: 0x1e1e20, roughness: 0.6 })
    const metal = new THREE.MeshStandardMaterial({ color: 0xc9c2b8, roughness: 0.25, metalness: 0.9 })
    const seat = new THREE.MeshStandardMaterial({ color: 0x2a2626, roughness: 0.9 })
    this.headMat = new THREE.MeshStandardMaterial({ color: 0xfff1d0, emissive: 0xffe6b0, emissiveIntensity: 1.5 })
    this.tailMat = new THREE.MeshStandardMaterial({ color: 0x5a0d0d, emissive: 0xff2a1a, emissiveIntensity: 0.8 })
    const add = (geo, mat, x, y, z, rx = 0, parent = this.lean) => {
      const m = new THREE.Mesh(geo, mat)
      m.position.set(x, y, z)
      m.rotation.x = rx
      m.castShadow = true
      parent.add(m)
      return m
    }
    // frame + engine
    add(new RoundedBoxGeometry(0.34, 0.36, 0.6, 2, 0.08), black, 0, 0.32, 0.05)
    add(new THREE.CylinderGeometry(0.11, 0.11, 0.36, 12).rotateZ(Math.PI / 2), metal, 0, 0.22, 0.12)
    // tank + fairing + tail
    add(new RoundedBoxGeometry(0.36, 0.24, 0.62, 3, 0.1), paint, 0, 0.66, 0.18, -0.12)
    add(new RoundedBoxGeometry(0.42, 0.42, 0.34, 3, 0.12), paint, 0, 0.72, 0.62, -0.5)
    add(new RoundedBoxGeometry(0.28, 0.16, 0.6, 2, 0.06), paint, 0, 0.66, -0.52, 0.18)
    add(new RoundedBoxGeometry(0.3, 0.09, 0.5, 2, 0.04), seat, 0, 0.74, -0.22, 0.05)
    const screen = add(new THREE.BoxGeometry(0.3, 0.2, 0.02), new THREE.MeshPhysicalMaterial({ color: 0x9fc7cf, transparent: true, opacity: 0.45, roughness: 0.05 }), 0, 0.98, 0.72, -0.6)
    screen.castShadow = false
    add(new THREE.CylinderGeometry(0.075, 0.075, 0.05, 14).rotateX(Math.PI / 2), this.headMat, 0, 0.74, 0.8)
    add(new THREE.BoxGeometry(0.14, 0.05, 0.03), this.tailMat, 0, 0.66, -0.83)
    // exhaust
    add(new THREE.CylinderGeometry(0.05, 0.06, 0.6, 10).rotateX(Math.PI / 2 - 0.2), metal, 0.18, 0.32, -0.55)
    this.exhaustLocal = new THREE.Vector3(0.18, 0.28, -0.9)
    // fork + handlebars (steer pivot)
    this.fork = new THREE.Group()
    this.fork.position.set(0, 0.95, 0.66)
    this.fork.rotation.x = 0.42
    this.lean.add(this.fork)
    for (const sx of [-0.09, 0.09]) add(new THREE.CylinderGeometry(0.025, 0.025, 0.7, 8), metal, sx, -0.35, 0, 0, this.fork)
    add(new THREE.CylinderGeometry(0.018, 0.018, 0.62, 8).rotateZ(Math.PI / 2), black, 0, 0.03, -0.05, 0, this.fork)
    // wheels
    const tyre = new THREE.TorusGeometry(0.27, 0.07, 10, 28).rotateY(Math.PI / 2)
    const rim = new THREE.CylinderGeometry(0.21, 0.21, 0.05, 20).rotateZ(Math.PI / 2)
    const mkWheel = () => {
      const w = new THREE.Group()
      const t = new THREE.Mesh(tyre, black)
      t.castShadow = true
      w.add(t, new THREE.Mesh(rim, metal))
      for (let i = 0; i < 5; i++) {
        const sp = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.4, 0.04), paint)
        sp.rotation.x = (i / 5) * Math.PI
        w.add(sp)
      }
      return w
    }
    this.frontSpin = mkWheel()
    this.frontWheel = new THREE.Group()
    this.frontWheel.add(this.frontSpin)
    this.lean.add(this.frontWheel)
    this.rearSpin = mkWheel()
    this.rearSpin.position.set(0, 0, -0.72)
    this.lean.add(this.rearSpin)
    this.leanAngle = 0
    this.seat = new THREE.Vector3(0, 0.78, -0.22)
  }

  update(dt, pos, quat) {
    this.group.position.copy(pos)
    this.group.quaternion.copy(quat)
    const vp = this.vp
    const f = vp.wheelState(0), r = vp.wheelState(2)
    this.frontWheel.position.set(0, -(f.suspension) + 0.0, 0.74)
    this.frontWheel.rotation.y = f.steering
    this.frontSpin.rotation.x = f.rotation
    this.rearSpin.position.y = -(r.suspension)
    this.rearSpin.rotation.x = r.rotation
    this.fork.rotation.y = f.steering * 0.9
    const yawRate = vp.body.angvel().y
    const target = clamp(Math.atan2(vp.speed * yawRate, 9.81), -0.75, 0.75) * (vp.grounded ? 1 : 0.3)
    this.leanAngle = damp(this.leanAngle, -target, 8, dt)
    this.lean.rotation.z = this.leanAngle
    this.tilt.rotation.x = -vp.wheelie
    const braking = vp.braking > 0.05
    this.tailMat.emissiveIntensity = 0.6 + U.uNight.value * 1.2 + (braking ? 4 : 0)
    this.headMat.emissiveIntensity = 1.2 + U.uNight.value * 5
  }
}
