// Procedural off-road buggy. Wheels spin, steer and follow suspension travel from the
// physics controller; head/brake/reverse lights react to driving and time of day.
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { U } from '../world/Uniforms.js'
import { damp } from '../core/math.js'

const PAINT = 0x2b9e96
const PAINT_DARK = 0x1d6f6a
const CREAM = 0xf3e6cf
const TRIM = 0x2a2626

function tyreGeometry(radius, width) {
  // Rounded tyre profile, lathed around the axle
  const pts = []
  const r = radius, w = width / 2, b = 0.07
  pts.push(new THREE.Vector2(r * 0.62, -w))
  pts.push(new THREE.Vector2(r - b, -w))
  for (let i = 0; i <= 6; i++) {
    const a = -Math.PI / 2 + (i / 6) * Math.PI
    pts.push(new THREE.Vector2(r - b + Math.cos(a) * b, Math.sin(a) * (w - 0.0) * 0.98))
  }
  pts.push(new THREE.Vector2(r - b, w))
  pts.push(new THREE.Vector2(r * 0.62, w))
  const g = new THREE.LatheGeometry(pts, 28)
  g.rotateZ(Math.PI / 2)
  return g
}

export class VehicleVisual {
  constructor(scene, vehiclePhysics) {
    this.vp = vehiclePhysics
    this.group = new THREE.Group()
    this.body = new THREE.Group() // sprung mass (lights live here)
    this.group.add(this.body)
    scene.add(this.group)

    const paint = new THREE.MeshPhysicalMaterial({ color: PAINT, roughness: 0.38, metalness: 0.1, clearcoat: 0.6, clearcoatRoughness: 0.25 })
    const paintDark = new THREE.MeshStandardMaterial({ color: PAINT_DARK, roughness: 0.5 })
    const cream = new THREE.MeshStandardMaterial({ color: CREAM, roughness: 0.55 })
    const trim = new THREE.MeshStandardMaterial({ color: TRIM, roughness: 0.7, metalness: 0.2 })
    const metal = new THREE.MeshStandardMaterial({ color: 0xc9c2b8, roughness: 0.3, metalness: 0.85 })
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x9fc7cf, roughness: 0.05, metalness: 0, transmission: 0, transparent: true, opacity: 0.35 })
    const seat = new THREE.MeshStandardMaterial({ color: 0x7a4b33, roughness: 0.8 })
    this.headMat = new THREE.MeshStandardMaterial({ color: 0xfff1d0, emissive: 0xffe6b0, emissiveIntensity: 1.2 })
    this.tailMat = new THREE.MeshStandardMaterial({ color: 0x5a0d0d, emissive: 0xff2a1a, emissiveIntensity: 0.6 })
    this.reverseMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, emissive: 0xffffff, emissiveIntensity: 0 })
    this.barMat = new THREE.MeshStandardMaterial({ color: 0xfff6dc, emissive: 0xffd99a, emissiveIntensity: 0.3 })

    const add = (geo, mat, x, y, z, parent = this.body) => {
      const m = new THREE.Mesh(geo, mat)
      m.position.set(x, y, z)
      m.castShadow = true
      m.receiveShadow = true
      parent.add(m)
      return m
    }

    // --- Body shell
    add(new RoundedBoxGeometry(1.78, 0.42, 3.3, 3, 0.14), paint, 0, 0.3, 0.02)
    // hood bulge + front nose
    add(new RoundedBoxGeometry(1.5, 0.16, 1.05, 2, 0.07), paint, 0, 0.56, 1.05)
    add(new RoundedBoxGeometry(1.84, 0.22, 0.5, 2, 0.08), paintDark, 0, 0.16, 1.62)
    // rear tub
    add(new RoundedBoxGeometry(1.7, 0.26, 0.95, 2, 0.08), paintDark, 0, 0.58, -1.18)
    // side stripe
    for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.02, 0.07, 2.6), cream, sx * 0.9, 0.36, 0.05)
    // underbody skid
    add(new THREE.BoxGeometry(1.4, 0.08, 2.7), trim, 0, 0.06, 0)

    // --- Bumpers / bull bar
    add(new RoundedBoxGeometry(1.9, 0.16, 0.2, 2, 0.06), trim, 0, 0.18, 1.86)
    add(new RoundedBoxGeometry(1.9, 0.16, 0.2, 2, 0.06), trim, 0, 0.2, -1.72)
    const tube = (len, r = 0.035) => new THREE.CylinderGeometry(r, r, len, 8)
    for (const sx of [-0.45, 0.45]) {
      const t = add(tube(0.5), trim, sx, 0.42, 1.9)
      t.rotation.x = 0.35
    }
    const bar = add(tube(1.0), trim, 0, 0.62, 1.95)
    bar.rotation.z = Math.PI / 2

    // --- Roll cage (cream tubes) + roof
    const cageMat = cream
    const posts = [[-0.72, 0.38], [0.72, 0.38], [-0.72, -0.9], [0.72, -0.9]]
    for (const [x, z] of posts) {
      const p = add(tube(0.78, 0.045), cageMat, x, 0.92, z)
      if (z > 0) p.rotation.x = -0.32
    }
    add(new RoundedBoxGeometry(1.58, 0.07, 1.42, 2, 0.03), cream, 0, 1.31, -0.3)
    for (const sx of [-1, 1]) {
      const r = add(tube(1.42, 0.04), cageMat, sx * 0.76, 1.27, -0.3)
      r.rotation.x = Math.PI / 2
    }
    // windshield
    const ws = add(new THREE.BoxGeometry(1.36, 0.6, 0.03), glass, 0, 0.95, 0.47)
    ws.rotation.x = -0.32
    ws.castShadow = false
    // seats + steering wheel
    for (const sx of [-0.36, 0.36]) {
      add(new RoundedBoxGeometry(0.46, 0.14, 0.5, 2, 0.05), seat, sx, 0.58, -0.38)
      const back = add(new RoundedBoxGeometry(0.46, 0.55, 0.12, 2, 0.05), seat, sx, 0.86, -0.66)
      back.rotation.x = -0.15
    }
    const sw = add(new THREE.TorusGeometry(0.15, 0.025, 6, 16), trim, 0.36, 0.86, 0.1)
    sw.rotation.x = -0.9

    // --- Lights
    const headGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.08, 16).rotateX(Math.PI / 2)
    for (const sx of [-0.62, 0.62]) {
      add(new THREE.CylinderGeometry(0.15, 0.15, 0.06, 16).rotateX(Math.PI / 2), trim, sx, 0.4, 1.84)
      add(headGeo, this.headMat, sx, 0.4, 1.88)
    }
    // roof light bar
    add(new RoundedBoxGeometry(1.0, 0.12, 0.14, 2, 0.04), trim, 0, 1.4, 0.3)
    for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(0.18, 0.07, 0.04), this.barMat, -0.33 + i * 0.22, 1.4, 0.38)
    for (const sx of [-0.72, 0.72]) {
      add(new RoundedBoxGeometry(0.26, 0.12, 0.05, 2, 0.02), this.tailMat, sx, 0.4, -1.66)
      add(new THREE.BoxGeometry(0.1, 0.07, 0.04), this.reverseMat, sx * 0.72, 0.4, -1.67)
    }

    // --- Spare tyre, exhaust, mirrors, antenna flag
    const spare = add(tyreGeometry(0.36, 0.24), trim, 0, 0.85, -1.62)
    spare.rotation.y = Math.PI / 2
    add(new THREE.CylinderGeometry(0.16, 0.16, 0.26, 12).rotateX(Math.PI / 2), metal, 0, 0.85, -1.62)
    const ex = add(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 10).rotateX(Math.PI / 2), metal, -0.55, 0.08, -1.8)
    ex.castShadow = false
    this.exhaustLocal = new THREE.Vector3(-0.55, 0.08, -1.98)
    for (const sx of [-1, 1]) {
      const arm = add(tube(0.25, 0.02), trim, sx * 0.85, 0.82, 0.38)
      arm.rotation.z = (sx * Math.PI) / 2
      add(new RoundedBoxGeometry(0.06, 0.12, 0.18, 1, 0.02), trim, sx * 0.98, 0.84, 0.38)
    }
    add(tube(1.1, 0.012), trim, -0.78, 1.85, -0.95)
    this.flag = add(new THREE.PlaneGeometry(0.3, 0.18, 4, 1).translate(0.15, 0, 0), new THREE.MeshStandardMaterial({ color: 0xf2a33a, side: THREE.DoubleSide }), -0.78, 2.3, -0.95)
    this.flagGeo = this.flag.geometry
    this.flagBase = Float32Array.from(this.flagGeo.attributes.position.array)

    // Fenders over the wheels
    for (const w of this.vp.wheelPositions) {
      const f = add(new THREE.CylinderGeometry(0.56, 0.56, 0.4, 16, 1, true, -Math.PI / 2, Math.PI).rotateZ(Math.PI / 2), trim, w.x * 1.02, 0.18, w.z)
      f.material = new THREE.MeshStandardMaterial({ color: TRIM, roughness: 0.7, side: THREE.DoubleSide })
      f.scale.set(1, 0.75, 1)
    }

    // --- Wheels
    const tyre = tyreGeometry(this.vp.wheelRadius, 0.36)
    const tyreMat = new THREE.MeshStandardMaterial({ color: 0x232020, roughness: 0.92 })
    const treadGeo = new THREE.BoxGeometry(0.34, 0.06, 0.09)
    const rimMat = new THREE.MeshStandardMaterial({ color: CREAM, roughness: 0.4, metalness: 0.3 })
    this.wheels = this.vp.wheelPositions.map((wp) => {
      const pivot = new THREE.Group() // steering + suspension
      const spin = new THREE.Group() // rolling
      pivot.add(spin)
      this.group.add(pivot)
      const t = new THREE.Mesh(tyre, tyreMat)
      t.castShadow = true
      spin.add(t)
      // tread blocks
      const tread = new THREE.InstancedMesh(treadGeo, tyreMat, 14)
      const m = new THREE.Matrix4()
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2
        m.makeRotationX(a).setPosition(0, Math.cos(a) * (this.vp.wheelRadius - 0.01), Math.sin(a) * (this.vp.wheelRadius - 0.01))
        tread.setMatrixAt(i, m)
      }
      tread.castShadow = true
      spin.add(tread)
      const side = Math.sign(wp.x)
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.3, 14).rotateZ(Math.PI / 2), rimMat)
      spin.add(rim)
      for (let i = 0; i < 5; i++) {
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.36, 0.06), trim)
        spoke.position.x = side * 0.16
        spoke.rotation.x = (i / 5) * Math.PI * 2
        spin.add(spoke)
      }
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.34, 10).rotateZ(Math.PI / 2), metal)
      spin.add(cap)
      return { pivot, spin, base: wp }
    })

    // Headlight beams (only really visible at night)
    this.beams = [-0.62, 0.62].map((sx) => {
      const l = new THREE.SpotLight(0xffe9c4, 0, 38, 0.55, 0.55, 1.4)
      l.position.set(sx, 0.45, 1.9)
      l.target.position.set(sx * 1.4, -0.6, 14)
      this.body.add(l)
      this.body.add(l.target)
      return l
    })
    // Soft glow under the car at night (fake bounce light)
    this.prevBrake = 0
  }

  // Apply interpolated physics transform + wheel state
  update(dt, pos, quat) {
    this.group.position.copy(pos)
    this.group.quaternion.copy(quat)
    const vp = this.vp
    for (let i = 0; i < this.wheels.length; i++) {
      const w = this.wheels[i]
      const s = vp.wheelState(i)
      w.pivot.position.set(w.base.x, w.base.y - s.suspension, w.base.z)
      w.pivot.rotation.y = s.steering
      w.spin.rotation.x = s.rotation
    }

    const night = U.uNight.value
    const braking = vp.braking > 0.05 || (vp.handbrake && Math.abs(vp.speed) > 1)
    this.prevBrake = damp(this.prevBrake, braking ? 1 : 0, 18, dt)
    this.tailMat.emissiveIntensity = 0.5 + night * 1.2 + this.prevBrake * 4.5
    this.reverseMat.emissiveIntensity = vp.gear === -1 && vp.throttle > 0.05 ? 3 : 0
    this.headMat.emissiveIntensity = 1.0 + night * 5
    this.barMat.emissiveIntensity = 0.2 + night * 3.5
    for (const b of this.beams) b.intensity = night * 70 + U.uRain.value * 12

    // Flag flutters with speed
    const arr = this.flagGeo.attributes.position.array
    const t = U.uTime.value
    const amp = 0.03 + Math.min(Math.abs(vp.speed) / 25, 1) * 0.06
    for (let i = 0; i < arr.length; i += 3) {
      const x = this.flagBase[i]
      arr[i + 2] = this.flagBase[i + 2] + Math.sin(t * 14 - x * 18) * amp * (x / 0.3)
    }
    this.flagGeo.attributes.position.needsUpdate = true
    this.flag.rotation.y = Math.PI / 2 + Math.min(Math.abs(vp.speed) / 20, 1) * 0.3
  }
}
