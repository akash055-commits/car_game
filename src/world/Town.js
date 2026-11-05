// The town: districts, lots, procedural buildings (houses, shops, town hall, school,
// warehouse, gas station, market), street furniture and the named places that people,
// taxis and couriers travel between. Buildings are merged into a few draw calls.
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { WORLD, GRID } from './Layout.js'
import { U } from './Uniforms.js'
import { wettable } from './Props.js'
import { makeRandom } from '../core/math.js'

const HW = WORLD.roadHalfWidth
const SW = WORLD.sidewalk

export const STREET_NAMES = {
  x: { '-175': 'West Ring', '-125': 'Cedar Avenue', '-75': 'Oak Avenue', '-25': 'Main Street', 25: 'Maple Avenue', 75: 'Birch Lane', 125: 'Elm Street', 175: 'East Ring' },
  z: { '-175': 'South Ring', '-125': 'Harbour Road', '-75': 'Willow Road', '-25': 'Market Street', 25: 'Station Road', 75: 'Chestnut Road', 125: 'Hill Street', 175: 'North Ring' },
}

const HOUSE_WALLS = ['#f2e3c6', '#e8c9a0', '#dcae88', '#c9dcc8', '#b8cfe0', '#f0d0c8', '#e3d6ef', '#f6efe4', '#d8c3a5', '#f1d9a6']
const ROOFS = ['#b4473a', '#8c3b30', '#5b6b7a', '#3f5a4a', '#7a4b3a', '#a85c3c', '#46526b']
const SHOP_WALLS = ['#f4e9d8', '#e9d2b4', '#d8e2dc', '#f2c9a5', '#cde0e6', '#efd7d0']
const AWNINGS = ['#d84b3a', '#2f8f95', '#e0568c', '#e8a33a', '#4a7bd0', '#5aa05a', '#8a5bd0']
const SHOP_NAMES = ['Bakery', 'Café', 'Grocer', 'Florist', 'Books', 'Toy Shop', 'Barber', 'Pharmacy', 'Ice Cream', 'Tailor', 'Bike Shop', 'Pet Shop', 'Deli', 'Music', 'Hardware', 'Tea House', 'Antiques', 'Cobbler', 'Pizzeria', 'Noodle Bar', 'Butcher', 'Optician', 'Bank', 'Gallery', 'Sweets', 'Diner', 'Laundry', 'Gym', 'Arcade', 'Camera Shop', 'Jeweller', 'Stationery']
const OFFICE_WALLS = ['#d9d4cc', '#c9b9a6', '#b8c4cc', '#e2d3bd', '#a9b6a5', '#cdbfb6']

// District plan by block id "bx,bz" (x index 0..6 west→east, z index 0..6 south→north)
const DISTRICTS = {
  '3,3': 'square', '3,2': 'shops', '3,4': 'shops', '1,3': 'shops', '2,3': 'market',
  '2,2': 'downtown', '2,4': 'downtown', '2,5': 'apartments', '4,4': 'apartments', '1,1': 'apartments',
  '0,5': 'stunt', '3,5': 'school', '6,5': 'garage', '6,2': 'civic', '3,6': 'hospital', '3,0': 'hotel',
  park: 'park', yard: 'yard',
}
// Construction sites: block id -> lot index + structure type
export const SITE_PLAN = [
  { block: '1,4', lot: 1, type: 'brickHouse' },
  { block: '5,5', lot: 4, type: 'logCabin' },
  { block: '6,4', lot: 1, type: 'tower' },
  { block: '0,3', lot: 6, type: 'brickShop' },
  { block: '1,2', lot: 4, type: 'fence' },
  { block: '3,1', lot: 0, type: 'logCabin' },
  { block: '5,1', lot: 1, type: 'brickHouse' },
  { block: '4,0', lot: 4, type: 'brickShop' },
  { block: '2,6', lot: 3, type: 'tower' },
]

// ---------------------------------------------------------------- geometry batching
export class Batch {
  constructor() {
    this.parts = []
  }

  add(geo, matrix, color, lit = 0) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone()
    g.applyMatrix4(matrix)
    const n = g.attributes.position.count
    const c = new THREE.Color(color)
    const col = new Float32Array(n * 3)
    const litA = new Float32Array(n).fill(lit)
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3)
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    g.setAttribute('aLit', new THREE.BufferAttribute(litA, 1))
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2))
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color', 'uv', 'aLit'].includes(k)) g.deleteAttribute(k)
    this.parts.push(g)
  }

  build() {
    if (!this.parts.length) return null
    const g = mergeGeometries(this.parts, false)
    this.parts = []
    return g
  }
}

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3(1, 1, 1)
const BOX = new THREE.BoxGeometry(1, 1, 1)

export function prism(w, h, d) {
  // gable roof: ridge along x
  const g = new THREE.BufferGeometry()
  const x = w / 2, z = d / 2
  const v = [
    [-x, 0, -z], [x, 0, -z], [x, 0, z], [-x, 0, z], [-x, h, 0], [x, h, 0],
  ]
  const tris = [[0, 4, 5], [0, 5, 1], [3, 2, 5], [3, 5, 4], [0, 3, 4], [1, 5, 2], [0, 1, 2], [0, 2, 3]]
  const pos = []
  for (const t of tris) for (const i of t) pos.push(...v[i])
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.computeVertexNormals()
  return g
}

function pyramid(w, h, d) {
  const g = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1)
  g.rotateY(Math.PI / 4)
  g.scale(w, h, d)
  g.translate(0, h / 2, 0)
  return g
}

export class Town {
  constructor(scene, physics, layout) {
    this.scene = scene
    this.physics = physics
    this.layout = layout
    this.R = physics.RAPIER
    this.rnd = makeRandom(1234)
    this.solid = new Batch()
    this.glass = new Batch()
    this.signs = []
    this.places = [] // named destinations: { name, kind, x, z, door:{x,z}, street }
    this.houses = []
    this.shops = []
    this.benches = []
    this.lampSpots = []
    this.treeSpots = []
    this.sitePlots = [] // filled from SITE_PLAN
    this.shopDoors = []
    this.colliders = 0

    this.planBlocks()
    this.buildStreetLamps()
    this.buildMeshes()
  }

