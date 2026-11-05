// Town layout: the single source of truth for terrain heights, the street grid, water,
// bridges, zones and the sidewalk graph. Visual meshes, physics colliders, shaders and
// the people / traffic AI all read from here so everything lines up exactly.
import * as THREE from 'three'
import { SimplexNoise } from 'three/examples/jsm/math/SimplexNoise.js'
import { clamp, lerp, smoothstep, makeRandom } from '../core/math.js'

export const WORLD = {
  size: 700,
  res: 351, // one height sample every 2 m (roads use a separate ~0.33 m texture)
  cell: 2,
  half: 350,
  roadTexHalf: 215, // the street texture only needs to cover the town + airport roads
  waterLevel: -0.45,
  roadHalfWidth: 4.0,
  sidewalk: 2.6,
  townHalf: 175,
  playRadius: 200,
}
const HW = WORLD.roadHalfWidth
const SW = WORLD.sidewalk

// Street grid lines (x for vertical streets, z for horizontal ones)
export const GRID = [-175, -125, -75, -25, 25, 75, 125, 175]
// Road segments removed to make larger blocks (park, industrial yard)
const REMOVED = new Set(['v:75:-75:-25', 'v:75:-25:25', 'h:-25:25:75', 'h:-25:75:125', 'v:-125:-175:-125'])

const LAKE = { x: 78, z: -28, r: 17 }
const STREAM = { hw: 3.4, depth: -1.5, pts: [[96, 360], [110, 290], [104, 234], [102, 200], [106, 170], [108, 140], [103, 110], [100, 80], [100, 50], [100, 30], [92, 0], [84, -14]] }
const RIVER = { hw: 4.6, depth: -1.8, pts: [[90, -30], [110, -38], [128, -46], [150, -50], [176, -53], [200, -55], [240, -66], [290, -60], [360, -58]] }
// Airport south of town: flattened apron + runway area
export const AIRPORT = {
  x0: -235, x1: 235, z0: -334, z1: -190,
  runwayZ: -305, runwayHalfLen: 200, runwayHalfWidth: 15,
  taxiZ: -272, taxiHalfWidth: 7, connectors: [-185, 0, 185],
  apron: { x0: -50, x1: 175, z0: -265, z1: -218 },
  stands: [60, 100, 140], standZ: -240,
  terminal: { x0: 40, x1: 112, z0: -217.5, z1: -207.5 },
  hangars: [-140, -88], hangarZ: -238,
  tower: { x: -20, z: -212 },
  helipad: { x: -32, z: -248 },
}
// Extra roads beyond the grid: airport access + terminal road
const EXTRA_EDGES = [
  { ax: 25, az: -175, bx: 25, bz: -200, axis: 'z' },
  { ax: -80, az: -200, bx: 25, bz: -200, axis: 'x' },
  { ax: 25, az: -200, bx: 130, bz: -200, axis: 'x' },
]

function segDistance(px, pz, ax, az, bx, bz) {
  const abx = bx - ax, abz = bz - az
  const t = clamp(((px - ax) * abx + (pz - az) * abz) / (abx * abx + abz * abz || 1), 0, 1)
  const dx = px - (ax + abx * t), dz = pz - (az + abz * t)
  return Math.sqrt(dx * dx + dz * dz)
}

function polyDistance(x, z, pts) {
  let d = Infinity
  for (let i = 0; i < pts.length - 1; i++) d = Math.min(d, segDistance(x, z, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]))
  return d
}

export class Layout {
  constructor() {
    const rnd = makeRandom(7)
    this.noise = new SimplexNoise({ random: rnd.random })
    this.lake = LAKE
    this.stream = STREAM
    this.river = RIVER
    this.occupied = []
    this.zones = [] // { type: 'paved' | 'dirt', shape: 'rect' | 'ring' | 'circle', ... }

    this.buildNetwork()
    this.buildBlocks()
    this.buildHeights()
    this.buildMaps()
    this.buildSidewalkGraph()
  }

  n2(x, z) {
    return this.noise.noise(x, z)
  }

