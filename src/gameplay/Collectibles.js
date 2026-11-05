// 25 glowing "embers" hidden around the valley. Progress is saved between visits.
import * as THREE from 'three'
import { U } from '../world/Uniforms.js'

const SPOTS = [
  [10, 40], [44, 45], [67, 17], [59, -27], 'bridge', [4, -61], [-51, -31], [-63, 25], [-21, 44],
  'ramp0', 'ramp1', 'ramp2', [-29, 21], [2, 6], 'pyramid', [27, 27], [31, -4], [-15, -9],
  [80, -56], [30, -40], [78, 62], [-82, 70], [86, -38], [-74, -86], [-42, 32],
]

export class Collectibles {
  constructor(scene, layout, props) {
    this.layout = layout
    this.items = []
    let saved = []
    try { saved = JSON.parse(localStorage.getItem('sv-embers') || '[]') } catch {}
    this.collected = new Set(saved)
    this.listeners = {}

    const coreGeo = new THREE.OctahedronGeometry(0.32, 0)
    const ringGeo = new THREE.TorusGeometry(0.62, 0.035, 8, 40)
    const beamGeo = new THREE.CylinderGeometry(0.12, 0.35, 7, 16, 1, true).translate(0, 3.5, 0)
    this.coreMat = new THREE.MeshStandardMaterial({ color: 0xffd38a, emissive: 0xffa53a, emissiveIntensity: 3.2, roughness: 0.3 })
    this.ringMat = new THREE.MeshStandardMaterial({ color: 0xfff0d0, emissive: 0xffc070, emissiveIntensity: 1.6, roughness: 0.4, metalness: 0.4 })
    this.beamMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uTime: U.uTime, uNight: U.uNight },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `varying vec2 vUv; uniform float uTime, uNight;
        void main(){ float a = pow(1.0 - vUv.y, 2.0) * (0.6 + 0.4 * sin(uTime * 3.0 + vUv.y * 10.0)); gl_FragColor = vec4(vec3(1.0, 0.62, 0.28) * a * (0.08 + uNight * 0.1), 1.0); }`,
    })

    SPOTS.forEach((spot, i) => {
      let x, y, z
      if (spot === 'bridge') {
        const f = layout.roadFrame(layout.bridge.index)
        x = f.x; z = f.z; y = f.y + 1.2
      } else if (typeof spot === 'string' && spot.startsWith('ramp')) {
        const r = props.ramps[+spot.slice(4)]
        x = r.top.x + Math.sin(r.heading) * 7
        z = r.top.z + Math.cos(r.heading) * 7
        y = r.top.y + 2.6
      } else if (spot === 'pyramid') {
        x = -34; z = -29.5; y = layout.getHeight(x, z) + 4.2
      } else {
        ;[x, z] = spot
        y = layout.getDriveHeight(x, z) + 1.15
      }
      const g = new THREE.Group()
      g.position.set(x, y, z)
      const core = new THREE.Mesh(coreGeo, this.coreMat)
      const ring = new THREE.Mesh(ringGeo, this.ringMat)
      const beam = new THREE.Mesh(beamGeo, this.beamMat)
      beam.position.y = -0.4
      g.add(core, ring, beam)
      scene.add(g)
      layout.occupy(x, z, 2)
      const item = { i, group: g, core, ring, pos: new THREE.Vector3(x, y, z), taken: this.collected.has(i), anim: 0 }
      g.visible = !item.taken
      this.items.push(item)
    })
  }

  get count() {
    return this.collected.size
  }

  get total() {
    return this.items.length
  }

  on(name, fn) {
    ;(this.listeners[name] ||= []).push(fn)
  }

  emit(name, ...a) {
    for (const fn of this.listeners[name] || []) fn(...a)
  }

  reset() {
    this.collected.clear()
    this.save()
    for (const it of this.items) {
      it.taken = false
      it.anim = 0
      it.group.visible = true
      it.group.scale.setScalar(1)
    }
  }

  save() {
    try { localStorage.setItem('sv-embers', JSON.stringify([...this.collected])) } catch {}
  }

  update(dt, time, carPos) {
    for (const it of this.items) {
      if (it.taken) {
        if (it.anim > 0) {
          it.anim = Math.max(0, it.anim - dt * 2.5)
          it.group.scale.setScalar(it.anim * 1.6)
          it.group.position.y += dt * 3
          if (it.anim === 0) it.group.visible = false
        }
        continue
      }
      it.core.rotation.y = time * 1.6 + it.i
      it.core.position.y = Math.sin(time * 2 + it.i) * 0.15
      it.ring.rotation.x = Math.PI / 2 + Math.sin(time * 0.8 + it.i) * 0.4
      it.ring.rotation.y = time * 0.9
      const dx = carPos.x - it.pos.x, dy = carPos.y - it.pos.y, dz = carPos.z - it.pos.z
      if (dx * dx + dz * dz < 2.6 * 2.6 && Math.abs(dy) < 3) {
        it.taken = true
        it.anim = 1
        this.collected.add(it.i)
        this.save()
        this.emit('collect', it, this.count, this.total)
        if (this.count === this.total) this.emit('complete')
      }
    }
  }
}
