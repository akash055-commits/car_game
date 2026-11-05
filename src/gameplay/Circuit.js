// Lap timing: start/finish line + 6 checkpoint gates that must be passed in order.
import * as THREE from 'three'
import { WORLD } from '../world/Layout.js'

const GATES = 6

export class Circuit {
  constructor(scene, layout) {
    this.layout = layout
    const N = layout.roadCount
    this.gates = []
    for (let k = 1; k <= GATES; k++) this.gates.push(Math.round((N * k) / (GATES + 1)))
    this.next = 0 // index into gates; GATES means "head for the finish"
    this.running = false
    this.lapStart = 0
    this.lap = 0
    this.lastLap = null
    let best = null
    try { best = parseFloat(localStorage.getItem('sv-best-lap')) || null } catch {}
    this.best = best
    this.lastIndex = -1
    this.listeners = {}
    this.time = 0

    // Gate posts with glowing caps
    const postGeo = new THREE.CylinderGeometry(0.1, 0.12, 2.6, 8).translate(0, 1.3, 0)
    const orbGeo = new THREE.SphereGeometry(0.2, 16, 12)
    const postMat = new THREE.MeshStandardMaterial({ color: 0x3b3532, roughness: 0.6 })
    this.gateMeshes = this.gates.map((i) => {
      const f = layout.roadFrame(i)
      const g = new THREE.Group()
      const mat = new THREE.MeshStandardMaterial({ color: 0x7fe3d4, emissive: 0x4fe0c8, emissiveIntensity: 2 })
      for (const side of [-1, 1]) {
        const x = f.x - f.tz * side * (WORLD.roadHalfWidth + 0.7), z = f.z + f.tx * side * (WORLD.roadHalfWidth + 0.7)
        const y = layout.getDriveHeight(x, z)
        const post = new THREE.Mesh(postGeo, postMat)
        post.position.set(x, y, z)
        post.castShadow = true
        const orb = new THREE.Mesh(orbGeo, mat)
        orb.position.set(x, y + 2.75, z)
        g.add(post, orb)
        layout.occupy(x, z, 0.8)
      }
      scene.add(g)
      return { group: g, mat }
    })
    this.refreshGates()
  }

  on(name, fn) {
    ;(this.listeners[name] ||= []).push(fn)
  }

  emit(name, ...a) {
    for (const fn of this.listeners[name] || []) fn(...a)
  }

  refreshGates() {
    this.gateMeshes.forEach((g, k) => {
      const active = this.running && k === this.next
      const done = this.running && k < this.next
      g.mat.emissive.set(active ? 0x4fe0c8 : done ? 0xffb35a : 0x6d7a78)
      g.mat.emissiveIntensity = active ? 3.5 : done ? 1.6 : 0.3
    })
  }

  crossed(prev, curr, target) {
    const L = this.layout
    const dPrev = L.ringDelta(prev, target)
    const dCurr = L.ringDelta(curr, target)
    return dPrev < 0 && dCurr >= 0 && dCurr - dPrev < 40
  }

  update(elapsed, carPos) {
    this.time = elapsed
    const q = this.layout.queryRoad(carPos.x, carPos.z)
    if (q.i < 0 || q.d > WORLD.roadHalfWidth + 4) return
    const prev = this.lastIndex
    this.lastIndex = q.i
    if (prev < 0) return

    if (this.running && this.next < GATES && this.crossed(prev, q.i, this.gates[this.next])) {
      this.next++
      this.refreshGates()
      this.emit('checkpoint', this.next, elapsed - this.lapStart)
    }
    if (this.crossed(prev, q.i, 0)) {
      if (this.running && this.next === GATES) {
        const t = elapsed - this.lapStart
        this.lastLap = t
        const isBest = this.best === null || t < this.best
        if (isBest) {
          this.best = t
          try { localStorage.setItem('sv-best-lap', String(t)) } catch {}
        }
        this.emit('lap', t, isBest, this.lap)
      } else if (this.running) {
        this.emit('invalid')
      }
      this.running = true
      this.lap++
      this.lapStart = elapsed
      this.next = 0
      this.refreshGates()
      this.emit('start', this.lap)
    }
  }

  get current() {
    return this.running ? this.time - this.lapStart : 0
  }

  reset() {
    this.running = false
    this.next = 0
    this.lastIndex = -1
    this.refreshGates()
  }
}

export function formatTime(t) {
  if (t === null || t === undefined) return '--:--.--'
  const m = Math.floor(t / 60)
  const s = t - m * 60
  return `${m}:${s.toFixed(2).padStart(5, '0')}`
}