  baseHeight(x, z) {
    const zz = z < 0 ? z * 0.92 : z
    const rr = Math.pow(Math.pow(Math.abs(x), 4) + Math.pow(Math.abs(zz), 4), 0.25)
    const town = 1 - smoothstep(178, 205, rr)
    const n = this.n2(x * 0.012, z * 0.012) * (0.55 + (1 - town) * 2.2) + this.n2(x * 0.045 + 10, z * 0.045 - 3) * 0.15
    const hills = smoothstep(200, 260, rr) * (3 + 6 * (this.n2(x * 0.02 - 7, z * 0.02 + 3) * 0.5 + 0.5))
    const rim = smoothstep(300, 346, rr) * (20 + 10 * this.n2(x * 0.03 + 5, z * 0.03))
    let h = n + hills + rim
    // the airport is a flat plateau
    const a = AIRPORT
    const out = Math.max(a.x0 - x, x - a.x1, a.z0 - z, z - a.z1, 0)
    if (out < 30) h = lerp(0.35, h, smoothstep(0, 30, out))
    return h
  }

  lakeRadius(ang) {
    return LAKE.r * (1 + 0.14 * Math.sin(3 * ang + 1.3) + 0.08 * Math.sin(5 * ang - 0.4))
  }

  lakeQ(x, z) {
    const dx = x - LAKE.x, dz = z - LAKE.z
    return Math.sqrt(dx * dx + dz * dz) / this.lakeRadius(Math.atan2(dz, dx))
  }

  // Distance from the edge of the nearest channel (negative = inside the water channel)
  channelDistance(x, z) {
    return Math.min(polyDistance(x, z, STREAM.pts) - STREAM.hw, polyDistance(x, z, RIVER.pts) - RIVER.hw)
  }

  // ---------------------------------------------------------------- Streets
  buildNetwork() {
    const edges = []
    for (const g of GRID) {
      for (let k = 0; k < GRID.length - 1; k++) {
        const a = GRID[k], b = GRID[k + 1]
        if (!REMOVED.has(`v:${g}:${a}:${b}`)) edges.push({ ax: g, az: a, bx: g, bz: b, axis: 'z' })
        if (!REMOVED.has(`h:${g}:${a}:${b}`)) edges.push({ ax: a, az: g, bx: b, bz: g, axis: 'x' })
      }
    }
    for (const e of EXTRA_EDGES) edges.push({ ...e, extra: true })
    this.edges = edges
    // Nodes (intersections) with their degree
    const nodes = new Map()
    for (const e of edges) {
      for (const [x, z] of [[e.ax, e.az], [e.bx, e.bz]]) {
        const k = `${x},${z}`
        if (!nodes.has(k)) nodes.set(k, { x, z, edges: [] })
        nodes.get(k).edges.push(e)
      }
    }
    this.nodes = [...nodes.values()]
    this.nodeMap = nodes

    // Samples every 0.5 m along every edge
    const X = [], Z = [], TX = [], TZ = [], E = []
    edges.forEach((e, ei) => {
      const len = Math.hypot(e.bx - e.ax, e.bz - e.az)
      const n = Math.round(len / 0.5)
      const tx = (e.bx - e.ax) / len, tz = (e.bz - e.az) / len
      e.start = X.length
      for (let i = 0; i <= n; i++) {
        X.push(e.ax + tx * (i * 0.5))
        Z.push(e.az + tz * (i * 0.5))
        TX.push(tx)
        TZ.push(tz)
        E.push(ei)
      }
      e.end = X.length - 1
      e.length = len
    })
    const N = X.length
    this.roadCount = N
    this.roadStep = 0.5
    this.roadX = Float32Array.from(X)
    this.roadZ = Float32Array.from(Z)
    this.roadTX = Float32Array.from(TX)
    this.roadTZ = Float32Array.from(TZ)
    this.roadEdge = Int16Array.from(E)
    this.roadH = new Float32Array(N)
    this.roadBridge = new Uint8Array(N)

    this.cell = 12
    this.grid = new Map()
    for (let i = 0; i < N; i++) {
      const k = this.cellKey(Math.floor(this.roadX[i] / this.cell), Math.floor(this.roadZ[i] / this.cell))
      if (!this.grid.has(k)) this.grid.set(k, [])
      this.grid.get(k).push(i)
    }

    // Road heights follow the gentle terrain; bridges arch over water channels
    for (let i = 0; i < N; i++) this.roadH[i] = this.baseHeight(this.roadX[i], this.roadZ[i])
    this.bridges = []
    for (const e of edges) {
      let run = null
      for (let i = e.start; i <= e.end; i++) {
        const wet = this.channelDistance(this.roadX[i], this.roadZ[i]) < 2.5
        if (wet && !run) run = { i0: i, i1: i }
        else if (wet) run.i1 = i
        if ((!wet || i === e.end) && run) {
          const c = Math.round((run.i0 + run.i1) / 2)
          this.bridges.push({ edge: e, start: e.start, end: e.end, center: c, half: Math.max(8, ((run.i1 - run.i0) * 0.5) / 2 + 6) })
          run = null
        }
      }
    }
    for (const b of this.bridges) {
      const hs = Math.round(b.half / 0.5)
      for (let i = Math.max(b.start, b.center - hs - 12); i <= Math.min(b.end, b.center + hs + 12); i++) {
        const ds = Math.abs(i - b.center) * 0.5
        const k = 1 - smoothstep(b.half, b.half + 6, ds)
        let h = lerp(this.roadH[i], Math.max(this.roadH[i], WORLD.waterLevel + 1.1), k)
        if (ds < b.half) {
          const c = Math.cos((ds / b.half) * Math.PI * 0.5)
          h += 0.65 * c * c
          this.roadBridge[i] = 1
        }
        this.roadH[i] = h
      }
      b.x = this.roadX[b.center]
      b.z = this.roadZ[b.center]
      b.y = this.roadH[b.center]
      b.tx = this.roadTX[b.center]
      b.tz = this.roadTZ[b.center]
    }
  }

