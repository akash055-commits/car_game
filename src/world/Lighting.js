// Sun/moon + hemisphere light. The shadow camera follows the view focus with a tight
// frustum and texel snapping, so shadows are crisp everywhere without shimmering.
import * as THREE from 'three'
import { U } from './Uniforms.js'

export class Lighting {
  constructor(scene, quality) {
    this.hemi = new THREE.HemisphereLight(0xffe6c8, 0x6b4a2a, 1.1)
    scene.add(this.hemi)

    const sun = new THREE.DirectionalLight(0xffe0b8, 2.6)
    sun.castShadow = true
    const s = quality.shadowMap
    sun.shadow.mapSize.set(s, s)
    const ext = 34
    Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 220 })
    sun.shadow.bias = -0.0004
    sun.shadow.normalBias = 0.04
    sun.shadow.radius = 3
    scene.add(sun)
    scene.add(sun.target)
    this.sun = sun
    this.extent = ext
    this._tmp = new THREE.Vector3()
  }

  update(focus) {
    const dir = U.uSunDir.value
    // Below the horizon the light becomes moonlight from the opposite side
    const light = this._tmp.copy(dir)
    if (light.y < 0.12) light.set(-dir.x * 0.6, 0.75, -dir.z * 0.6).normalize()
    // Snap the focus to shadow texels to avoid swimming edges
    const texel = (this.extent * 2) / this.sun.shadow.mapSize.x
    const fx = Math.round(focus.x / texel) * texel
    const fz = Math.round(focus.z / texel) * texel
    this.sun.target.position.set(fx, focus.y, fz)
    this.sun.position.set(fx + light.x * 90, focus.y + light.y * 90, fz + light.z * 90)
    this.sun.target.updateMatrixWorld()
  }
}
