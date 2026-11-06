// Shared car bodies: town traffic, drivable sedans / vans (carjacked from traffic) and
// police cars with a flashing light bar. Geometry is merged per car with per-vertex colour
// and an aLit code: 1 head lights, 2 tail lights, 3 / 4 siren red / blue.
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { CAR } from './VehiclePhysics.js'
import { U } from '../world/Uniforms.js'
import { wettable } from '../world/Props.js'
import { damp } from '../core/math.js'

function colored(geo, color, lit = 0) {
  const g = geo.index ? geo.toNonIndexed() : geo
  const n = g.attributes.position.count
  const c = new THREE.Color(color)
  const col = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3)
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  g.setAttribute('aLit', new THREE.BufferAttribute(new Float32Array(n).fill(lit), 1))
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color', 'aLit'].includes(k)) g.deleteAttribute(k)
  return g
}

// kind: sedan | hatch | van | police | army ; wheels: include static wheels (traffic)
export function carGeometry(kind, color, { wheels = true } = {}) {
  const parts = []
  const box = (w, h, d, x, y, z, c, lit = 0) => parts.push(colored(new THREE.BoxGeometry(w, h, d).translate(x, y, z), c, lit))
  if (kind === 'van') {
    box(1.8, 1.5, 4.2, 0, 1.15, 0, color)
    box(1.82, 0.6, 1.2, 0, 1.5, 1.5, '#2c3a44')
    box(1.84, 0.5, 2.6, 0, 1.5, -0.5, '#2c3a44')
  } else if (kind === 'army') {
    box(1.9, 0.8, 4.3, 0, 0.85, 0, color)
    box(1.7, 0.7, 1.4, 0, 1.55, 0.9, color)
    box(1.72, 0.45, 1.2, 0, 1.6, 0.95, '#2c3a44')
    box(1.9, 0.9, 2.2, 0, 1.6, -1.0, '#4f5b3a')
  } else {
    box(1.75, 0.6, 4.0, 0, 0.72, 0, color)
    box(1.55, 0.55, 2.1, 0, 1.28, kind === 'hatch' ? -0.3 : -0.15, kind === 'police' ? '#f2f0ea' : color)
    box(1.58, 0.42, 1.95, 0, 1.3, kind === 'hatch' ? -0.3 : -0.15, '#2c3a44')
  }
  if (kind === 'police') {
    // white doors, light bar, push bar
    box(1.77, 0.32, 1.9, 0, 0.72, -0.1, '#f2f0ea')
    box(1.2, 0.12, 0.34, 0, 1.6, -0.1, '#202020')
    box(0.5, 0.14, 0.3, -0.3, 1.71, -0.1, '#ff2020', 3)
    box(0.5, 0.14, 0.3, 0.3, 1.71, -0.1, '#2050ff', 4)
    box(1.5, 0.35, 0.1, 0, 0.55, 2.12, '#202020')
  }
  box(1.8, 0.22, 0.2, 0, 0.5, 2.05, '#2a2626')
  box(1.8, 0.22, 0.2, 0, 0.5, -2.05, '#2a2626')
  box(0.32, 0.14, 0.05, 0.62, 0.82, 2.04, '#fff3d0', 1)
  box(0.32, 0.14, 0.05, -0.62, 0.82, 2.04, '#fff3d0', 1)
  box(0.3, 0.14, 0.05, 0.64, 0.82, -2.04, '#ff3a2a', 2)
  box(0.3, 0.14, 0.05, -0.64, 0.82, -2.04, '#ff3a2a', 2)
  if (wheels) for (const [x, z] of [[0.82, 1.3], [-0.82, 1.3], [0.82, -1.3], [-0.82, -1.3]]) parts.push(colored(new THREE.CylinderGeometry(0.36, 0.36, 0.28, 14).rotateZ(Math.PI / 2).translate(x, 0.36, z), '#1e1e1e'))
  return mergeGeometries(parts)
}