  cellKey(cx, cz) {
    return cx * 1000 + cz
  }

  // Nearest road sample: { d: distance to centreline, i: sample index, side: signed lateral }
  queryRoad(x, z, out = {}) {
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell)
    let best = Infinity, bi = -1
    for (let ox = -1; ox <= 1; ox++) {
      for (let oz = -1; oz <= 1; oz++) {
        const list = this.grid.get(this.cellKey(cx + ox, cz + oz))
        if (!list) continue
        for (const i of list) {
          const dx = x - this.roadX[i], dz = z - this.roadZ[i]
          const d = dx * dx + dz * dz
          if (d < best) { best = d; bi = i }
        }
      }
    }
    if (bi < 0) {
      out.d = 999; out.i = -1; out.side = 0
      return out
    }
    out.d = Math.sqrt(best)
    out.i = bi
    out.side = (x - this.roadX[bi]) * -this.roadTZ[bi] + (z - this.roadZ[bi]) * this.roadTX[bi]
    return out
  }

  isOnBridge(i) {
    return i >= 0 && this.roadBridge[i] === 1
  }

  // Position + heading on the road at sample i (used for spawn / respawn)
  roadFrame(i, flip = false) {
    i = clamp(i, 0, this.roadCount - 1)
    const s = flip ? -1 : 1
    return {
      x: this.roadX[i], z: this.roadZ[i], y: this.roadH[i],
      tx: this.roadTX[i] * s, tz: this.roadTZ[i] * s,
      heading: Math.atan2(this.roadTX[i] * s, this.roadTZ[i] * s),
    }
  }

  // ---------------------------------------------------------------- Blocks
  buildBlocks() {
    const blocks = []
    const merged = [
      { id: 'park', x0: 25, x1: 125, z0: -75, z1: 25 },
      { id: 'yard', x0: -175, x1: -75, z0: -175, z1: -125 },
    ]
    const covered = (x0, z0) => merged.some((m) => x0 >= m.x0 && x0 < m.x1 && z0 >= m.z0 && z0 < m.z1)
    for (let bx = 0; bx < GRID.length - 1; bx++) {
      for (let bz = 0; bz < GRID.length - 1; bz++) {
        const x0 = GRID[bx], z0 = GRID[bz]
        if (covered(x0, z0)) continue
        blocks.push({ id: `${bx},${bz}`, bx, bz, x0, x1: GRID[bx + 1], z0, z1: GRID[bz + 1] })
      }
    }
    for (const m of merged) blocks.push({ ...m })
    // Inner rectangle (inside the sidewalk) for each block
    const o = HW + SW
    for (const b of blocks) {
      b.ix0 = b.x0 + o
      b.ix1 = b.x1 - o
      b.iz0 = b.z0 + o
      b.iz1 = b.z1 - o
      b.cx = (b.x0 + b.x1) / 2
      b.cz = (b.z0 + b.z1) / 2
    }
    this.blocks = blocks
    this.blockById = Object.fromEntries(blocks.map((b) => [b.id, b]))
  }

  // ---------------------------------------------------------------- Heights
  buildHeights() {
    const { res, half, cell, waterLevel: W } = WORLD
    this.heights = new Float32Array(res * res) // visual, row-major [iz * res + ix]
    this.physHeights = new Float32Array(res * res) // physics, column-major for Rapier [ix * res + iz]
    this.roadDist = new Float32Array(res * res)
    const q = {}
    const corridor = HW + SW
    for (let iz = 0; iz < res; iz++) {
      for (let ix = 0; ix < res; ix++) {
        const x = ix * cell - half, z = iz * cell - half
        let h = this.baseHeight(x, z)
        this.queryRoad(x, z, q)
        this.roadDist[iz * res + ix] = q.d
        if (q.i >= 0) h = lerp(this.roadH[q.i], h, smoothstep(corridor + 0.2, corridor + 7, q.d))
        h = Math.max(h, W + 0.45)
        let hPhys = h

        // Water carving: lake, stream, river
        h = lerp(h, -2.6, smoothstep(1.22, 0.55, this.lakeQ(x, z)))
        const ds = polyDistance(x, z, STREAM.pts)
        if (ds < STREAM.hw + 4) h = Math.min(h, lerp(h, STREAM.depth, smoothstep(STREAM.hw + 3, STREAM.hw - 1.2, ds)))
        const dr = polyDistance(x, z, RIVER.pts)
        if (dr < RIVER.hw + 4) h = Math.min(h, lerp(h, RIVER.depth, smoothstep(RIVER.hw + 3, RIVER.hw - 1.4, dr)))

        // Physics keeps the deck solid across bridges (parapets stop you falling)
        if (q.i >= 0 && this.isOnBridge(q.i) && q.d < corridor + 0.3) hPhys = Math.max(h, this.roadH[q.i])
        else hPhys = h

        this.heights[iz * res + ix] = h
        this.physHeights[ix * res + iz] = hPhys
      }
    }
  }

  getHeight(x, z) {
    const { res, half, cell } = WORLD
    const fx = clamp((x + half) / cell, 0, res - 1.001), fz = clamp((z + half) / cell, 0, res - 1.001)
    const ix = Math.floor(fx), iz = Math.floor(fz)
    const tx = fx - ix, tz = fz - iz
    const h = this.heights
    const a = h[iz * res + ix], b = h[iz * res + ix + 1]
    const c = h[(iz + 1) * res + ix], d = h[(iz + 1) * res + ix + 1]
    return lerp(lerp(a, b, tx), lerp(c, d, tx), tz)
  }

  // Surface that cars and people stand on (road / sidewalk deck on bridges)
  getDriveHeight(x, z) {
    const q = this.queryRoad(x, z)
    if (q.i >= 0 && q.d < HW + SW + 0.3) return Math.max(this.roadH[q.i], this.getHeight(x, z))
    return this.getHeight(x, z)
  }

  getNormal(x, z, out = new THREE.Vector3()) {
    const e = 0.75
    const hl = this.getHeight(x - e, z), hr = this.getHeight(x + e, z)
    const hd = this.getHeight(x, z - e), hu = this.getHeight(x, z + e)
    return out.set(hl - hr, 2 * e, hd - hu).normalize()
  }

  isWater(x, z) {
    return this.getHeight(x, z) < WORLD.waterLevel + 0.15
  }

  // ---------------------------------------------------------------- Masks
  buildMaps() {
    const { res, half, cell, waterLevel: W } = WORLD
    // RGBA: R = grass density, G = road/sidewalk, B = shore/sand, A = dirt patches
    this.groundMap = new Uint8Array(res * res * 4)
    for (let iz = 0; iz < res; iz++) {
      for (let ix = 0; ix < res; ix++) {
        const x = ix * cell - half, z = iz * cell - half
        const i = iz * res + ix
        const h = this.heights[i]
        const d = this.roadDist[i]
        const hl = this.heights[iz * res + Math.max(0, ix - 1)], hr = this.heights[iz * res + Math.min(res - 1, ix + 1)]
        const hd = this.heights[Math.max(0, iz - 1) * res + ix], hu = this.heights[Math.min(res - 1, iz + 1) * res + ix]
        const slope = (Math.hypot(hr - hl, hu - hd) * 0.5) / cell
        const road = 1 - smoothstep(HW + SW - 0.3, HW + SW + 0.6, d)
        const nearWater = Math.max(smoothstep(1.45, 1.05, this.lakeQ(x, z)), smoothstep(4, 0, this.channelDistance(x, z)))
        const shore = nearWater * smoothstep(W + 1.1, W + 0.25, h)
        const dirt = smoothstep(0.5, 0.85, this.n2(x * 0.06 + 40, z * 0.06 - 12) * 0.5 + 0.5) * 0.6
        let grass = smoothstep(HW + SW + 0.2, HW + SW + 1.6, d) * smoothstep(W + 0.35, W + 0.9, h) * (1 - smoothstep(0.55, 1.0, slope))
        grass *= 1 - dirt * 0.75
        grass *= 0.65 + 0.35 * (this.n2(x * 0.11, z * 0.11) * 0.5 + 0.5)
        this.groundMap[i * 4] = clamp(grass * 255, 0, 255)
        this.groundMap[i * 4 + 1] = clamp(road * 255, 0, 255)
        this.groundMap[i * 4 + 2] = clamp(shore * 255, 0, 255)
        this.groundMap[i * 4 + 3] = clamp(dirt * 255, 0, 255)
      }
    }
  }

  // Remove grass under a footprint (call before textures are created)
  clearGrass(x, z, r, strength = 1) {
    const { res, half, cell } = WORLD
    const x0 = Math.max(0, Math.floor((x - r + half) / cell)), x1 = Math.min(res - 1, Math.ceil((x + r + half) / cell))
    const z0 = Math.max(0, Math.floor((z - r + half) / cell)), z1 = Math.min(res - 1, Math.ceil((z + r + half) / cell))
    for (let iz = z0; iz <= z1; iz++) {
      for (let ix = x0; ix <= x1; ix++) {
        const d = Math.hypot(ix * cell - half - x, iz * cell - half - z)
        const k = 1 - smoothstep(r * 0.6, r, d)
        const i = (iz * res + ix) * 4
        this.groundMap[i] *= 1 - k * strength
      }
    }
  }

  clearGrassRect(x0, z0, x1, z1) {
    const { res, half, cell } = WORLD
    for (let iz = Math.max(0, Math.round((z0 + half) / cell)); iz <= Math.min(res - 1, Math.round((z1 + half) / cell)); iz++) {
      for (let ix = Math.max(0, Math.round((x0 + half) / cell)); ix <= Math.min(res - 1, Math.round((x1 + half) / cell)); ix++) {
        this.groundMap[(iz * res + ix) * 4] = 0
      }
    }
  }

  // Paved / dirt zones painted by the ground shader
  addZone(zone) {
    this.zones.push(zone)
    if (zone.shape === 'rect') this.clearGrassRect(zone.x0, zone.z0, zone.x1, zone.z1)
  }

  occupy(x, z, r) {
    this.occupied.push({ x, z, r })
  }

  isFree(x, z, r, { roadMargin = 1.5, allowWater = false } = {}) {
    if (Math.max(Math.abs(x), Math.abs(z)) > WORLD.half - 4) return false
    const a = AIRPORT
    if (x > a.x0 - r && x < a.x1 + r && z > a.z0 - r && z < a.z1 + r) return false
    const q = this.queryRoad(x, z)
    if (q.d < HW + SW + roadMargin + r) return false
    if (!allowWater && this.getHeight(x, z) < WORLD.waterLevel + 0.5) return false
    if (!allowWater && this.channelDistance(x, z) < r + 1) return false
    for (const o of this.occupied) {
      if (Math.abs(o.x - x) > o.r + r || Math.abs(o.z - z) > o.r + r) continue
      if (Math.hypot(o.x - x, o.z - z) < o.r + r) return false
    }
    return true
  }

  // ---------------------------------------------------------------- Sidewalk graph
  // Nodes sit at the sidewalk corners of every block; edges run along the sidewalks and
  // across the street on crosswalks. People path-find on this graph.
  buildSidewalkGraph() {
    const o = HW + SW * 0.5
    const nodes = []
    const key = (x, z) => `${Math.round(x * 2)},${Math.round(z * 2)}`
    const index = new Map()
    const addNode = (x, z) => {
      const k = key(x, z)
      if (index.has(k)) return index.get(k)
      const id = nodes.length
      nodes.push({ id, x, z, links: [] })
      index.set(k, id)
      return id
    }
    const link = (a, b, crosswalk = false) => {
      if (a === b || nodes[a].links.some((l) => l.to === b)) return
      const len = Math.hypot(nodes[a].x - nodes[b].x, nodes[a].z - nodes[b].z)
      nodes[a].links.push({ to: b, len, crosswalk })
      nodes[b].links.push({ to: a, len, crosswalk })
    }
    for (const b of this.blocks) {
      // corners plus mid points along long sides so people can reach doors
      const xs = [b.x0 + o, b.x1 - o], zs = [b.z0 + o, b.z1 - o]
      const ring = []
      const steps = (len) => Math.max(1, Math.round(len / 25))
      const pushSide = (ax, az, bx, bz) => {
        const n = steps(Math.hypot(bx - ax, bz - az))
        for (let k = 0; k < n; k++) ring.push(addNode(lerp(ax, bx, k / n), lerp(az, bz, k / n)))
      }
      pushSide(xs[0], zs[0], xs[1], zs[0])
      pushSide(xs[1], zs[0], xs[1], zs[1])
      pushSide(xs[1], zs[1], xs[0], zs[1])
      pushSide(xs[0], zs[1], xs[0], zs[0])
      for (let k = 0; k < ring.length; k++) link(ring[k], ring[(k + 1) % ring.length])
      b.walkNodes = ring
    }
    // Crosswalks: connect corner nodes that face each other across a street
    for (const a of nodes) {
      for (const c of nodes) {
        if (c.id <= a.id) continue
        const dx = Math.abs(a.x - c.x), dz = Math.abs(a.z - c.z)
        const across = 2 * o
        if ((Math.abs(dx - across) < 0.6 && dz < 0.6) || (Math.abs(dz - across) < 0.6 && dx < 0.6)) {
          const mx = (a.x + c.x) / 2, mz = (a.z + c.z) / 2
          if (this.queryRoad(mx, mz).d < 1.5) link(a.id, c.id, true)
        }
      }
    }
    this.walk = { nodes }
  }

  // A* over the sidewalk graph
  findPath(from, to) {
    const nodes = this.walk.nodes
    const open = new Set([from])
    const came = new Map()
    const g = new Map([[from, 0]])
    const f = new Map([[from, 0]])
    const hdist = (a, b) => Math.hypot(nodes[a].x - nodes[b].x, nodes[a].z - nodes[b].z)
    let guard = 0
    while (open.size && guard++ < 2000) {
      let cur = null, best = Infinity
      for (const n of open) if ((f.get(n) ?? Infinity) < best) { best = f.get(n); cur = n }
      if (cur === to) {
        const path = [cur]
        while (came.has(cur)) { cur = came.get(cur); path.unshift(cur) }
        return path
      }
      open.delete(cur)
      for (const l of nodes[cur].links) {
        const tg = g.get(cur) + l.len
        if (tg < (g.get(l.to) ?? Infinity)) {
          came.set(l.to, cur)
          g.set(l.to, tg)
          f.set(l.to, tg + hdist(l.to, to))
          open.add(l.to)
        }
      }
    }
    return null
  }

  nearestWalkNode(x, z) {
    let best = Infinity, id = 0
    for (const n of this.walk.nodes) {
      const d = (n.x - x) ** 2 + (n.z - z) ** 2
      if (d < best) { best = d; id = n.id }
    }
    return id
  }

  // ---------------------------------------------------------------- Textures
  createTextures() {
    const { res } = WORLD
    const heightTex = new THREE.DataTexture(this.heights, res, res, THREE.RedFormat, THREE.FloatType)
    heightTex.minFilter = heightTex.magFilter = THREE.NearestFilter
    heightTex.needsUpdate = true
    const groundTex = new THREE.DataTexture(this.groundMap, res, res, THREE.RGBAFormat, THREE.UnsignedByteType)
    groundTex.minFilter = groundTex.magFilter = THREE.LinearFilter
    groundTex.needsUpdate = true
    this.heightTex = heightTex
    this.groundTex = groundTex
    this.roadTex = this.buildRoadTexture()
    return { heightTex, groundTex, roadTex: this.roadTex }
  }

  // RGBA half-float: R = distance to street centreline, G = Chebyshev distance to the
  // nearest intersection, B = signed sideways offset from the nearest centreline (it
  // interpolates through zero, so centre lines stay crisp), A = zone (+1 paved, -1 dirt).
  buildRoadTexture() {
    const N = 1280
    const size = WORLD.roadTexHalf * 2
    const texel = size / N
    const data = new Float32Array(N * N * 4)
    for (let i = 0; i < N * N; i++) {
      data[i * 4] = 60
      data[i * 4 + 1] = 60
    }
    const toTex = (w) => (w + WORLD.roadTexHalf) / texel - 0.5
    const toWorld = (t) => -WORLD.roadTexHalf + (t + 0.5) * texel
    const raster = (x0, z0, x1, z1, fn) => {
      const tx0 = Math.max(0, Math.floor(toTex(x0))), tx1 = Math.min(N - 1, Math.ceil(toTex(x1)))
      const tz0 = Math.max(0, Math.floor(toTex(z0))), tz1 = Math.min(N - 1, Math.ceil(toTex(z1)))
      for (let tz = tz0; tz <= tz1; tz++) {
        const z = toWorld(tz)
        for (let tx = tx0; tx <= tx1; tx++) fn((tz * N + tx) * 4, toWorld(tx), z)
      }
    }
    const R = 14
    for (const e of this.edges) {
      raster(Math.min(e.ax, e.bx) - R, Math.min(e.az, e.bz) - R, Math.max(e.ax, e.bx) + R, Math.max(e.az, e.bz) + R, (o, x, z) => {
        const d = segDistance(x, z, e.ax, e.az, e.bx, e.bz)
        if (d < data[o]) {
          data[o] = d
          data[o + 2] = e.axis === 'x' ? z - e.az : x - e.ax
        }
      })
    }
    for (const n of this.nodes) {
      if (n.edges.length < 2) continue
      raster(n.x - 16, n.z - 16, n.x + 16, n.z + 16, (o, x, z) => {
        const d = Math.max(Math.abs(x - n.x), Math.abs(z - n.z))
        if (d < data[o + 1]) data[o + 1] = d
      })
    }
    const zoneMask = new Float32Array(N * N * 2)
    for (const zone of this.zones) {
      const ch = zone.type === 'dirt' ? 1 : 0
      if (zone.shape === 'rect') {
        raster(zone.x0 - 1, zone.z0 - 1, zone.x1 + 1, zone.z1 + 1, (o, x, z) => {
          const inside = Math.min(x - zone.x0, zone.x1 - x, z - zone.z0, zone.z1 - z)
          zoneMask[o / 2 + ch] = Math.max(zoneMask[o / 2 + ch], smoothstep(-0.3, 0.3, inside))
        })
      } else if (zone.shape === 'ring') {
        raster(zone.x - zone.r - zone.w - 1, zone.z - zone.r - zone.w - 1, zone.x + zone.r + zone.w + 1, zone.z + zone.r + zone.w + 1, (o, x, z) => {
          const dd = Math.abs(Math.hypot(x - zone.x, z - zone.z) - zone.r)
          zoneMask[o / 2 + ch] = Math.max(zoneMask[o / 2 + ch], smoothstep(zone.w + 0.3, zone.w - 0.3, dd))
        })
      } else if (zone.shape === 'circle') {
        raster(zone.x - zone.r - 1, zone.z - zone.r - 1, zone.x + zone.r + 1, zone.z + zone.r + 1, (o, x, z) => {
          const dd = Math.hypot(x - zone.x, z - zone.z)
          zoneMask[o / 2 + ch] = Math.max(zoneMask[o / 2 + ch], smoothstep(zone.r + 0.3, zone.r - 0.3, dd))
        })
      } else if (zone.shape === 'path') {
        for (let k = 0; k < zone.pts.length - 1; k++) {
          const [ax, az] = zone.pts[k], [bx, bz] = zone.pts[k + 1]
          raster(Math.min(ax, bx) - zone.w - 1, Math.min(az, bz) - zone.w - 1, Math.max(ax, bx) + zone.w + 1, Math.max(az, bz) + zone.w + 1, (o, x, z) => {
            const dd = segDistance(x, z, ax, az, bx, bz)
            zoneMask[o / 2 + ch] = Math.max(zoneMask[o / 2 + ch], smoothstep(zone.w + 0.3, zone.w - 0.3, dd))
          })
        }
      }
    }
    for (let i = 0; i < N * N; i++) data[i * 4 + 3] = zoneMask[i * 2] - zoneMask[i * 2 + 1]
    const half = new Uint16Array(N * N * 4)
    for (let i = 0; i < half.length; i++) half[i] = THREE.DataUtils.toHalfFloat(data[i])
    const tex = new THREE.DataTexture(half, N, N, THREE.RGBAFormat, THREE.HalfFloatType)
    tex.minFilter = tex.magFilter = THREE.LinearFilter
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
    tex.needsUpdate = true
    return tex
  }
}

