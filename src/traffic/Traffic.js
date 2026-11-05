// Town traffic: NPC cars driving lane loops around blocks (and the ring road), keeping
// right, slowing for corners, braking for the player, pedestrians on crosswalks and the
// car ahead. Each car is a kinematic body, so you can bump it; a rammed driver stops,
// honks and shakes a fist before driving on. Drivers are visible townspeople.
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { GRID, WORLD } from '../world/Layout.js'
import { makeCharacter } from '../characters/Rig.js'
import { EMOTE } from '../characters/Emotes.js'
import { U } from '../world/Uniforms.js'
import { wettable } from '../world/Props.js'
import { makeRandom, clamp, damp, angleDelta } from '../core/math.js'

const COLORS = ['#d84b3a', '#2f8f95', '#e8a33a', '#4a7bd0', '#f2f0ea', '#5aa05a', '#3d4f7a', '#8a5bd0', '#2a2626', '#c9875e', '#9fb1c4']
const LANE = 1.9

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

function carGeometry(kind, color) {
  const parts = []
  const box = (w, h, d, x, y, z, c, lit = 0) => parts.push(colored(new THREE.BoxGeometry(w, h, d).translate(x, y, z), c, lit))
  if (kind === 'van') {
    box(1.8, 1.5, 4.2, 0, 1.15, 0, color)
    box(1.82, 0.6, 1.2, 0, 1.5, 1.5, '#2c3a44')
    box(1.84, 0.5, 2.6, 0, 1.5, -0.5, '#2c3a44')
  } else {
    box(1.75, 0.6, 4.0, 0, 0.72, 0, color)
    box(1.55, 0.55, 2.1, 0, 1.28, kind === 'hatch' ? -0.3 : -0.15, color)
    box(1.58, 0.42, 1.95, 0, 1.3, kind === 'hatch' ? -0.3 : -0.15, '#2c3a44')
  }
  box(1.8, 0.22, 0.2, 0, 0.5, 2.05, '#2a2626')
  box(1.8, 0.22, 0.2, 0, 0.5, -2.05, '#2a2626')
  box(0.32, 0.14, 0.05, 0.62, 0.82, 2.04, '#fff3d0', 1)
  box(0.32, 0.14, 0.05, -0.62, 0.82, 2.04, '#fff3d0', 1)
  box(0.3, 0.14, 0.05, 0.64, 0.82, -2.04, '#ff3a2a', 2)
  box(0.3, 0.14, 0.05, -0.64, 0.82, -2.04, '#ff3a2a', 2)
  for (const [x, z] of [[0.82, 1.3], [-0.82, 1.3], [0.82, -1.3], [-0.82, -1.3]]) parts.push(colored(new THREE.CylinderGeometry(0.36, 0.36, 0.28, 14).rotateZ(Math.PI / 2).translate(x, 0.36, z), '#1e1e1e'))
  return mergeGeometries(parts)
}