// Car paint with emissive lights; `siren` is a per-material uniform (0 off, 1 flashing)
export function carMaterial({ siren = false, burnt = false } = {}) {
  const mat = wettable(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: burnt ? 0.95 : 0.45, metalness: burnt ? 0 : 0.15, emissive: 0xffffff, color: burnt ? 0x2a2622 : 0xffffff }))
  mat.userData.siren = { value: 0 }
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = U.uNight
    shader.uniforms.uTime = U.uTime
    shader.uniforms.uSiren = mat.userData.siren
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float aLit;\nvarying float vLit;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvLit = aLit;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight, uTime, uSiren;\nvarying float vLit;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float fl = step(0.5, fract(uTime * 2.6));
        vec3 sirenCol = vLit > 3.5 ? vec3(0.3, 0.5, 6.0) * (1.0 - fl) : vec3(6.0, 0.4, 0.3) * fl;
        totalEmissiveRadiance = vLit > 2.5 ? sirenCol * uSiren : (vLit > 1.5 ? vec3(1.0, 0.15, 0.1) * (0.6 + uNight * 2.0) : vec3(1.0, 0.9, 0.7) * (0.2 + uNight * 3.0)) * step(0.5, vLit) * ${burnt ? '0.0' : '1.0'};`)
  }
  if (!siren) mat.userData.shared = true
  return mat
}

let sharedMat = null
let burntMat = null
export function trafficMaterial() {
  return (sharedMat ||= carMaterial())
}
export function burntMaterial() {
  return (burntMat ||= carMaterial({ burnt: true }))
}

// Drivable versions of the traffic cars (raycast vehicle tuned heavier than the buggy)
const sedanWheels = [
  { x: 0.8, y: 0, z: 1.3, front: true }, { x: -0.8, y: 0, z: 1.3, front: true },
  { x: 0.8, y: 0, z: -1.3, front: false }, { x: -0.8, y: 0, z: -1.3, front: false },
]
export const SEDAN = {
  ...CAR, kind: 'car', mass: 1250, com: { x: 0, y: -0.25, z: 0 }, inertia: { x: 1500, y: 1700, z: 650 },
  wheelRadius: 0.36, restLength: 0.32, wheels: sedanWheels,
  chassis: { hx: 0.88, hy: 0.32, hz: 2.0, y: 0.22 }, cabin: { hx: 0.76, hy: 0.3, hz: 1.0, y: 0.82, z: -0.15 },
  gears: [38, 22, 14.5, 10.6, 8.2, 6.6], torque: 175, drag: 0.32, brake: 95, frontShare: 0.0, steerLow: 0.55, steerHigh: 0.12,
  vmax: 46, vmaxNitro: 0, nitroTime: 0, health: 900, sound: 'car', yawAssist: 3.6,
}
export const VAN = { ...SEDAN, mass: 1700, inertia: { x: 2200, y: 2500, z: 900 }, chassis: { hx: 0.9, hy: 0.6, hz: 2.05, y: 0.5 }, cabin: null, torque: 185, vmax: 38, health: 1100 }
export const POLICE_CAR = { ...SEDAN, torque: 230, vmax: 54, health: 1200, nitroTime: 4, nitroRecharge: 10, nitroForce: 1.8, nitroPush: 2.5, vmaxNitro: 60 }

// Visual for a drivable sedan / van / police car: body mesh + spinning, steering wheels
export class SedanVisual {
  constructor(scene, vp, kind, color, material = trafficMaterial()) {
    this.vp = vp
    this.kind = kind
    this.group = new THREE.Group()
    scene.add(this.group)
    const yOff = -(vp.cfg.restLength * 0.75 + vp.wheelRadius) + 0.02
    this.body = new THREE.Mesh(carGeometry(kind, color, { wheels: false }), material)
    this.body.position.y = yOff
    this.body.castShadow = true
    this.body.receiveShadow = true
    this.group.add(this.body)
    this.material = material
    const wheelGeo = new THREE.CylinderGeometry(vp.wheelRadius, vp.wheelRadius, 0.28, 16).rotateZ(Math.PI / 2)
    const tyre = new THREE.MeshStandardMaterial({ color: 0x1e1e1e, roughness: 0.9 })
    const hubGeo = new THREE.CylinderGeometry(vp.wheelRadius * 0.55, vp.wheelRadius * 0.55, 0.3, 10).rotateZ(Math.PI / 2)
    const hub = new THREE.MeshStandardMaterial({ color: 0xb9b4ad, roughness: 0.4, metalness: 0.6 })
    this.wheels = vp.wheelPositions.map((wp) => {
      const pivot = new THREE.Group()
      const spin = new THREE.Group()
      pivot.add(spin)
      const t = new THREE.Mesh(wheelGeo, tyre)
      t.castShadow = true
      spin.add(t, new THREE.Mesh(hubGeo, hub))
      this.group.add(pivot)
      return { pivot, spin, base: wp }
    })
    this.exhaustLocal = new THREE.Vector3(-0.55, yOff + 0.35, -2.1)
    this.seat = new THREE.Vector3(0.38, 0.55, -0.2)
    this.siren = false
  }

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
    if (this.material.userData.siren) this.material.userData.siren.value = damp(this.material.userData.siren.value, this.siren ? 1 : 0, 10, dt)
  }

  setBurnt(on) {
    this.body.material = on ? burntMaterial() : this.material
  }
}