// GLSL helpers shared by every shader that needs terrain information
export const terrainGLSL = /* glsl */ `
uniform sampler2D uHeightTex;
uniform sampler2D uGroundTex;
const float WORLD_HALF = ${WORLD.half.toFixed(1)};
const float WORLD_RES = ${WORLD.res.toFixed(1)};
const float WORLD_CELL = ${WORLD.cell.toFixed(1)};
float terrainHeight(vec2 xz) {
  vec2 f = clamp((xz + WORLD_HALF) / WORLD_CELL, vec2(0.0), vec2(WORLD_RES - 1.001));
  vec2 i = floor(f);
  vec2 t = f - i;
  ivec2 ii = ivec2(i);
  float a = texelFetch(uHeightTex, ii, 0).r;
  float b = texelFetch(uHeightTex, ii + ivec2(1, 0), 0).r;
  float c = texelFetch(uHeightTex, ii + ivec2(0, 1), 0).r;
  float d = texelFetch(uHeightTex, ii + ivec2(1, 1), 0).r;
  return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
}
vec4 groundMask(vec2 xz) {
  vec2 uv = ((xz + WORLD_HALF) / WORLD_CELL + 0.5) / WORLD_RES;
  return texture2D(uGroundTex, uv);
}
`

export const roadGLSL = /* glsl */ `
uniform sampler2D uRoadTex;
const float ROAD_HW = ${HW.toFixed(2)};
const float ROAD_SW = ${SW.toFixed(2)};
vec4 roadData(vec2 xz) {
  return texture2D(uRoadTex, (xz + ${WORLD.roadTexHalf.toFixed(1)}) / ${(WORLD.roadTexHalf * 2).toFixed(1)});
}
`