export class Traffic {
  constructor(scene, physics, layout, rig, quality) {
    this.scene = scene
    this.physics = physics
    this.layout = layout
    this.rnd = makeRandom(515)
    this.cars = []
    const mat = wettable(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.15, emissive: 0xffffff }))
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uNight = U.uNight
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float aLit;\nvarying float vLit;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvLit = aLit;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uNight;\nvarying float vLit;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance = (vLit > 1.5 ? vec3(1.0, 0.15, 0.1) * (0.6 + uNight * 2.0) : vec3(1.0, 0.9, 0.7) * (0.2 + uNight * 3.0)) * step(0.5, vLit);')
    }
    const count = quality.name === 'low' ? 8 : 14
    const loops = this.makeLoops()
    for (let i = 0; i < count; i++) {
      const loop = loops[i % loops.length]
      const kind = this.rnd.pick(['sedan', 'sedan', 'hatch', 'van'])
      const mesh = new THREE.Mesh(carGeometry(kind, this.rnd.pick(COLORS)), mat)
      mesh.castShadow = true
      mesh.receiveShadow = true
      scene.add(mesh)
      const R = physics.RAPIER
      const body = physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased())
      physics.tag(physics.world.createCollider(R.ColliderDesc.cuboid(0.9, kind === 'van' ? 0.95 : 0.7, 2.05).setTranslation(0, kind === 'van' ? 1.0 : 0.8, 0), body), { kind: 'traffic', material: 'metal' })
      const driver = rig.add(makeCharacter(this.rnd, { kind: 'adult' }))
      driver.noReact = true
      driver.drive = 1
      const car = { kind, mesh, body, driver, loop, s: (i / count) * loop.total * 3 % loop.total + this.rnd.range(0, 20), speed: 0, max: this.rnd.range(8, 11), stopped: 0, honk: 0, pos: new THREE.Vector3(), heading: 0 }
      this.cars.push(car)
    }
    this._t = new THREE.Vector3()
    this._p = new THREE.Vector3()
  }

  // Closed lane loops (clockwise around a few blocks + the ring road), driving on the right
  makeLoops() {
    const rects = [
      [GRID[0], GRID[0], GRID[7], GRID[7]],
      [GRID[1], GRID[2], GRID[3], GRID[4]],
      [GRID[3], GRID[3], GRID[5], GRID[5]],
      [GRID[2], GRID[4], GRID[4], GRID[6]],
      [GRID[4], GRID[4], GRID[6], GRID[6]],
      [GRID[1], GRID[0], GRID[3], GRID[2]],
      [GRID[5], GRID[0], GRID[7], GRID[2]],
      [GRID[0], GRID[4], GRID[2], GRID[6]],
    ]
    return rects.map(([x0, z0, x1, z1]) => {
      // counter-clockwise when viewed from above with +z north => right-hand traffic keeps the block on the left
      const o = LANE
      const corners = [[x0 + o, z0 + o], [x1 - o, z0 + o], [x1 - o, z1 - o], [x0 + o, z1 - o]]
      const pts = []
      const r = 6
      for (let k = 0; k < 4; k++) {
        const [ax, az] = corners[k]
        const [bx, bz] = corners[(k + 1) % 4]
        const len = Math.hypot(bx - ax, bz - az)
        const dx = (bx - ax) / len, dz = (bz - az) / len
        const n = Math.ceil((len - 2 * r) / 2)
        for (let i = 0; i <= n; i++) pts.push(new THREE.Vector3(ax + dx * (r + (i / n) * (len - 2 * r)), 0, az + dz * (r + (i / n) * (len - 2 * r))))
        // rounded corner
        const [cx2, cz2] = corners[(k + 2) % 4]
        const len2 = Math.hypot(cx2 - bx, cz2 - bz)
        const ex = (cx2 - bx) / len2, ez = (cz2 - bz) / len2
        for (let i = 1; i < 6; i++) {
          const t = i / 6
          const p0x = bx - dx * r, p0z = bz - dz * r, p2x = bx + ex * r, p2z = bz + ez * r
          pts.push(new THREE.Vector3((1 - t) ** 2 * p0x + 2 * (1 - t) * t * bx + t * t * p2x, 0, (1 - t) ** 2 * p0z + 2 * (1 - t) * t * bz + t * t * p2z))
        }
      }
      for (const p of pts) p.y = this.layout.getDriveHeight(p.x, p.z)
      const len = [0]
      for (let i = 1; i <= pts.length; i++) len.push(len[i - 1] + pts[i % pts.length].distanceTo(pts[i - 1]))
      return { pts, len, total: len[len.length - 1] }
    })
  }

  sample(loop, s, out, tan) {
    s = ((s % loop.total) + loop.total) % loop.total
    let lo = 0, hi = loop.len.length - 1
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1
      if (loop.len[m] < s) lo = m
      else hi = m
    }
    const a = loop.pts[lo % loop.pts.length], b = loop.pts[hi % loop.pts.length]
    const t = (s - loop.len[lo]) / (loop.len[hi] - loop.len[lo] || 1)
    out.copy(a).lerp(b, t)
    tan.copy(b).sub(a).normalize()
  }

  // obstacles: [{x,z,speed?}] — player vehicle, people on the road, other cars
  update(dt, ctx) {
    const { player, walkers } = ctx
    for (const c of this.cars) {
      // look ahead for anything in our lane
      const fx = Math.sin(c.heading), fz = Math.cos(c.heading)
      let gap = 40
      const check = (x, z, w = 1.6) => {
        const dx = x - c.pos.x, dz = z - c.pos.z
        const ahead = dx * fx + dz * fz
        const side = Math.abs(dx * fz - dz * fx)
        if (ahead > 0 && ahead < gap && side < w) gap = ahead
      }
      if (player) check(player.x, player.z, 2.0)
      for (const o of this.cars) if (o !== c) check(o.pos.x, o.pos.z, 1.5)
      for (const w of walkers) if (w.visible && (w.crossing || w.reaction || w.isPlayer)) check(w.x, w.z, 1.8)
      // slow for corners
      this.sample(c.loop, c.s + 10, this._p, this._t)
      const turn = Math.abs(angleDelta(c.heading, Math.atan2(this._t.x, this._t.z)))
      let target = c.max * (1 - clamp(turn / 1.2, 0, 0.6))
      if (gap < 14) target = Math.min(target, Math.max(0, (gap - 5) * 0.8))
      if (c.stopped > 0) {
        c.stopped -= dt
        target = 0
      }
      c.speed += clamp(target - c.speed, -9 * dt, 3 * dt)
      c.s += c.speed * dt
      this.sample(c.loop, c.s, c.pos, this._t)
      c.heading = Math.atan2(this._t.x, this._t.z)
      c.pos.y = this.layout.getDriveHeight(c.pos.x, c.pos.z)
      c.mesh.position.copy(c.pos)
      c.mesh.rotation.y = c.heading
      const q = c.mesh.quaternion
      c.body.setNextKinematicTranslation({ x: c.pos.x, y: c.pos.y, z: c.pos.z })
      c.body.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      // driver
      const d = c.driver
      const off = 0.38
      d.x = c.pos.x + Math.cos(c.heading) * off - fx * 0.2
      d.z = c.pos.z - Math.sin(c.heading) * off - fz * 0.2
      d.y = c.pos.y + (c.kind === 'van' ? 0.55 : 0.3)
      d.heading = c.heading
      d.steer = 0
      d.fist = c.honk > 0 ? 1 : 0
      c.honk = Math.max(0, c.honk - dt)
    }
  }

  // The player rammed a traffic car: it stops, honks, the driver gets cross
  rammed(body, emotes, onHonk) {
    const c = this.cars.find((k) => k.body === body)
    if (!c || c.honk > 0) return
    c.stopped = 2.5
    c.honk = 2
    emotes.show(c.driver, EMOTE.angry, 2)
    onHonk?.(c.pos.x, c.pos.z)
  }

  near(x, z, r) {
    return this.cars.some((c) => c.speed > 1 && (c.pos.x - x) ** 2 + (c.pos.z - z) ** 2 < r * r)
  }
}

export { WORLD, damp }