  // building-local matrix helper
  mat(base, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) {
    _q.setFromEuler(_e.set(rx, ry, rz))
    _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz))
    return base.clone().multiply(_m)
  }

  box(batch, base, x, y, z, sx, sy, sz, color, lit = 0, rx = 0, ry = 0, rz = 0) {
    batch.add(BOX, this.mat(base, x, y, z, sx, sy, sz, rx, ry, rz), color, lit)
  }

  collider(x, y, z, hx, hy, hz, rot, material = 'stone') {
    const body = this.physics.world.createRigidBody(this.R.RigidBodyDesc.fixed().setTranslation(x, y, z).setRotation(_q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot).clone()))
    this.physics.tag(this.physics.world.createCollider(this.R.ColliderDesc.cuboid(hx, hy, hz).setFriction(0.6), body), { kind: 'building', material })
    this.colliders++
  }

  streetFor(block, side) {
    if (side === 'n') return STREET_NAMES.z[block.z1]
    if (side === 's') return STREET_NAMES.z[block.z0]
    if (side === 'e') return STREET_NAMES.x[block.x1]
    return STREET_NAMES.x[block.x0]
  }

  // ---------------------------------------------------------------- planning
  planBlocks() {
    const L = this.layout
    let shopIndex = 0
    const houseNumbers = {}
    for (const b of L.blocks) {
      const district = DISTRICTS[b.id] || 'residential'
      b.district = district
      const lots = this.lotsFor(b)
      b.lots = lots
      const sites = SITE_PLAN.filter((s) => s.block === b.id)
      lots.forEach((lot, li) => {
        const site = sites.find((s) => s.lot === li)
        if (site) {
          this.sitePlots.push({ ...site, ...lot, street: this.streetFor(b, lot.side) })
          L.addZone({ type: 'dirt', shape: 'rect', ...this.lotRect(lot, 1.0) })
          L.occupy(lot.x, lot.z, Math.max(lot.w, lot.d) * 0.6)
          return
        }
        const street = this.streetFor(b, lot.side)
        const address = () => {
          houseNumbers[street] = (houseNumbers[street] || 0) + 2 + Math.floor(this.rnd.random() * 2)
          return `${houseNumbers[street]} ${street}`
        }
        const bigNorth = ['civic', 'hospital', 'hotel'].includes(district) && lot.side === 'n'
        const bigSouth = ['civic', 'hotel'].includes(district) && lot.side === 's'
        if (bigNorth || bigSouth) return
        if (district === 'residential' || (district === 'garage' && [0, 1, 2, 6].includes(li)) || district === 'civic' || district === 'hospital' || district === 'hotel') {
          this.house(lot, address())
        } else if (district === 'apartments') {
          this.apartments(lot, address())
        } else if (district === 'downtown') {
          if (lot.side === 'e' || lot.side === 'w') this.pocketPlaza(lot)
          else this.office(lot, address())
        } else if (district === 'shops' || district === 'market') {
          if (district === 'market' && (lot.side === 'e' || lot.side === 'w')) return
          let name = SHOP_NAMES[shopIndex++ % SHOP_NAMES.length]
          if (b.id === '3,2' && li === 1) name = 'Post Office'
          if (b.id === '1,3' && li === 1) return this.cinema(lot, street)
          this.shop(lot, name, street)
        }
      })
      if (district === 'civic') this.buildCivic(b)
      if (district === 'hospital') this.buildHospital(b)
      if (district === 'hotel') this.buildHotelLibrary(b)
      if (district === 'square') this.buildSquare(b)
      if (district === 'market') this.buildMarket(b)
      if (district === 'school') this.buildSchool(b)
      if (district === 'garage') this.buildGasStation(b)
      if (district === 'stunt') this.buildStuntPark(b)
      if (district === 'yard') this.buildYard(b)
      if (district === 'park') this.buildPark(b)
    }
  }

  // 8 lots per regular block: 3 facing north, 3 facing south, 1 east, 1 west
  lotsFor(b) {
    if (['park', 'yard', 'stunt', 'school'].includes(b.district)) return []
    const lots = []
    const W = b.ix1 - b.ix0
    const cx = (b.ix0 + b.ix1) / 2, cz = (b.iz0 + b.iz1) / 2
    const step = W / 3
    for (const [side, rot, zEdge] of [['n', 0, b.iz1], ['s', Math.PI, b.iz0]]) {
      for (let k = 0; k < 3; k++) {
        const x = cx + (k - 1) * step
        const sign = side === 'n' ? 1 : -1
        lots.push({ side, rot, x, z: zEdge - sign * 6.5, w: step - 1.2, d: 11, front: { x, z: zEdge } })
      }
    }
    for (const [side, rot, xEdge] of [['e', Math.PI / 2, b.ix1], ['w', -Math.PI / 2, b.ix0]]) {
      const sign = side === 'e' ? 1 : -1
      lots.push({ side, rot, x: xEdge - sign * 6, z: cz, w: 10, d: 10, front: { x: xEdge, z: cz } })
    }
    return lots
  }

  lotRect(lot, pad = 0) {
    const horiz = lot.side === 'n' || lot.side === 's'
    const hw = (horiz ? lot.w : lot.d) / 2 + pad
    const hd = (horiz ? lot.d : lot.w) / 2 + pad
    return { x0: lot.x - hw, x1: lot.x + hw, z0: lot.z - hd, z1: lot.z + hd }
  }

  baseMatrix(x, z, rot, y = null) {
    const h = y ?? this.layout.getHeight(x, z)
    return new THREE.Matrix4().compose(new THREE.Vector3(x, h, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot), new THREE.Vector3(1, 1, 1))
  }

  local(x, z, rot, lx, lz) {
    const c = Math.cos(rot), s = Math.sin(rot)
    return { x: x + lx * c + lz * s, z: z - lx * s + lz * c }
  }

  windowsRow(base, w, d, y, color, skipX = null) {
    const n = Math.max(1, Math.floor((w - 1) / 2.4))
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * (w / n)
      if (skipX !== null && Math.abs(x - skipX) < 1.2) continue
      this.box(this.solid, base, x, y, d / 2 + 0.03, 1.15, 1.35, 0.08, '#f8f1e4')
      this.box(this.glass, base, x, y, d / 2 + 0.07, 0.9, 1.1, 0.06, '#33414f', this.rnd.random() < 0.55 ? 1 : 0)
    }
  }

  sideWindows(base, w, d, y) {
    for (const sx of [-1, 1]) {
      const n = Math.max(1, Math.floor((d - 1.5) / 2.6))
      for (let i = 0; i < n; i++) {
        const z = (i - (n - 1) / 2) * (d / n)
        this.box(this.solid, base, sx * (w / 2 + 0.03), y, z, 0.08, 1.35, 1.15, '#f8f1e4')
        this.box(this.glass, base, sx * (w / 2 + 0.07), y, z, 0.06, 1.1, 0.9, '#33414f', this.rnd.random() < 0.5 ? 1 : 0)
      }
    }
  }

  // ---------------------------------------------------------------- houses
  house(lot, address) {
    const r = this.rnd
    const w = Math.min(lot.w - 1.5, r.range(7, 9.5))
    const d = r.range(7, 8.5)
    const floors = r.random() < 0.4 ? 2 : 1
    const H = floors * 3
    const front = lot.side === 'n' || lot.side === 's' ? 3.2 : 2.6 // front garden depth
    const lz = lot.d / 2 - front - d / 2 // building centre in lot-local z (front is +z)
    const p = this.local(lot.x, lot.z, lot.rot, 0, lz)
    const y = this.layout.getHeight(p.x, p.z)
    const base = this.baseMatrix(p.x, p.z, lot.rot, y)
    const wall = r.pick(HOUSE_WALLS)
    const roof = r.pick(ROOFS)
    this.box(this.solid, base, 0, H / 2 - 0.75, 0, w, H + 1.5, d, wall)
    this.box(this.solid, base, 0, 0.12, 0, w + 0.12, 0.25, d + 0.12, '#8c7d70')
    if (floors === 2) this.box(this.solid, base, 0, 3, 0, w + 0.1, 0.14, d + 0.1, '#f8f1e4')
    const doorX = r.random() < 0.5 ? -w / 4 : w / 4
    this.box(this.solid, base, doorX, 1.05, d / 2 + 0.04, 1.1, 2.1, 0.12, r.pick(['#6e4228', '#2f5d62', '#8c3b30', '#3d4f7a']))
    this.box(this.solid, base, doorX, 0.08, d / 2 + 0.5, 1.6, 0.16, 0.9, '#b9b2a8')
    for (let f = 0; f < floors; f++) {
      this.windowsRow(base, w, d, 1.65 + f * 3, wall, f === 0 ? doorX : null)
      this.sideWindows(base, w, d, 1.65 + f * 3)
    }
    if (r.random() < 0.7) {
      this.solid.add(prism(w + 0.7, 2.3, d + 0.7), this.mat(base, 0, H, 0, 1, 1, 1), roof)
      if (r.random() < 0.6) this.box(this.solid, base, w * 0.25, H + 1.6, -d * 0.15, 0.6, 1.8, 0.6, '#9b8f86')
    } else {
      this.solid.add(pyramid(w + 0.7, 2.2, d + 0.7), this.mat(base, 0, H, 0, 1, 1, 1), roof)
    }
    // garden fence + path
    const fenceZ = lot.d / 2 - 0.4
    for (const sx of [-1, 1]) {
      const fw = lot.w / 2 - 1.0
      this.box(this.solid, this.baseMatrix(lot.x, lot.z, lot.rot, y), sx * (fw / 2 + 0.9), 0.45, fenceZ, fw, 0.08, 0.06, '#f8f1e4')
      this.box(this.solid, this.baseMatrix(lot.x, lot.z, lot.rot, y), sx * (fw / 2 + 0.9), 0.75, fenceZ, fw, 0.08, 0.06, '#f8f1e4')
      for (let k = 0; k <= Math.floor(fw / 1.2); k++) this.box(this.solid, this.baseMatrix(lot.x, lot.z, lot.rot, y), sx * (0.9 + k * 1.2), 0.45, fenceZ, 0.1, 0.9, 0.1, '#f8f1e4')
    }
    const doorWorld = this.local(p.x, p.z, lot.rot, doorX, d / 2 + 0.9)
    const gate = this.local(lot.x, lot.z, lot.rot, 0, lot.d / 2 + 0.6)
    const pathA = this.local(p.x, p.z, lot.rot, doorX, d / 2)
    this.layout.addZone({ type: 'paved', shape: 'path', w: 0.6, pts: [[pathA.x, pathA.z], [gate.x, gate.z]] })
    this.collider(p.x, y + H / 2, p.z, w / 2, H / 2 + 0.5, d / 2, lot.rot)
    this.layout.occupy(p.x, p.z, Math.max(w, d) * 0.62)
    this.layout.clearGrassRect(...Object.values(this.footprint(p.x, p.z, lot.rot, w, d)))
    // garden trees behind the house
    const back = this.local(lot.x, lot.z, lot.rot, r.range(-lot.w / 3, lot.w / 3), -lot.d / 2 - 1.5)
    if (r.random() < 0.7) this.treeSpots.push({ x: back.x, z: back.z })
    const place = { name: address, kind: 'house', x: p.x, z: p.z, door: doorWorld, gate, rot: lot.rot, street: address.replace(/^\d+ /, '') }
    this.houses.push(place)
    this.places.push(place)
  }

  footprint(x, z, rot, w, d) {
    const horiz = Math.abs(Math.sin(rot)) < 0.5
    const hx = (horiz ? w : d) / 2 + 0.3, hz = (horiz ? d : w) / 2 + 0.3
    return { x0: x - hx, z0: z - hz, x1: x + hx, z1: z + hz }
  }

  // ---------------------------------------------------------------- shops
  shop(lot, name, street) {
    const r = this.rnd
    const w = lot.w - 0.6
    const d = r.range(8.5, 10)
    const floors = r.random() < 0.55 ? 2 : 1
    const H = floors * 3.2 + 0.6
    const lz = lot.d / 2 - 1.2 - d / 2
    const p = this.local(lot.x, lot.z, lot.rot, 0, lz)
    const y = this.layout.getHeight(p.x, p.z)
    const base = this.baseMatrix(p.x, p.z, lot.rot, y)
    const wall = r.pick(SHOP_WALLS)
    const awning = r.pick(AWNINGS)
    this.box(this.solid, base, 0, H / 2 - 0.75, 0, w, H + 1.5, d, wall)
    // parapet + cornice
    this.box(this.solid, base, 0, H + 0.25, d / 2 - 0.1, w + 0.2, 0.5, 0.25, '#f8f1e4')
    this.box(this.solid, base, 0, H + 0.25, -d / 2 + 0.1, w + 0.2, 0.5, 0.25, '#f8f1e4')
    for (const sx of [-1, 1]) this.box(this.solid, base, sx * (w / 2 - 0.1), H + 0.25, 0, 0.25, 0.5, d, '#f8f1e4')
    this.box(this.solid, base, 0, H - 0.01, 0, w - 0.3, 0.05, d - 0.3, '#8a8580')
    if (r.random() < 0.7) this.box(this.solid, base, r.range(-w / 4, w / 4), H + 0.45, r.range(-d / 4, 0), 1.4, 0.9, 1.0, '#b9b2a8')
    if (r.random() < 0.4) this.solid.add(new THREE.CylinderGeometry(0.7, 0.7, 1.4, 12), this.mat(base, r.range(-w / 3, w / 3), H + 1.0, -d / 4, 1, 1, 1), '#8c7d70')
    // shop front: big window, door, awning, sign
    this.box(this.solid, base, 0, 1.4, d / 2 + 0.05, w - 0.6, 2.6, 0.12, '#5a3a2a')
    this.box(this.glass, base, -0.9, 1.45, d / 2 + 0.1, w - 3.2, 2.0, 0.06, '#3a4a55', 1)
    this.box(this.solid, base, w / 2 - 1.3, 1.1, d / 2 + 0.12, 1.1, 2.2, 0.06, '#2a2626')
    const stripes = 7
    for (let i = 0; i < stripes; i++) {
      const sx = (i - (stripes - 1) / 2) * ((w - 0.4) / stripes)
      this.box(this.solid, base, sx, 3.05, d / 2 + 0.7, (w - 0.4) / stripes + 0.01, 0.06, 1.5, i % 2 ? awning : '#fbf6ec', 0, 0.35)
    }
    if (floors === 2) this.windowsRow(base, w, d, 4.7, wall)
    this.sideWindows(base, w, d, floors === 2 ? 4.7 : 1.9)
    const signY = floors === 2 ? 3.75 : H - 0.2
    this.box(this.solid, base, 0, signY, d / 2 + 0.08, Math.min(w - 1, 6.4), 0.85, 0.14, '#3b2a20')
    this.signs.push({ name, matrix: this.mat(base, 0, signY, d / 2 + 0.16, Math.min(w - 1.2, 6.2), 0.72, 1) })
    // paved shop frontage
    this.layout.addZone({ type: 'paved', shape: 'rect', ...this.lotRect(lot, 0.3) })
    this.collider(p.x, y + H / 2, p.z, w / 2, H / 2 + 0.5, d / 2, lot.rot)
    this.layout.occupy(p.x, p.z, Math.max(w, d) * 0.62)
    const door = this.local(p.x, p.z, lot.rot, w / 2 - 1.3, d / 2 + 0.9)
    const place = { name, kind: 'shop', x: p.x, z: p.z, door, gate: this.local(lot.x, lot.z, lot.rot, w / 2 - 1.3, lot.d / 2 + 0.6), rot: lot.rot, street }
    this.shops.push(place)
    this.places.push(place)
    this.shopDoors.push(place)
    // benches & planters in front of some shops
    if (r.random() < 0.35) {
      const bp = this.local(lot.x, lot.z, lot.rot, -w / 4, lot.d / 2 - 0.7)
      this.benches.push({ x: bp.x, z: bp.z, rot: lot.rot })
    }
  }

  // ---------------------------------------------------------------- taller buildings
  // Shared helper: a multi-storey block with window bands, entrance and rooftop details
  tall(lot, { floors, wall, glassy = false, depthMin = 9, depthMax = 11, setback = 1.5, name = null, kind = 'house', address, balconies = false }) {
    const r = this.rnd
    const w = lot.w - 0.8
    const d = Math.min(lot.d - setback, r.range(depthMin, depthMax))
    const fh = 3.2
    const H = floors * fh + 0.4
    const lz = lot.d / 2 - setback - d / 2
    const p = this.local(lot.x, lot.z, lot.rot, 0, lz)
    const y = this.layout.getHeight(p.x, p.z)
    const base = this.baseMatrix(p.x, p.z, lot.rot, y)
    this.box(this.solid, base, 0, H / 2 - 0.75, 0, w, H + 1.5, d, wall)
    this.box(this.solid, base, 0, H + 0.3, 0, w + 0.25, 0.6, d + 0.25, '#f2ece2')
    this.box(this.solid, base, 0, 0.9, 0, w + 0.15, 1.8, d + 0.15, glassy ? '#6f7a80' : '#8c7d70')
    for (let f = 0; f < floors; f++) {
      const fy = 1.75 + f * fh
      if (glassy) {
        this.box(this.glass, base, 0, fy, d / 2 + 0.05, w - 0.6, 2.0, 0.06, '#3f5566', r.random() < 0.6 ? 1 : 0)
        this.box(this.solid, base, 0, fy + 1.15, d / 2 + 0.07, w - 0.4, 0.22, 0.1, '#f2ece2')
        for (const sx of [-1, 1]) this.box(this.glass, base, sx * (w / 2 + 0.05), fy, 0, 0.06, 2.0, d - 0.8, '#3f5566', r.random() < 0.5 ? 1 : 0)
      } else {
        this.windowsRow(base, w, d, fy, wall, f === 0 ? 0 : null)
        this.sideWindows(base, w, d, fy)
        if (balconies && f > 0) {
          for (let k = -1; k <= 1; k += 2) {
            this.box(this.solid, base, k * w * 0.25, fy - 0.85, d / 2 + 0.6, 2.2, 0.12, 1.1, '#e9e2d6')
            this.box(this.solid, base, k * w * 0.25, fy - 0.45, d / 2 + 1.12, 2.2, 0.7, 0.06, '#5b6b7a')
          }
        }
      }
    }
    // entrance with canopy
    this.box(this.solid, base, 0, 1.2, d / 2 + 0.08, 2.0, 2.4, 0.1, '#2a2626')
    this.box(this.solid, base, 0, 2.7, d / 2 + 0.9, 3.0, 0.14, 1.8, '#e9e2d6')
    // rooftop: plant room, water tank, antenna
    this.box(this.solid, base, r.range(-w / 4, w / 4), H + 1.1, r.range(-d / 4, 0), 2.6, 1.6, 2.0, '#b9b2a8')
    if (r.random() < 0.5) this.solid.add(new THREE.CylinderGeometry(0.9, 0.9, 1.8, 12), this.mat(base, -w / 4, H + 1.5, d / 5, 1, 1, 1), '#8c7d70')
    if (r.random() < 0.4) this.box(this.solid, base, w / 3, H + 2.6, -d / 4, 0.08, 4.5, 0.08, '#3b3532')
    if (name) {
      this.box(this.solid, base, 0, 3.4, d / 2 + 0.08, Math.min(w - 1, 6.4), 0.85, 0.14, '#3b2a20')
      this.signs.push({ name, matrix: this.mat(base, 0, 3.4, d / 2 + 0.16, Math.min(w - 1.2, 6.2), 0.72, 1) })
    }
    this.layout.addZone({ type: 'paved', shape: 'rect', ...this.lotRect(lot, 0.3) })
    this.collider(p.x, y + H / 2, p.z, w / 2, H / 2 + 0.5, d / 2, lot.rot)
    this.layout.occupy(p.x, p.z, Math.max(w, d) * 0.62)
    const door = this.local(p.x, p.z, lot.rot, 0, d / 2 + 0.9)
    const place = { name: name || address, kind, x: p.x, z: p.z, door, gate: this.local(lot.x, lot.z, lot.rot, 0, lot.d / 2 + 0.6), rot: lot.rot, street: address ? address.replace(/^\d+ /, '') : '' }
    this.places.push(place)
    if (kind === 'house') this.houses.push(place)
    if (kind === 'shop') { this.shops.push(place); this.shopDoors.push(place) }
    return place
  }

  office(lot, address) {
    const floors = this.rnd.int(4, 7)
    this.tall(lot, { floors, wall: this.rnd.pick(OFFICE_WALLS), glassy: this.rnd.random() < 0.6, address, kind: 'house' })
  }

  apartments(lot, address) {
    if (lot.side === 'e' || lot.side === 'w') return this.house(lot, address)
    this.tall(lot, { floors: this.rnd.int(3, 4), wall: this.rnd.pick(HOUSE_WALLS), address, balconies: true, setback: 2.5 })
  }

  pocketPlaza(lot) {
    const rect = this.lotRect(lot, 0.3)
    this.layout.addZone({ type: 'paved', shape: 'rect', ...rect })
    this.treeSpots.push({ x: lot.x, z: lot.z, planter: true })
    this.benches.push({ x: lot.x + Math.sin(lot.rot) * 3, z: lot.z + Math.cos(lot.rot) * 3, rot: lot.rot })
  }

  cinema(lot, street) {
    const place = this.tall(lot, { floors: 2, wall: '#7a3b4a', name: 'Cinema', kind: 'shop', address: `1 ${street}`, setback: 1.2 })
    place.name = 'Cinema'
    const p = this.local(lot.x, lot.z, lot.rot, 0, lot.d / 2 - 1.2)
    const base = this.baseMatrix(p.x, p.z, lot.rot)
    this.box(this.solid, base, 0, 4.4, 0.9, lot.w - 2, 0.25, 1.8, '#2a2626')
    for (let i = 0; i < 12; i++) this.box(this.glass, base, -((lot.w - 3) / 2) + i * ((lot.w - 3) / 11), 4.25, 1.8, 0.12, 0.12, 0.12, '#ffe3a0', 1)
  }

  bigBuilding(b, side, { w, d, floors, wall, roof = null, name, kind = 'landmark', extras }) {
    const rot = side === 'n' ? 0 : Math.PI
    const x = b.cx
    const z = side === 'n' ? b.iz1 - 1.5 - d / 2 : b.iz0 + 1.5 + d / 2
    const y = this.layout.getHeight(x, z)
    const base = this.baseMatrix(x, z, rot, y)
    const H = floors * 3.4 + 0.4
    this.box(this.solid, base, 0, H / 2 - 0.75, 0, w, H + 1.5, d, wall)
    this.box(this.solid, base, 0, H + 0.3, 0, w + 0.3, 0.6, d + 0.3, '#f2ece2')
    if (roof) this.solid.add(prism(w + 0.4, 2.6, d + 0.4), this.mat(base, 0, H + 0.6, 0, 1, 1, 1), roof)
    for (let f = 0; f < floors; f++) {
      this.windowsRow(base, w, d, 1.8 + f * 3.4, wall, f === 0 ? 0 : null)
      this.sideWindows(base, w, d, 1.8 + f * 3.4)
    }
    this.box(this.solid, base, 0, 3.6, d / 2 + 0.08, Math.min(w - 2, 8), 0.95, 0.14, '#3b2a20')
    this.signs.push({ name, matrix: this.mat(base, 0, 3.6, d / 2 + 0.16, Math.min(w - 2.2, 7.8), 0.8, 1) })
    if (extras) extras(base, w, d, H)
    this.collider(x, y + H / 2, z, w / 2, H / 2 + 0.5, d / 2, rot)
    this.layout.occupy(x, z, Math.max(w, d) * 0.6)
    this.layout.addZone({ type: 'paved', shape: 'rect', x0: x - w / 2 - 1, x1: x + w / 2 + 1, z0: side === 'n' ? z + d / 2 - 0.5 : b.iz0 - 0.3, z1: side === 'n' ? b.iz1 + 0.3 : z - d / 2 + 0.5 })
    const door = this.local(x, z, rot, 0, d / 2 + 2)
    const place = { name, kind, x, z, door, rot, street: this.streetFor(b, side) }
    this.places.push(place)
    return place
  }

  buildCivic(b) {
    this.bigBuilding(b, 'n', {
      w: 22, d: 12, floors: 2, wall: '#b5553a', name: 'Fire Station',
      extras: (base, w, d) => {
        for (let k = -1; k <= 1; k++) {
          this.box(this.solid, base, k * 6.5, 2.1, d / 2 + 0.06, 4.6, 4.2, 0.1, '#d84b3a')
          for (let s = 0; s < 5; s++) this.box(this.solid, base, k * 6.5, 0.6 + s * 0.8, d / 2 + 0.12, 4.4, 0.05, 0.04, '#f2ece2')
        }
        this.box(this.solid, base, w / 2 - 2, 9, -d / 4, 3, 11, 3, '#b5553a')
      },
    })
    this.bigBuilding(b, 's', {
      w: 22, d: 12, floors: 2, wall: '#9fb1c4', name: 'Police',
      extras: (base, w, d) => {
        this.box(this.glass, base, 0, 7.2, d / 2 - 1, 1.2, 0.5, 0.5, '#5a8cff', 1)
      },
    })
  }

  buildHospital(b) {
    this.bigBuilding(b, 'n', {
      w: 32, d: 14, floors: 3, wall: '#f2f0ea', name: 'Hospital',
      extras: (base, w, d, H) => {
        this.box(this.glass, base, w / 2 - 4, H - 1.6, d / 2 + 0.1, 2.4, 0.7, 0.08, '#e84a3a', 1)
        this.box(this.glass, base, w / 2 - 4, H - 1.6, d / 2 + 0.11, 0.7, 2.4, 0.08, '#e84a3a', 1)
        this.box(this.solid, base, 0, 2.9, d / 2 + 2.2, 8, 0.2, 4.2, '#e9e2d6')
        for (const sx of [-3.6, 3.6]) this.box(this.solid, base, sx, 1.45, d / 2 + 4, 0.25, 2.9, 0.25, '#e9e2d6')
      },
    })
  }

  buildHotelLibrary(b) {
    this.bigBuilding(b, 'n', {
      w: 26, d: 12, floors: 5, wall: '#e2c9a6', name: 'Hotel',
      extras: (base, w, d) => {
        this.box(this.solid, base, 0, 3.0, d / 2 + 1.6, 7, 0.18, 3.2, '#8a3b30')
        for (let f = 1; f < 5; f++) for (let k = -2; k <= 2; k++) this.box(this.solid, base, k * 4.6, 1.0 + f * 3.4, d / 2 + 0.5, 2.6, 0.1, 0.9, '#f2ece2')
      },
    })
    this.bigBuilding(b, 's', {
      w: 22, d: 12, floors: 2, wall: '#e9dfcc', roof: '#5b6b7a', name: 'Library',
      extras: (base, w, d) => {
        for (let i = 0; i < 6; i++) this.solid.add(new THREE.CylinderGeometry(0.32, 0.36, 5.6, 12), this.mat(base, (i - 2.5) * 2.4, 2.8, d / 2 + 1.3, 1, 1, 1), '#f8f1e4')
        this.box(this.solid, base, 0, 5.75, d / 2 + 1.3, 15, 0.5, 2.2, '#efe6d5')
      },
    })
  }

  // ---------------------------------------------------------------- special districts
  buildSquare(b) {
    const L = this.layout
    L.addZone({ type: 'paved', shape: 'rect', x0: b.ix0 - 0.2, x1: b.ix1 + 0.2, z0: b.iz0 - 0.2, z1: b.iz1 + 0.2 })
    const cx = b.cx, cz = b.cz - 3
    const y = L.getHeight(cx, cz)
    // Fountain
    const fbase = this.baseMatrix(cx, cz, 0, y)
    const ring = new THREE.CylinderGeometry(4.2, 4.4, 0.7, 28, 1, true)
    this.solid.add(ring, this.mat(fbase, 0, 0.35, 0, 1, 1, 1), '#b9b2a8')
    this.solid.add(new THREE.TorusGeometry(4.3, 0.22, 6, 32), this.mat(fbase, 0, 0.72, 0, 1, 1, 1, Math.PI / 2), '#d8d0c4')
    this.solid.add(new THREE.CylinderGeometry(0.5, 0.8, 2.4, 12), this.mat(fbase, 0, 1.2, 0, 1, 1, 1), '#d8d0c4')
    this.solid.add(new THREE.CylinderGeometry(1.4, 0.4, 0.4, 16), this.mat(fbase, 0, 2.5, 0, 1, 1, 1), '#d8d0c4')
    this.fountain = { x: cx, y: y + 0.55, z: cz, r: 4.1 }
    const fw = new THREE.Mesh(new THREE.CircleGeometry(4.15, 32).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x4cb8b0, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.85 }))
    fw.position.set(cx, y + 0.55, cz)
    this.scene.add(fw)
    this.fountainWater = fw
    const body = this.physics.world.createRigidBody(this.R.RigidBodyDesc.fixed().setTranslation(cx, y + 0.4, cz))
    this.physics.tag(this.physics.world.createCollider(this.R.ColliderDesc.cylinder(0.45, 4.4), body), { kind: 'building', material: 'stone' })
    L.occupy(cx, cz, 5.5)
    // Town hall on the north side, with a clock tower
    const hx = b.cx, hz = b.iz1 - 7.5
    const hy = L.getHeight(hx, hz)
    const base = this.baseMatrix(hx, hz, Math.PI, hy) // faces the square (south)
    const w = 24, d = 12, H = 7.5
    this.box(this.solid, base, 0, H / 2 - 0.75, 0, w, H + 1.5, d, '#efe3cf')
    this.box(this.solid, base, 0, H + 0.3, 0, w + 0.6, 0.6, d + 0.6, '#d8cbb4')
    this.solid.add(prism(w + 0.4, 3.0, d + 0.4), this.mat(base, 0, H + 0.6, 0, 1, 1, 1), '#5b6b7a')
    for (let i = 0; i < 6; i++) this.solid.add(new THREE.CylinderGeometry(0.35, 0.4, 5.2, 12), this.mat(base, (i - 2.5) * 2.6, 2.75, d / 2 + 1.4, 1, 1, 1), '#f8f1e4')
    this.box(this.solid, base, 0, 5.55, d / 2 + 1.4, 16, 0.6, 2.4, '#e9dcc5')
    for (let s = 0; s < 3; s++) this.box(this.solid, base, 0, 0.12 + s * 0.15, d / 2 + 2.6 + s * -0.35, 16 - s * 0.4, 0.3, 1.2, '#cfc6b8')
    this.box(this.solid, base, 0, 1.6, d / 2 + 0.05, 2.4, 3.2, 0.12, '#6e4228')
    this.windowsRow(base, w, d, 2.0, '#efe3cf', 0)
    this.windowsRow(base, w, d, 5.2, '#efe3cf')
    // tower
    const T = 10
    this.box(this.solid, base, 0, H + T / 2, 0, 5, T, 5, '#efe3cf')
    this.box(this.solid, base, 0, H + T + 0.2, 0, 5.6, 0.4, 5.6, '#d8cbb4')
    this.solid.add(pyramid(5.8, 4.5, 5.8), this.mat(base, 0, H + T + 0.4, 0, 1, 1, 1), '#46526b')
    this.clock = { base: base.clone(), y: H + T - 2.6, faces: [] }
    this.collider(hx, hy + H / 2, hz, w / 2, H / 2 + 0.5, d / 2, 0)
    this.collider(hx, hy + H + T / 2, hz, 2.5, T / 2, 2.5, 0)
    L.occupy(hx, hz, 13)
    this.places.push({ name: 'Town Hall', kind: 'landmark', x: hx, z: hz, door: { x: hx, z: hz - d / 2 - 3.5 }, rot: Math.PI, street: 'Town Square' })
    this.places.push({ name: 'Town Square', kind: 'landmark', x: cx, z: cz, door: { x: cx, z: b.iz0 + 1 }, rot: Math.PI, street: 'Market Street' })
    // benches around the fountain + trees in planters
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + 0.3
      this.benches.push({ x: cx + Math.cos(a) * 8, z: cz + Math.sin(a) * 8, rot: -a - Math.PI / 2 })
    }
    for (const [tx, tz] of [[b.ix0 + 3, b.iz0 + 3], [b.ix1 - 3, b.iz0 + 3], [b.ix0 + 3, cz + 6], [b.ix1 - 3, cz + 6]]) this.treeSpots.push({ x: tx, z: tz, planter: true })
    this.taxiStand = { x: cx + 6, z: b.z0 + HW + SW * 0.5, rot: Math.PI }
  }

  buildMarket(b) {
    const r = this.rnd
    const L = this.layout
    L.addZone({ type: 'paved', shape: 'rect', x0: b.ix0 + 10, x1: b.ix1 - 10, z0: b.iz0 + 12, z1: b.iz1 - 12 })
    const cols = ['#d84b3a', '#e8a33a', '#2f8f95', '#5aa05a', '#e0568c']
    this.stalls = []
    for (let i = 0; i < 4; i++) {
      const x = b.cx + (i % 2 ? 5 : -5), z = b.cz + (i < 2 ? -3 : 3)
      const y = L.getHeight(x, z)
      const base = this.baseMatrix(x, z, i < 2 ? 0 : Math.PI, y)
      for (const [px, pz] of [[-1.6, -1], [1.6, -1], [-1.6, 1], [1.6, 1]]) this.box(this.solid, base, px, 1.25, pz, 0.1, 2.5, 0.1, '#6e4228')
      const c = cols[i % cols.length]
      for (let s = 0; s < 6; s++) this.box(this.solid, base, -1.75 + s * 0.7 + 0.35, 2.55, 0, 0.7, 0.06, 2.6, s % 2 ? c : '#fbf6ec', 0, 0, 0.12)
      this.box(this.solid, base, 0, 0.85, 0.6, 3.2, 0.1, 1.0, '#a86b3d')
      for (let k = 0; k < 10; k++) {
        const fruit = r.pick(['#e84a3a', '#f2a83c', '#8cc955', '#f6d34a', '#9b4fd0'])
        this.solid.add(new THREE.SphereGeometry(0.11, 8, 6), this.mat(base, -1.3 + (k % 5) * 0.65, 0.98, 0.35 + Math.floor(k / 5) * 0.4, 1, 1, 1), fruit)
      }
      this.collider(x, y + 0.6, z, 1.7, 0.6, 1.1, i < 2 ? 0 : Math.PI, 'wood')
      L.occupy(x, z, 2.2)
      this.stalls.push({ x, z, rot: i < 2 ? 0 : Math.PI })
    }
    this.places.push({ name: 'Market', kind: 'landmark', x: b.cx, z: b.cz, door: { x: b.cx, z: b.iz0 + 2 }, rot: Math.PI, street: 'Market Street' })
  }

  buildSchool(b) {
    const L = this.layout
    const x = b.cx, z = b.iz1 - 7
    const y = L.getHeight(x, z)
    const base = this.baseMatrix(x, z, 0, y)
    const w = 26, d = 10, H = 6.6
    this.box(this.solid, base, 0, H / 2 - 0.75, 0, w, H + 1.5, d, '#e8b48a')
    this.box(this.solid, base, 0, H + 0.2, 0, w + 0.4, 0.4, d + 0.4, '#f8f1e4')
    this.windowsRow(base, w, d, 1.8, '#e8b48a', 0)
    this.windowsRow(base, w, d, 5.0, '#e8b48a')
    this.box(this.solid, base, 0, 1.2, d / 2 + 0.05, 2.4, 2.4, 0.12, '#2f5d62')
    this.signs.push({ name: 'School', matrix: this.mat(base, 0, 3.4, d / 2 + 0.1, 5, 0.7, 1) })
    this.box(this.solid, base, 0, 3.4, d / 2 + 0.04, 5.3, 0.9, 0.08, '#3b2a20')
    this.collider(x, y + H / 2, z, w / 2, H / 2 + 0.5, d / 2, 0)
    L.occupy(x, z, 14)
    this.places.push({ name: 'School', kind: 'landmark', x, z, door: this.local(x, z, 0, 0, d / 2 + 2), rot: 0, street: STREET_NAMES.z[b.z1] })
    // football pitch in the middle
    const fx = b.cx, fz = b.cz - 4
    this.pitch = { x: fx, z: fz, w: 22, d: 14, y: L.getHeight(fx, fz) }
    L.clearGrassRect(fx - 12, fz - 8, fx + 12, fz + 8)
    const lb = this.baseMatrix(fx, fz, 0, this.pitch.y)
    for (const [lx, lz, sx, sz] of [[0, -7, 22, 0.12], [0, 7, 22, 0.12], [-11, 0, 0.12, 14], [11, 0, 0.12, 14], [0, 0, 0.12, 14]]) this.box(this.solid, lb, lx, 0.03, lz, sx, 0.04, sz, '#f4f1e8')
    this.solid.add(new THREE.TorusGeometry(2.4, 0.06, 4, 40), this.mat(lb, 0, 0.03, 0, 1, 1, 0.4, Math.PI / 2), '#f4f1e8')
    for (const sx of [-1, 1]) {
      const gb = this.baseMatrix(fx + sx * 11, fz, 0, this.pitch.y)
      this.box(this.solid, gb, 0, 1.0, -1.6, 0.12, 2.0, 0.12, '#ffffff')
      this.box(this.solid, gb, 0, 1.0, 1.6, 0.12, 2.0, 0.12, '#ffffff')
      this.box(this.solid, gb, 0, 2.0, 0, 0.12, 0.12, 3.3, '#ffffff')
      for (const pz of [-1.6, 1.6]) {
        const body = this.physics.world.createRigidBody(this.R.RigidBodyDesc.fixed().setTranslation(fx + sx * 11, this.pitch.y + 1, fz + pz))
        this.physics.tag(this.physics.world.createCollider(this.R.ColliderDesc.cuboid(0.08, 1, 0.08), body), { kind: 'prop', material: 'metal' })
      }
    }
    L.occupy(fx, fz, 11)
  }

  buildGasStation(b) {
    const L = this.layout
    const x = b.ix0 + 9, z = b.iz0 + 9
    const y = L.getHeight(x, z)
    L.addZone({ type: 'paved', shape: 'rect', x0: b.ix0 - 0.2, x1: b.ix0 + 19, z0: b.iz0 - 0.2, z1: b.iz0 + 19 })
    const base = this.baseMatrix(x, z, 0, y)
    for (const [px, pz] of [[-4, -3], [4, -3], [-4, 3], [4, 3]]) this.box(this.solid, base, px, 2.4, pz, 0.35, 4.8, 0.35, '#f8f1e4')
    this.box(this.solid, base, 0, 4.9, 0, 11, 0.5, 8.5, '#d84b3a')
    this.box(this.solid, base, 0, 4.6, 0, 11.2, 0.15, 8.7, '#f8f1e4')
    for (const px of [-2, 2]) {
      this.box(this.solid, base, px, 0.8, 0, 0.7, 1.6, 0.5, '#2f8f95')
      this.box(this.glass, base, px, 1.25, 0.27, 0.45, 0.3, 0.04, '#9fe8ff', 1)
      const body = this.physics.world.createRigidBody(this.R.RigidBodyDesc.fixed().setTranslation(x + px, y + 0.8, z))
      this.physics.tag(this.physics.world.createCollider(this.R.ColliderDesc.cuboid(0.35, 0.8, 0.25), body), { kind: 'prop', material: 'metal' })
    }
    this.signs.push({ name: 'Fuel', matrix: this.mat(base, 0, 4.9, 4.27, 3, 0.45, 1) })
    // garage building
    const gx = b.ix0 + 9, gz = b.iz0 + 15.5
    const gy = L.getHeight(gx, gz)
    const gbase = this.baseMatrix(gx, gz, Math.PI, gy)
    this.box(this.solid, gbase, 0, 1.75, 0, 10, 5, 6, '#cde0e6')
    for (const dx of [-2.4, 2.4]) this.box(this.solid, gbase, dx, 1.4, 3.04, 3.6, 2.8, 0.1, '#8a8580')
    this.signs.push({ name: 'Garage', matrix: this.mat(gbase, 0, 3.6, 3.12, 4, 0.6, 1) })
    this.box(this.solid, gbase, 0, 3.6, 3.06, 4.3, 0.75, 0.08, '#3b2a20')
    this.collider(gx, gy + 2, gz, 5, 2.5, 3, 0)
    L.occupy(x, z, 7)
    L.occupy(gx, gz, 6)
    this.places.push({ name: 'Garage', kind: 'landmark', x: gx, z: gz, door: { x: x, z: b.iz0 - 0.5 }, rot: Math.PI, street: STREET_NAMES.z[b.z0] })
  }

  buildStuntPark(b) {
    const L = this.layout
    L.addZone({ type: 'dirt', shape: 'rect', x0: b.ix0 + 1, x1: b.ix1 - 1, z0: b.iz0 + 1, z1: b.iz1 - 1 })
    this.stuntPark = { x0: b.ix0, x1: b.ix1, z0: b.iz0, z1: b.iz1, cx: b.cx, cz: b.cz }
    this.places.push({ name: 'Stunt Park', kind: 'landmark', x: b.cx, z: b.cz, door: { x: b.cx, z: b.iz0 + 1 }, rot: Math.PI, street: STREET_NAMES.z[b.z0] })
  }

  buildYard(b) {
    const L = this.layout
    L.addZone({ type: 'dirt', shape: 'rect', x0: b.ix0 + 0.5, x1: b.ix1 - 0.5, z0: b.iz0 + 0.5, z1: b.iz1 - 0.5 })
    // Warehouse
    const x = b.ix0 + 14, z = b.cz + 2
    const y = L.getHeight(x, z)
    const base = this.baseMatrix(x, z, Math.PI / 2, y)
    this.box(this.solid, base, 0, 3, 0, 22, 7.5, 14, '#c9b9a6')
    this.solid.add(prism(22.6, 2.4, 14.6), this.mat(base, 0, 6.75, 0, 1, 1, 1, 0, Math.PI / 2), '#7d8a8c')
    this.box(this.solid, base, 0, 2.2, 7.04, 6, 4.4, 0.12, '#8a5a3a')
    this.signs.push({ name: 'Brickyard', matrix: this.mat(base, 0, 5.6, 7.1, 6, 0.9, 1) })
    this.box(this.solid, base, 0, 5.6, 7.05, 6.3, 1.1, 0.08, '#3b2a20')
    this.collider(x, y + 3.5, z, 7, 4, 11, 0)
    L.occupy(x, z, 12)
    this.yard = { x0: b.ix0, x1: b.ix1, z0: b.iz0, z1: b.iz1, cx: b.cx, cz: b.cz, pickup: { x: b.ix0 + 30, z: b.cz } }
    this.places.push({ name: 'Brickyard', kind: 'landmark', x, z, door: { x: b.ix0 + 30, z: b.cz }, rot: Math.PI / 2, street: STREET_NAMES.z[b.z1] })
    // Material piles (decor) in the yard
    this.piles = []
    for (let i = 0; i < 6; i++) {
      const px = b.ix0 + 36 + (i % 3) * 9, pz = b.cz - 6 + Math.floor(i / 3) * 12
      const py = L.getHeight(px, pz)
      const pb = this.baseMatrix(px, pz, 0, py)
      const brick = i % 2 === 0
      for (let lyr = 0; lyr < 4; lyr++) {
        this.box(this.solid, pb, 0, 0.25 + lyr * 0.5, 0, brick ? 3 - lyr * 0.4 : 4, 0.48, brick ? 2 - lyr * 0.3 : 0.5 * (4 - lyr) + 0.4, brick ? '#b5553a' : '#b98552')
      }
      this.collider(px, py + 1, pz, brick ? 1.5 : 2, 1, 1.1, 0, brick ? 'stone' : 'wood')
      L.occupy(px, pz, 3)
    }
    // Tower crane (decor) — jib rotates slowly
    const cxw = b.ix1 - 8, czw = b.iz1 - 8
    const cy = L.getHeight(cxw, czw)
    const cb = this.baseMatrix(cxw, czw, 0, cy)
    this.box(this.solid, cb, 0, 9, 0, 1.2, 18, 1.2, '#f2b33d')
    this.box(this.solid, cb, 0, 0.3, 0, 3, 0.6, 3, '#8a8580')
    this.collider(cxw, cy + 9, czw, 0.7, 9, 0.7, 0, 'metal')
    L.occupy(cxw, czw, 3)
    this.crane = { x: cxw, y: cy + 18, z: czw }
  }

  buildPark(b) {
    const L = this.layout
    const lake = L.lake
    L.addZone({ type: 'paved', shape: 'ring', x: lake.x, z: lake.z, r: lake.r + 9, w: 1.3 })
    // paths from the park edges to the ring
    const cx = lake.x, cz = lake.z
    for (const [ex, ez] of [[b.ix0, cz], [cx, b.iz1], [cx - 18, b.iz0], [b.ix1, cz + 18]]) {
      const ang = Math.atan2(ez - cz, ex - cx)
      L.addZone({ type: 'paved', shape: 'path', w: 1.1, pts: [[cx + Math.cos(ang) * (lake.r + 9), cz + Math.sin(ang) * (lake.r + 9)], [ex, ez]] })
    }
    this.joggingLoop = { x: cx, z: cz, r: lake.r + 9 }
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + 0.2
      const r = lake.r + 11
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r
      if (L.channelDistance(x, z) < 3) continue
      this.benches.push({ x, z, rot: -a + Math.PI / 2 })
    }
    // Playground: swings + slide
    const px = b.ix0 + 10, pz = b.iz1 - 12
    const py = L.getHeight(px, pz)
    const pb = this.baseMatrix(px, pz, 0, py)
    for (const sx of [-1.8, 1.8]) {
      this.box(this.solid, pb, sx, 1.3, -0.6, 0.12, 2.8, 0.12, '#d84b3a', 0, 0.25)
      this.box(this.solid, pb, sx, 1.3, 0.6, 0.12, 2.8, 0.12, '#d84b3a', 0, -0.25)
    }
    this.box(this.solid, pb, 0, 2.65, 0, 3.9, 0.12, 0.12, '#d84b3a')
    for (const sx of [-0.8, 0.8]) {
      this.box(this.solid, pb, sx, 1.6, 0, 0.03, 2.0, 0.03, '#3b3532')
      this.box(this.solid, pb, sx, 0.6, 0, 0.5, 0.06, 0.25, '#2f8f95')
    }
    this.box(this.solid, pb, 5, 1.0, 0, 0.8, 2.0, 0.8, '#e8a33a')
    this.box(this.solid, pb, 5, 0.55, 2.0, 0.7, 0.08, 3.4, '#4a7bd0', 0, 0, 0)
    L.addZone({ type: 'dirt', shape: 'circle', x: px + 2, z: pz, r: 6 })
    L.occupy(px + 2, pz, 6)
    this.places.push({ name: 'Lakeside Park', kind: 'landmark', x: cx, z: cz + lake.r + 9, door: { x: b.ix0 + 1, z: cz }, rot: -Math.PI / 2, street: STREET_NAMES.x[b.x0] })
    this.park = { ...b, playground: { x: px, z: pz } }
  }

  // ---------------------------------------------------------------- lamps & furniture
  buildStreetLamps() {
    const L = this.layout
    const off = HW + SW - 0.45
    for (const e of L.edges) {
      const n = Math.floor(e.length / 16)
      for (let k = 1; k < n; k++) {
        const s = (k / n) * e.length
        if (s < 9 || e.length - s < 9) continue
        const tx = (e.bx - e.ax) / e.length, tz = (e.bz - e.az) / e.length
        const x = e.ax + tx * s, z = e.az + tz * s
        const side = k % 2 ? 1 : -1
        const lx = x - tz * side * off, lz = z + tx * side * off
        const q = L.queryRoad(lx, lz)
        if (q.i >= 0 && L.isOnBridge(q.i)) continue
        this.lampSpots.push({ x: lx, z: lz })
      }
    }
  }

  buildMeshes() {
    const solidGeo = this.solid.build()
    const mat = wettable(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 }))
    this.mesh = new THREE.Mesh(solidGeo, mat)
    this.mesh.castShadow = true
    this.mesh.receiveShadow = true
    this.scene.add(this.mesh)

    // Windows glow warm at night (randomly per window via aLit)
    const glassGeo = this.glass.build()
    const gmat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.15, metalness: 0.2, emissive: 0xffffff })
    gmat.onBeforeCompile = (shader) => {
      shader.uniforms.uNight = U.uNight
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aLit;\nvarying float vLit;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLit = aLit;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uNight;\nvarying float vLit;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance = vec3(1.0, 0.72, 0.38) * vLit * (0.02 + uNight * 2.2);')
    }
    this.glassMesh = new THREE.Mesh(glassGeo, gmat)
    this.scene.add(this.glassMesh)

    this.buildSigns()
    this.buildClock()
  }

  buildSigns() {
    const cols = 2, rowsPer = 56
    const cw = 512, ch = 64
    const cv = document.createElement('canvas')
    cv.width = cw * cols
    cv.height = ch * rowsPer
    const ctx = cv.getContext('2d')
    const geos = []
    this.signs.forEach((s, i) => {
      const cx = (i % cols) * cw, cy = Math.floor(i / cols) * ch
      ctx.fillStyle = '#3b2a20'
      ctx.fillRect(cx, cy, cw, ch)
      ctx.fillStyle = '#fbe8c8'
      ctx.font = 'bold 40px Nunito, Georgia, serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(s.name.toUpperCase(), cx + cw / 2, cy + ch / 2 + 2)
      const g = new THREE.PlaneGeometry(1, 1)
      const uv = g.attributes.uv
      const u0 = cx / cv.width, u1 = (cx + cw) / cv.width
      const v1 = 1 - cy / cv.height, v0 = 1 - (cy + ch) / cv.height
      for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) ? u1 : u0, uv.getY(k) ? v1 : v0)
      g.applyMatrix4(s.matrix)
      geos.push(g)
    })
    if (!geos.length) return
    const tex = new THREE.CanvasTexture(cv)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 4
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0 })
    this.signMat = mat
    this.scene.add(new THREE.Mesh(mergeGeometries(geos), mat))
  }

  buildClock() {
    if (!this.clock) return
    const cv = document.createElement('canvas')
    cv.width = cv.height = 256
    const ctx = cv.getContext('2d')
    ctx.fillStyle = '#fbf3e2'
    ctx.beginPath()
    ctx.arc(128, 128, 122, 0, Math.PI * 2)
    ctx.fill()
    ctx.lineWidth = 10
    ctx.strokeStyle = '#3b2a20'
    ctx.stroke()
    ctx.fillStyle = '#3b2a20'
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2
      ctx.fillRect(128 + Math.sin(a) * 96 - 5, 128 - Math.cos(a) * 96 - 12, 10, 24)
    }
    const tex = new THREE.CanvasTexture(cv)
    tex.colorSpace = THREE.SRGBColorSpace
    const faceMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, emissive: 0xffe2b0, emissiveIntensity: 0 })
    this.clockMat = faceMat
    const handMat = new THREE.MeshStandardMaterial({ color: 0x2a2020 })
    this.clockHands = []
    for (let k = 0; k < 4; k++) {
      const ry = (k * Math.PI) / 2
      const g = new THREE.Group()
      g.applyMatrix4(this.clock.base)
      const pivot = new THREE.Group()
      pivot.position.set(Math.sin(ry) * 2.53, this.clock.y, Math.cos(ry) * 2.53)
      pivot.rotation.y = ry
      g.add(pivot)
      const face = new THREE.Mesh(new THREE.CircleGeometry(1.5, 32), faceMat)
      pivot.add(face)
      const hour = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.8, 0.04).translate(0, 0.35, 0.03), handMat)
      const minute = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.2, 0.04).translate(0, 0.55, 0.05), handMat)
      pivot.add(hour, minute)
      this.clockHands.push({ hour, minute })
      this.scene.add(g)
    }
  }

  // timeOfDay: 0..1 (0 = midnight)
  update(timeOfDay, night) {
    const hours = (timeOfDay * 24) % 12
    for (const h of this.clockHands || []) {
      h.hour.rotation.z = -(hours / 12) * Math.PI * 2
      h.minute.rotation.z = -((timeOfDay * 24 * 60) % 60 / 60) * Math.PI * 2
    }
    if (this.clockMat) this.clockMat.emissiveIntensity = night * 0.8
    if (this.signMat) this.signMat.emissiveIntensity = night * 0.55
  }

  // Random named destination (optionally filtered by kind), avoiding a given place
  randomPlace(rnd = Math.random, kinds = null, avoid = null) {
    const list = this.places.filter((p) => (!kinds || kinds.includes(p.kind)) && p !== avoid)
    return list[Math.floor(rnd() * list.length)]
  }
}
