// District builders for the towns beyond Maple Hollow (Harbor Bay, Pine Ridge,
// Dustwater) and the Fort Granite military base. Mixed into Town.prototype so they share
// its batching, collider and placement helpers.
import * as THREE from 'three'
import { prism } from './Town.js'
import { FORT } from './Regions.js'
import { WORLD } from './Layout.js'

const HW = WORLD.roadHalfWidth
const SW = WORLD.sidewalk
const CONTAINERS = ['#c8462f', '#2f6f95', '#e8a33a', '#3f7a4a', '#7a3b6a', '#d8d0c4', '#2a5a7a', '#b5553a']
const ARMY = '#5d6b45'
const ARMY_DARK = '#454f35'

export const TownExtra = {
  // Harbor Bay: container stacks, a gantry crane, bollards and a pier out over the sea
  buildDocks(b) {
    const L = this.layout
    const r = this.rnd
    L.addZone({ type: 'paved', shape: 'rect', x0: b.ix0 - 0.2, x1: b.ix1 + 0.2, z0: b.iz0 - 0.2, z1: b.iz1 + 0.2 })
    // container rows
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 2; col++) {
        const x = b.ix0 + 8 + col * 14, z = b.iz0 + 7 + row * 12
        const stack = 1 + Math.floor(r.random() * 3)
        const y = L.getHeight(x, z)
        const base = this.baseMatrix(x, z, 0, y)
        for (let k = 0; k < stack; k++) {
          const c = r.pick(CONTAINERS)
          this.box(this.solid, base, 0, 1.3 + k * 2.62, 0, 12, 2.6, 2.5, c)
          for (let rib = -5; rib <= 5; rib++) this.box(this.solid, base, rib, 1.3 + k * 2.62, 1.27, 0.08, 2.4, 0.05, c)
        }
        this.collider(x, y + stack * 1.31, z, 6, stack * 1.31, 1.25, 0, 'metal')
        L.occupy(x, z, 6.5)
      }
    }
    // gantry crane straddling the quay edge (one per docks column, on alternate blocks)
    if (b.bz % 2 === 0) {
      const x = b.ix1 - 6, z = b.cz
      const y = L.getHeight(x, z)
      const base = this.baseMatrix(x, z, 0, y)
      for (const sx of [-5, 5]) for (const sz of [-6, 6]) {
        this.box(this.solid, base, sx, 9, sz, 0.8, 18, 0.8, '#e8a33a')
        this.collider(x + sx, y + 9, z + sz, 0.4, 9, 0.4, 0, 'metal')
      }
      this.box(this.solid, base, 0, 18.5, 0, 11, 1.2, 13.5, '#e8a33a')
      this.box(this.solid, base, 18, 18.5, 0, 30, 0.9, 1.6, '#d89a2a')
      this.box(this.solid, base, 4, 20.5, 0, 4, 3, 3, '#3b3532')
      this.box(this.solid, base, 22, 14, 0, 0.1, 9, 0.1, '#2a2626')
      this.box(this.solid, base, 22, 9.4, 0, 2.6, 0.3, 2.4, '#3b3532')
      L.occupy(x, z, 9)
    }
    // pier out into the sea
    const pz = b.cz
    const deckY = 1.15
    const x0 = b.x1 + HW + 1, x1 = 735
    const len = x1 - x0
    const pb = this.baseMatrix((x0 + x1) / 2, pz, 0, deckY)
    this.box(this.solid, pb, 0, -0.15, 0, len, 0.3, 7, '#8a6a4a')
    for (let k = 0; k <= len; k += 6) for (const sz of [-3.2, 3.2]) this.box(this.solid, pb, -len / 2 + k, -1.6, sz, 0.45, 3.2, 0.45, '#5a4430')
    for (const sz of [-3.4, 3.4]) this.box(this.solid, pb, 0, 0.45, sz, len, 0.1, 0.1, '#e9e2d6')
    const body = this.physics.world.createRigidBody(this.R.RigidBodyDesc.fixed().setTranslation((x0 + x1) / 2, deckY - 0.15, pz))
    this.physics.tag(this.physics.world.createCollider(this.R.ColliderDesc.cuboid(len / 2, 0.15, 3.5).setFriction(0.8), body), { kind: 'building', material: 'wood' })
    this.piers.push({ x0, x1, z: pz, y: deckY })
    // a moored fishing boat
    const bx = x0 + len * 0.6, bz = pz + (b.bz % 2 ? 7.5 : -7.5)
    const bb = this.baseMatrix(bx, bz, Math.PI / 2, WORLD.waterLevel)
    this.box(this.solid, bb, 0, 0.4, 0, 3.2, 1.6, 9, r.pick(['#2f6f95', '#c8462f', '#f2ece2']))
    this.box(this.solid, bb, 0, 1.6, -1.5, 2.4, 1.6, 3, '#f2ece2')
    this.box(this.solid, bb, 0, 4, 1.5, 0.15, 5, 0.15, '#6e4228')
    this.collider(bx, WORLD.waterLevel + 0.8, bz, 4.5, 1, 1.6, Math.PI / 2, 'wood')
    if (b.bz === 0) this.places.push({ name: 'Harbor Docks', kind: 'landmark', x: b.cx, z: b.cz, door: { x: b.ix0 + 1, z: b.cz }, rot: -Math.PI / 2, street: this.streetFor(b, 'w') })
    // lighthouse at the end of the last pier
    if (b.bz === 3) {
      const lx = 742, lz = pz
      const ly = deckY
      const lb = this.baseMatrix(lx, lz, 0, ly - 0.3)
      for (let k = 0; k < 6; k++) this.solid.add(new THREE.CylinderGeometry(2.2 - k * 0.18, 2.4 - k * 0.18, 3, 16), this.mat(lb, 0, 1.5 + k * 3, 0, 1, 1, 1), k % 2 ? '#c8462f' : '#f8f1e4')
      this.glass.add(new THREE.CylinderGeometry(1.3, 1.3, 2, 12), this.mat(lb, 0, 19, 0, 1, 1, 1), '#fff1b0', 1)
      this.solid.add(new THREE.ConeGeometry(1.8, 2, 12), this.mat(lb, 0, 21, 0, 1, 1, 1), '#2a2626')
      const lbody = this.physics.world.createRigidBody(this.R.RigidBodyDesc.fixed().setTranslation(lx, ly + 9, lz))
      this.physics.tag(this.physics.world.createCollider(this.R.ColliderDesc.cylinder(10, 2.4), lbody), { kind: 'building', material: 'stone' })
      this.places.push({ name: 'Lighthouse', kind: 'landmark', x: lx, z: lz, door: { x: lx - 4, z: lz }, rot: -Math.PI / 2, street: 'Seawall Drive' })
    }
  },

  // Big sheds with roller doors
  buildWarehouse(b) {
    const L = this.layout
    const r = this.rnd
    L.addZone({ type: 'paved', shape: 'rect', x0: b.ix0 - 0.2, x1: b.ix1 + 0.2, z0: b.iz0 - 0.2, z1: b.iz1 + 0.2 })
    for (const sz of [-1, 1]) {
      const x = b.cx, z = b.cz + sz * 10
      const y = L.getHeight(x, z)
      const base = this.baseMatrix(x, z, sz > 0 ? 0 : Math.PI, y)
      const wall = r.pick(['#c9b9a6', '#b8c4cc', '#a9b6a5', '#d9d4cc'])
      this.box(this.solid, base, 0, 3.2, 0, 30, 8, 13, wall)
      this.solid.add(prism(30.6, 2.2, 13.6), this.mat(base, 0, 7.2, 0, 1, 1, 1), '#7d8a8c')
      for (let k = -1; k <= 1; k++) {
        this.box(this.solid, base, k * 9, 2.4, 6.55, 5.5, 4.8, 0.12, '#8a8580')
        for (let s = 0; s < 8; s++) this.box(this.solid, base, k * 9, 0.4 + s * 0.6, 6.62, 5.4, 0.05, 0.04, '#6f6a66')
      }
      this.collider(x, y + 3.8, z, 15, 4, 6.5, 0, 'metal')
      L.occupy(x, z, 15)
    }
    this.places.push({ name: `${this.townName(b)} Warehouses`, kind: 'landmark', x: b.cx, z: b.cz, door: { x: b.cx, z: b.iz0 + 1 }, rot: Math.PI, street: this.streetFor(b, 's') })
  },

  // A small hospital: respawn point when you're knocked out nearby
  buildClinic(b) {
    const place = this.bigBuilding(b, 'n', {
      w: 24, d: 12, floors: 2, wall: '#f2f0ea', name: 'Clinic',
      extras: (base, w, d, H) => {
        this.box(this.glass, base, w / 2 - 3.5, H - 1.4, d / 2 + 0.1, 2.2, 0.65, 0.08, '#e84a3a', 1)
        this.box(this.glass, base, w / 2 - 3.5, H - 1.4, d / 2 + 0.11, 0.65, 2.2, 0.08, '#e84a3a', 1)
      },
    })
    place.role = 'hospital'
    this.hospitals.push(place)
    // houses on the south side
    for (const lot of b.lots || []) if (lot.side === 's') this.house(lot, `${this.rnd.int(2, 80)} ${this.streetFor(b, 's')}`)
  },

  // Paved quayside plaza with a fish market
  buildPlaza(b) {
    const L = this.layout
    L.addZone({ type: 'paved', shape: 'rect', x0: b.ix0 - 0.2, x1: b.ix1 + 0.2, z0: b.iz0 - 0.2, z1: b.iz1 + 0.2 })
    const cols = ['#2f6f95', '#f2ece2', '#c8462f']
    for (let i = 0; i < 6; i++) {
      const x = b.cx - 12 + (i % 3) * 12, z = b.cz + (i < 3 ? -6 : 6)
      const y = L.getHeight(x, z)
      const base = this.baseMatrix(x, z, i < 3 ? 0 : Math.PI, y)
      for (const [px, pz] of [[-1.6, -1], [1.6, -1], [-1.6, 1], [1.6, 1]]) this.box(this.solid, base, px, 1.25, pz, 0.1, 2.5, 0.1, '#6e4228')
      for (let s = 0; s < 6; s++) this.box(this.solid, base, -1.75 + s * 0.7 + 0.35, 2.55, 0, 0.7, 0.06, 2.6, s % 2 ? cols[i % 3] : '#fbf6ec', 0, 0, 0.12)
      this.box(this.solid, base, 0, 0.85, 0.6, 3.2, 0.1, 1.0, '#9fb1c4')
      for (let k = 0; k < 6; k++) this.box(this.solid, base, -1.2 + (k % 3) * 1.2, 0.98, 0.4 + Math.floor(k / 3) * 0.4, 0.7, 0.08, 0.22, '#b8c4cc')
      this.collider(x, y + 0.6, z, 1.7, 0.6, 1.1, 0, 'wood')
      L.occupy(x, z, 2.2)
    }
    for (let k = 0; k < 4; k++) this.benches.push({ x: b.ix0 + 4 + k * 12, z: b.iz1 - 3, rot: Math.PI })
    for (const [tx, tz] of [[b.ix0 + 3, b.iz0 + 3], [b.ix1 - 3, b.iz0 + 3], [b.ix0 + 3, b.iz1 - 3], [b.ix1 - 3, b.iz1 - 3]]) this.treeSpots.push({ x: tx, z: tz, planter: true })
    this.places.push({ name: 'Fish Market', kind: 'landmark', x: b.cx, z: b.cz, door: { x: b.cx, z: b.iz0 + 1 }, rot: Math.PI, street: this.streetFor(b, 's') })
  },

  // Pine Ridge: timber lodge
  buildLodge(b) {
    const place = this.bigBuilding(b, 'n', {
      w: 28, d: 13, floors: 3, wall: '#8a5a3a', roof: '#3f4a3a', name: 'Summit Lodge',
      extras: (base, w, d) => {
        for (let f = 1; f < 3; f++) this.box(this.solid, base, 0, f * 3.4 + 0.1, d / 2 + 0.9, w - 2, 0.14, 1.6, '#6e4228')
        for (let i = 0; i < 7; i++) this.box(this.solid, base, -w / 2 + 2 + i * ((w - 4) / 6), 1.7, d / 2 + 1.6, 0.25, 3.4, 0.25, '#5a4430')
      },
    })
    place.kind = 'shop'
    this.shops.push(place)
    for (const lot of b.lots || []) if (lot.side === 's') this.house(lot, `${this.rnd.int(2, 60)} ${this.streetFor(b, 's')}`)
  },

  // Pine Ridge: open sawmill with log piles
  buildSawmill(b) {
    const L = this.layout
    L.addZone({ type: 'dirt', shape: 'rect', x0: b.ix0 + 0.5, x1: b.ix1 - 0.5, z0: b.iz0 + 0.5, z1: b.iz1 - 0.5 })
    const x = b.cx - 6, z = b.cz + 4
    const y = L.getHeight(x, z)
    const base = this.baseMatrix(x, z, 0, y)
    for (const [px, pz] of [[-9, -5], [9, -5], [-9, 5], [9, 5], [0, -5], [0, 5]]) this.box(this.solid, base, px, 2.5, pz, 0.4, 5, 0.4, '#6e4228')
    this.solid.add(prism(20, 2.4, 12), this.mat(base, 0, 5, 0, 1, 1, 1), '#5b6b7a')
    this.box(this.solid, base, 0, 1, 0, 12, 1.2, 1.6, '#8c7d70')
    this.solid.add(new THREE.CylinderGeometry(1.1, 1.1, 0.1, 24), this.mat(base, 0, 1.9, 0, 1, 1, 1, Math.PI / 2), '#c9c2b8')
    for (const [px, pz] of [[-9, -5], [9, -5], [-9, 5], [9, 5]]) this.collider(x + px, y + 2.5, z + pz, 0.25, 2.5, 0.25, 0, 'wood')
    this.collider(x, y + 0.6, z, 6, 0.6, 0.8, 0, 'wood')
    L.occupy(x, z, 10)
    for (let i = 0; i < 3; i++) {
      const lx = b.ix0 + 8 + i * 11, lz = b.iz0 + 7
      const ly = L.getHeight(lx, lz)
      const lb = this.baseMatrix(lx, lz, 0, ly)
      for (let row = 0; row < 3; row++) for (let k = 0; k < 4 - row; k++) this.solid.add(new THREE.CylinderGeometry(0.42, 0.42, 7, 10), this.mat(lb, -1.3 + k * 0.86 + row * 0.43, 0.42 + row * 0.75, 0, 1, 1, 1, 0, 0, Math.PI / 2), '#9a6a3e')
      this.collider(lx, ly + 1.1, lz, 3.5, 1.1, 1.8, 0, 'wood')
      L.occupy(lx, lz, 4)
    }
    this.places.push({ name: 'Sawmill', kind: 'landmark', x, z, door: { x: b.cx, z: b.iz0 + 1 }, rot: Math.PI, street: this.streetFor(b, 's') })
  },

  // Pine Ridge: lookout tower and picnic benches
  buildLookout(b) {
    const L = this.layout
    const x = b.cx, z = b.cz
    const y = L.getHeight(x, z)
    const base = this.baseMatrix(x, z, 0, y)
    for (const [px, pz] of [[-2.5, -2.5], [2.5, -2.5], [-2.5, 2.5], [2.5, 2.5]]) this.box(this.solid, base, px, 6, pz, 0.35, 12, 0.35, '#6e4228')
    for (let k = 1; k < 4; k++) this.box(this.solid, base, 0, k * 3, 0, 5.4, 0.15, 5.4, '#8a5a3a')
    this.box(this.solid, base, 0, 12.2, 0, 6.4, 0.3, 6.4, '#8a5a3a')
    this.solid.add(prism(7, 2, 7), this.mat(base, 0, 13.6, 0, 1, 1, 1), '#3f4a3a')
    this.collider(x, y + 6, z, 2.9, 6, 2.9, 0, 'wood')
    L.occupy(x, z, 5)
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2
      this.benches.push({ x: x + Math.cos(a) * 11, z: z + Math.sin(a) * 11, rot: -a - Math.PI / 2 })
    }
    for (let k = 0; k < 10; k++) this.treeSpots.push({ x: b.ix0 + 3 + this.rnd.random() * (b.ix1 - b.ix0 - 6), z: b.iz0 + 3 + this.rnd.random() * (b.iz1 - b.iz0 - 6) })
    this.places.push({ name: 'Lookout Point', kind: 'landmark', x, z, door: { x: b.cx, z: b.iz0 + 1 }, rot: Math.PI, street: this.streetFor(b, 's') })
  },

  // Dustwater: roadside motel + diner
  buildMotel(b) {
    const place = this.bigBuilding(b, 'n', {
      w: 34, d: 9, floors: 1, wall: '#e2b98a', name: 'Sundown Motel',
      extras: (base, w, d) => {
        for (let k = 0; k < 9; k++) this.box(this.solid, base, -w / 2 + 2.5 + k * 3.6, 1.05, d / 2 + 0.06, 1.0, 2.1, 0.1, k % 2 ? '#2f8f95' : '#c8462f')
        this.box(this.solid, base, 0, 3.2, d / 2 + 1.4, w, 0.15, 2.8, '#c9875e')
        this.box(this.solid, base, -w / 2 - 3, 4.5, d / 2 + 3, 0.4, 9, 0.4, '#3b3532')
        this.box(this.glass, base, -w / 2 - 3, 8.5, d / 2 + 3, 3.5, 1.6, 0.25, '#ff6f9f', 1)
      },
    })
    place.kind = 'shop'
    this.shops.push(place)
    const diner = this.bigBuilding(b, 's', { w: 18, d: 10, floors: 1, wall: '#f2ece2', name: 'Route Diner' })
    diner.kind = 'shop'
    this.shops.push(diner)
    this.shopDoors.push(diner)
  },

  // Dustwater: motocross arena with dirt jumps
  buildMoto(b) {
    const L = this.layout
    L.addZone({ type: 'dirt', shape: 'rect', x0: b.ix0 - 0.5, x1: b.ix1 + 0.5, z0: b.iz0 - 0.5, z1: b.iz1 + 0.5 })
    const jumps = [[b.cx - 12, b.cz - 10, 0], [b.cx + 12, b.cz + 10, Math.PI], [b.cx + 13, b.cz - 12, Math.PI / 2], [b.cx - 13, b.cz + 12, -Math.PI / 2]]
    this.motoJumps = []
    for (const [x, z, rot] of jumps) {
      this.addRamp(x, z, rot, 6, 4.5, 1.6, '#b98552')
      this.motoJumps.push({ x, z, rot })
    }
    // tyre barriers
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2
      const x = b.cx + Math.cos(a) * 19, z = b.cz + Math.sin(a) * 19
      const y = L.getHeight(x, z)
      this.solid.add(new THREE.TorusGeometry(0.45, 0.2, 6, 12), this.mat(this.baseMatrix(x, z, a, y), 0, 0.2, 0, 1, 1, 1, Math.PI / 2), '#2a2626')
    }
    this.motoArena = { x: b.cx, z: b.cz, r: 18 }
    this.places.push({ name: 'Motocross Arena', kind: 'landmark', x: b.cx, z: b.cz, door: { x: b.cx, z: b.iz0 + 1 }, rot: Math.PI, street: this.streetFor(b, 's') })
  },

  // A wedge-shaped jump ramp (mesh + convex collider)
  addRamp(x, z, rot, len, width, height, color) {
    const y = this.layout.getHeight(x, z)
    const g = new THREE.BufferGeometry()
    const hw = width / 2, hl = len / 2
    const v = [[-hw, 0, -hl], [hw, 0, -hl], [hw, 0, hl], [-hw, 0, hl], [-hw, height, hl], [hw, height, hl]]
    const tris = [[0, 4, 3], [0, 1, 5], [0, 5, 4], [1, 2, 5], [3, 4, 5], [3, 5, 2], [0, 3, 2], [0, 2, 1]]
    const pos = []
    for (const t of tris) for (const i of t) pos.push(...v[i])
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.computeVertexNormals()
    this.solid.add(g, this.baseMatrix(x, z, rot, y), color)
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot)
    const body = this.physics.world.createRigidBody(this.R.RigidBodyDesc.fixed().setTranslation(x, y, z).setRotation(q))
    const pts = new Float32Array(v.flat())
    const desc = this.R.ColliderDesc.convexHull(pts)
    if (desc) this.physics.tag(this.physics.world.createCollider(desc.setFriction(0.9), body), { kind: 'prop', material: 'wood' })
    this.layout.occupy(x, z, Math.max(len, width) * 0.6)
  },

  // Gun shop on a shop lot: place.role = 'gunshop'
  markGunShop(place) {
    place.role = 'gunshop'
    this.gunShops.push(place)
  },

  // ---------------------------------------------------------------- Fort Granite
  buildFort() {
    const L = this.layout
    const F = FORT
    this.useTown('fort')
    const fy = (x, z) => L.getHeight(x, z)
    const o = 9 // fence offset outside the loop road
    const fx0 = F.x0 - o, fx1 = F.x1 + o, fz0 = F.z0 - o, fz1 = F.z1 + o
    L.addZone({ type: 'dirt', shape: 'rect', x0: F.x0 + HW + 1, x1: F.x1 - HW - 1, z0: F.z0 + HW + 1, z1: F.z1 - HW - 1 })
    // Perimeter fence (gap at the gate on the east side)
    const fence = (ax, az, bx, bz) => {
      const len = Math.hypot(bx - ax, bz - az)
      const cx = (ax + bx) / 2, cz = (az + bz) / 2
      const rot = Math.atan2(bx - ax, bz - az)
      const y = fy(cx, cz)
      const base = this.baseMatrix(cx, cz, rot, y)
      this.box(this.solid, base, 0, 1.4, 0, 0.06, 2.6, len, '#8a8f8a')
      this.box(this.solid, base, 0, 2.85, 0, 0.12, 0.12, len, '#5a5f5a')
      for (let k = 0; k <= len; k += 4) this.box(this.solid, base, 0, 1.5, -len / 2 + k, 0.14, 3, 0.14, '#5a5f5a')
      this.collider(cx, y + 1.5, cz, 0.15, 1.5, len / 2, rot, 'metal')
    }
    const gz = F.gate.z, gap = 7
    fence(fx0, fz0, fx1, fz0)
    fence(fx0, fz1, fx1, fz1)
    fence(fx0, fz0, fx0, fz1)
    fence(fx1, fz0, fx1, gz - gap)
    fence(fx1, gz + gap, fx1, fz1)
    // Gate booth + barrier
    const gb = this.baseMatrix(fx1 + 4, gz + gap + 3, 0, fy(fx1 + 4, gz + gap + 3))
    this.box(this.solid, gb, 0, 1.5, 0, 3, 3, 3, '#d8d0c4')
    this.box(this.glass, gb, 0, 1.9, 1.52, 2.2, 1, 0.05, '#9fc7cf', 1)
    this.box(this.solid, gb, 0, 3.2, 0, 3.6, 0.3, 3.6, ARMY_DARK)
    this.collider(fx1 + 4, fy(fx1 + 4, gz + gap + 3) + 1.5, gz + gap + 3, 1.5, 1.5, 1.5, 0, 'stone')
    this.signs.push({ name: 'Fort Granite', matrix: this.mat(this.baseMatrix(fx1 + 4, gz - gap - 3, -Math.PI / 2, fy(fx1 + 4, gz - gap - 3)), 0, 2.4, 0, 6, 0.8, 1) })
    // Barracks (west half)
    const westX = (F.x0 + (F.x0 + F.x1) / 2) / 2
    for (let k = 0; k < 3; k++) {
      const x = westX, z = F.z0 + 26 + k * 42
      const y = fy(x, z)
      const base = this.baseMatrix(x, z, Math.PI / 2, y)
      this.box(this.solid, base, 0, 2, 0, 30, 5.5, 10, '#c9bfa8')
      this.solid.add(prism(30.6, 2, 10.6), this.mat(base, 0, 4.75, 0, 1, 1, 1), ARMY_DARK)
      this.windowsRow(base, 30, 10, 2, '#c9bfa8', 0)
      this.box(this.solid, base, 0, 1.1, 5.04, 1.4, 2.2, 0.1, '#3b3532')
      this.collider(x, y + 2.5, z, 5, 3, 15, 0, 'stone')
      L.occupy(x, z, 16)
    }
    // Hangars + tank depot (east half)
    const eastX = ((F.x0 + F.x1) / 2 + F.x1) / 2
    const hangar = (z, name) => {
      const y = fy(eastX, z)
      const base = this.baseMatrix(eastX, z, -Math.PI / 2, y)
      this.solid.add(new THREE.CylinderGeometry(10, 10, 28, 20, 1, false, -Math.PI / 2, Math.PI), this.mat(base, 0, 0, 0, 1, 1, 1, 0, 0, Math.PI / 2), ARMY)
      this.box(this.solid, base, 0, 3.5, 14.1, 12, 7, 0.2, '#6f6a66')
      this.signs.push({ name, matrix: this.mat(base, 0, 8.2, 14.25, 7, 0.9, 1) })
      this.collider(eastX, y + 5, z, 14, 5, 10, 0, 'metal')
      L.occupy(eastX, z, 16)
    }
    hangar(F.z0 + 30, 'Hangar 1')
    hangar(F.z1 - 30, 'Armory')
    // Tank depot: open shelter in the middle of the east half
    const tx = eastX, tz = (F.z0 + F.z1) / 2 + 2
    const ty = fy(tx, tz)
    const tb = this.baseMatrix(tx, tz, 0, ty)
    for (const [px, pz] of [[-8, -6], [8, -6], [-8, 6], [8, 6]]) {
      this.box(this.solid, tb, px, 2.8, pz, 0.5, 5.6, 0.5, ARMY_DARK)
      this.collider(tx + px, ty + 2.8, tz + pz, 0.25, 2.8, 0.25, 0, 'metal')
    }
    this.box(this.solid, tb, 0, 5.8, 0, 18, 0.4, 14, ARMY)
    L.addZone({ type: 'paved', shape: 'rect', x0: tx - 9, x1: tx + 9, z0: tz - 7, z1: tz + 7 })
    // Watchtowers at the corners
    for (const [wx, wz] of [[fx0 + 4, fz0 + 4], [fx1 - 4, fz0 + 4], [fx0 + 4, fz1 - 4], [fx1 - 4, fz1 - 4]]) {
      const y = fy(wx, wz)
      const base = this.baseMatrix(wx, wz, 0, y)
      for (const [px, pz] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]]) this.box(this.solid, base, px, 4, pz, 0.25, 8, 0.25, '#6e4228')
      this.box(this.solid, base, 0, 8.1, 0, 4, 0.2, 4, '#8a6a4a')
      for (const s of [-1, 1]) {
        this.box(this.solid, base, s * 1.95, 8.8, 0, 0.1, 1.2, 4, '#8a6a4a')
        this.box(this.solid, base, 0, 8.8, s * 1.95, 4, 1.2, 0.1, '#8a6a4a')
      }
      this.solid.add(prism(4.6, 1.2, 4.6), this.mat(base, 0, 10.6, 0, 1, 1, 1), ARMY_DARK)
      for (const [px, pz] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]]) this.box(this.solid, base, px, 9.8, pz, 0.12, 1.6, 0.12, '#6e4228')
      this.collider(wx, y + 4, wz, 1.7, 4, 1.7, 0, 'wood')
      L.occupy(wx, wz, 3)
    }
    // Helipad
    const hx = westX, hz = F.z1 - 14
    L.addZone({ type: 'paved', shape: 'circle', x: hx, z: hz, r: 9 })
    // Sandbag walls + flagpole near the gate
    for (let k = 0; k < 4; k++) {
      const sx = F.x1 - 20, sz = gz - 18 + k * 12
      const y = fy(sx, sz)
      const base = this.baseMatrix(sx, sz, 0, y)
      for (let row = 0; row < 3; row++) for (let i = 0; i < 5; i++) this.box(this.solid, base, -2 + i + (row % 2) * 0.5 - 0.25, 0.25 + row * 0.42, 0, 0.95, 0.4, 0.7, '#b9a37a')
      this.collider(sx, y + 0.65, sz, 2.6, 0.65, 0.4, 0, 'stone')
    }
    const fpx = F.x1 - 12, fpz = gz + 14
    const fpb = this.baseMatrix(fpx, fpz, 0, fy(fpx, fpz))
    this.box(this.solid, fpb, 0, 6, 0, 0.18, 12, 0.18, '#c9c2b8')
    this.box(this.solid, fpb, 1.1, 11, 0, 2.2, 1.3, 0.04, '#3f7a4a')
    // Firing range north of the fence: target boards on posts
    this.rangeTargets = []
    for (let k = 0; k < 6; k++) {
      const x = F.x0 + 25 + k * 26, z = fz1 + 40
      const y = fy(x, z)
      const base = this.baseMatrix(x, z, Math.PI, y)
      this.box(this.solid, base, 0, 0.9, 0, 0.2, 1.8, 0.2, '#6e4228')
      this.box(this.solid, base, 0, 2.1, 0, 1.8, 1.8, 0.12, '#f2ece2')
      this.box(this.solid, base, 0, 2.1, -0.07, 1.0, 1.0, 0.02, '#c8462f')
      this.rangeTargets.push({ x, y: y + 2.1, z })
    }
    // Berm behind the range
    const bx = (F.x0 + F.x1) / 2, bz = fz1 + 52
    const bby = fy(bx, bz)
    this.box(this.solid, this.baseMatrix(bx, bz, 0, bby), 0, 1.5, 0, F.x1 - F.x0, 3, 4, '#9a8a6a')
    this.collider(bx, bby + 1.5, bz, (F.x1 - F.x0) / 2, 1.5, 2, 0, 'ground')
    this.fort = {
      ...F, fence: { x0: fx0, x1: fx1, z0: fz0, z1: fz1 },
      tankSpawn: { x: tx, z: tz, heading: Math.PI / 2 },
      helipad: { x: hx, z: hz },
      armory: { x: eastX - 12, z: F.z1 - 30 },
      range: { x: bx, z: fz1 + 20, targets: this.rangeTargets },
    }
    this.places.push({ name: 'Fort Granite', kind: 'landmark', x: (F.x0 + F.x1) / 2, z: gz, door: { x: F.x1 + 2, z: gz }, rot: Math.PI / 2, street: 'Fort Road' })
  },
}
