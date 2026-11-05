// World layout: the single source of truth for terrain heights, the road circuit,
// water bodies and ground masks. Visual meshes, physics colliders and shaders all
// read from here so everything lines up exactly.
import * as THREE from 'three'
import { SimplexNoise } from 'three/examples/jsm/math/SimplexNoise.js'
import { clamp, lerp, smoothstep, makeRandom } from '../core/math.js'

export const WORLD = {
  size: 240,
  res: 241, // one height sample per metre
  half: 120,
  waterLevel: -0.45,
  roadHalfWidth: 3.6,
  playRadius: 96,
}

const ROAD_POINTS = [
  [0, 40], [34, 46], [62, 32], [72, 4], [60, -28], [36, -50], [4, -62],
  [-28, -54], [-52, -30], [-46, 0], [-64, 26], [-46, 54], [-20, 44],
]

const LAKE = { x: 8, z: -6, r: 20 }
const POND = { x: 74, z: -66, r: 9 }
const STREAM = [
  [LAKE.x + 12, LAKE.z - 14], [34, -32], [46, -44], [58, -54], [POND.x - 4, POND.z + 3],
]

// Areas kept flat for props (cabin, ramps, start)
const FLAT_ZONES = [
  { x: -22, z: 14, r: 9 }, // cabin clearing
  { x: 30, z: 20, r: 12 }, // ramp meadow
  { x: -30, z: -24, r: 10 }, // crate yard
  { x: -80, z: -55, r: 10 }, // far ramp
]

function segDistance(px, pz, ax, az, bx, bz) {
  const abx = bx - ax, abz = bz - az
  const t = clamp(((px - ax) * abx + (pz - az) * abz) / (abx * abx + abz * abz), 0, 1)
  const dx = px - (ax + abx * t), dz = pz - (az + abz * t)
  return Math.sqrt(dx * dx + dz * dz)
}

export class Layout {
  constructor() {
    const rnd = makeRandom(7)
    this.noise = new SimplexNoise({ random: rnd.random })
    this.lake = LAKE
    this.pond = POND
    this.stream = STREAM
    this.flatZones = FLAT_ZONES
    this.occupied = []

    this.buildRoad()
    this.buildHeights()
    this.buildMaps()
  }

  n2(x, z) {
    return this.noise.noise(x, z)
  }

  baseHeight(x, z) {
    const n = this.n2(x * 0.018, z * 0.018) * 2.2 + this.n2(x * 0.05 + 10, z * 0.05 - 3) * 0.6
    const rr = Math.pow(Math.pow(Math.abs(x), 4) + Math.pow(Math.abs(z), 4), 0.25)
    const bowl = smoothstep(45, 95, rr) * 2.5
    const rim = smoothstep(90, 118, rr) * (14 + 7 * this.n2(x * 0.03 + 5, z * 0.03))
    return n + bowl + rim
  }

  lakeRadius(lake, ang) {
    return lake.r * (1 + 0.14 * Math.sin(3 * ang + 1.3) + 0.08 * Math.sin(5 * ang - 0.4))
  }

  lakeQ(lake, x, z) {
    const dx = x - lake.x, dz = z - lake.z
    return Math.sqrt(dx * dx + dz * dz) / this.lakeRadius(lake, Math.atan2(dz, dx))
  }

  streamDistance(x, z) {
    let d = Infinity
    for (let i = 0; i < STREAM.length - 1; i++) {
      d = Math.min(d, segDistance(x, z, STREAM[i][0], STREAM[i][1], STREAM[i + 1][0], STREAM[i + 1][1]))
    }
    return d
  }

  // ---------------------------------------------------------------- Road
  buildRoad() {
    const pts = ROAD_POINTS.map(([x, z]) => new THREE.Vector3(x, 0, z))
    this.curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal')
    this.roadLength = this.curve.getLength()
    const N = Math.round(this.roadLength / 0.5)
    const spaced = this.curve.getSpacedPoints(N).slice(0, N)
    this.roadCount = N
    this.roadStep = this.roadLength / N
    this.roadX = new Float32Array(N)
    this.roadZ = new Float32Array(N)
    this.roadTX = new Float32Array(N)
    this.roadTZ = new Float32Array(N)
    this.roadH = new Float32Array(N)
    for (let i = 0; i < N; i++) {
      this.roadX[i] = spaced[i].x
      this.roadZ[i] = spaced[i].z
    }
    for (let i = 0; i < N; i++) {
      const a = (i - 1 + N) % N, b = (i + 1) % N
      let tx = this.roadX[b] - this.roadX[a], tz = this.roadZ[b] - this.roadZ[a]
      const l = Math.hypot(tx, tz) || 1
      this.roadTX[i] = tx / l
      this.roadTZ[i] = tz / l
    }

    // Spatial hash for fast nearest-road queries
    this.cell = 12
    this.grid = new Map()
    for (let i = 0; i < N; i++) {
      const k = this.cellKey(Math.floor(this.roadX[i] / this.cell), Math.floor(this.roadZ[i] / this.cell))
      if (!this.grid.has(k)) this.grid.set(k, [])
      this.grid.get(k).push(i)
    }

    // Find where the stream crosses the road -> bridge
    let best = Infinity, bi = 0
    for (let i = 0; i < N; i++) {
      const d = this.streamDistance(this.roadX[i], this.roadZ[i])
      if (d < best) { best = d; bi = i }
    }
    this.bridge = { index: bi, halfLength: 9, halfSamples: Math.round(9 / this.roadStep) }

    // Road height profile: terrain sampled along the road, heavily smoothed for gentle grades
    for (let i = 0; i < N; i++) this.roadH[i] = this.baseHeight(this.roadX[i], this.roadZ[i])
    const tmp = new Float32Array(N)
    const win = 30
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < N; i++) {
        let s = 0
        for (let k = -win; k <= win; k++) s += this.roadH[(i + k + N) % N]
        tmp[i] = s / (win * 2 + 1)
      }
      this.roadH.set(tmp)
    }
    for (let i = 0; i < N; i++) {
      const ds = this.ringDelta(i, bi) * this.roadStep
      let h = Math.max(this.roadH[i], WORLD.waterLevel + 0.7)
      if (Math.abs(ds) < this.bridge.halfLength + 6) {
        const k = 1 - smoothstep(this.bridge.halfLength, this.bridge.halfLength + 6, Math.abs(ds))
        h = lerp(h, Math.max(h, WORLD.waterLevel + 1.1), k)
      }
      if (Math.abs(ds) < this.bridge.halfLength) {
        const c = Math.cos((ds / this.bridge.halfLength) * Math.PI * 0.5)
        h += 0.75 * c * c
      }
      this.roadH[i] = h
    }
  }

  ringDelta(i, j) {
    const N = this.roadCount
    let d = i - j
    if (d > N / 2) d -= N
    if (d < -N / 2) d += N
    return d
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
    // lateral sign: + is to the left of travel direction
    out.side = (x - this.roadX[bi]) * -this.roadTZ[bi] + (z - this.roadZ[bi]) * this.roadTX[bi]
    return out
  }

  isOnBridge(i) {
    return i >= 0 && Math.abs(this.ringDelta(i, this.bridge.index)) <= this.bridge.halfSamples
  }

  // ---------------------------------------------------------------- Heights
  buildHeights() {
    const { res, half, roadHalfWidth: hw, waterLevel: W } = WORLD
    this.heights = new Float32Array(res * res) // visual, row-major [iz * res + ix]
    this.physHeights = new Float32Array(res * res) // physics, column-major for Rapier [ix * res + iz]
    this.roadDist = new Float32Array(res * res)
    const q = {}
    for (let iz = 0; iz < res; iz++) {
      for (let ix = 0; ix < res; ix++) {
        const x = ix - half, z = iz - half
        let h = this.baseHeight(x, z)

        for (const f of FLAT_ZONES) {
          const d = Math.hypot(x - f.x, z - f.z)
          if (d < f.r + 8) {
            f.h ??= this.baseHeight(f.x, f.z)
            h = lerp(f.h, h, smoothstep(f.r, f.r + 8, d))
          }
        }

        this.queryRoad(x, z, q)
        this.roadDist[iz * res + ix] = q.d
        if (q.i >= 0) {
          const t = smoothstep(hw + 0.6, hw + 7, q.d)
          h = lerp(this.roadH[q.i], h, t)
        }
        h = Math.max(h, W + 0.45)
        let hPhys = h

        // Water carving
        const lq = this.lakeQ(LAKE, x, z)
        h = lerp(h, -2.6, smoothstep(1.22, 0.55, lq))
        const pq = this.lakeQ(POND, x, z)
        h = lerp(h, -1.8, smoothstep(1.3, 0.5, pq))
        const ds = this.streamDistance(x, z)
        if (ds < 7) h = Math.min(h, lerp(h, -1.4, smoothstep(6.5, 1.6, ds)))

        // Physics keeps the road deck solid across the bridge (railings stop you falling)
        if (q.i >= 0 && this.isOnBridge(q.i) && q.d < hw + 0.4) hPhys = Math.max(hPhys, this.roadH[q.i])
        else hPhys = h

        this.heights[iz * res + ix] = h
        this.physHeights[ix * res + iz] = hPhys
      }
    }
  }

  // Bilinear visual height lookup
  getHeight(x, z) {
    const { res, half } = WORLD
    const fx = clamp(x + half, 0, res - 1.001), fz = clamp(z + half, 0, res - 1.001)
    const ix = Math.floor(fx), iz = Math.floor(fz)
    const tx = fx - ix, tz = fz - iz
    const h = this.heights
    const a = h[iz * res + ix], b = h[iz * res + ix + 1]
    const c = h[(iz + 1) * res + ix], d = h[(iz + 1) * res + ix + 1]
    return lerp(lerp(a, b, tx), lerp(c, d, tx), tz)
  }

  // Surface the car actually drives on (road deck on the bridge)
  getDriveHeight(x, z) {
    const q = this.queryRoad(x, z)
    if (q.i >= 0 && q.d < WORLD.roadHalfWidth + 0.4) return this.roadH[q.i]
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
    const { res, half, roadHalfWidth: hw, waterLevel: W } = WORLD
    // RGBA: R = grass density, G = road, B = shore/sand, A = dirt patches
    this.groundMap = new Uint8Array(res * res * 4)
    for (let iz = 0; iz < res; iz++) {
      for (let ix = 0; ix < res; ix++) {
        const x = ix - half, z = iz - half
        const i = iz * res + ix
        const h = this.heights[i]
        const d = this.roadDist[i]
        // slope from neighbours
        const hl = this.heights[iz * res + Math.max(0, ix - 1)], hr = this.heights[iz * res + Math.min(res - 1, ix + 1)]
        const hd = this.heights[Math.max(0, iz - 1) * res + ix], hu = this.heights[Math.min(res - 1, iz + 1) * res + ix]
        const slope = Math.hypot(hr - hl, hu - hd) * 0.5
        const road = 1 - smoothstep(hw - 0.4, hw + 0.7, d)
        const nearWater = Math.max(smoothstep(1.45, 1.05, this.lakeQ(LAKE, x, z)), smoothstep(1.6, 1.1, this.lakeQ(POND, x, z)), smoothstep(9, 4.5, this.streamDistance(x, z)))
        const shore = nearWater * smoothstep(W + 1.1, W + 0.25, h)
        const dirt = smoothstep(0.42, 0.8, this.n2(x * 0.06 + 40, z * 0.06 - 12) * 0.5 + 0.5) * 0.7
        let grass = smoothstep(hw + 0.3, hw + 2.6, d) * smoothstep(W + 0.35, W + 0.9, h) * (1 - smoothstep(0.55, 1.0, slope))
        grass *= 1 - dirt * 0.75
        grass *= 0.65 + 0.35 * (this.n2(x * 0.11, z * 0.11) * 0.5 + 0.5)
        this.groundMap[i * 4] = clamp(grass * 255, 0, 255)
        this.groundMap[i * 4 + 1] = clamp(road * 255, 0, 255)
        this.groundMap[i * 4 + 2] = clamp(shore * 255, 0, 255)
        this.groundMap[i * 4 + 3] = clamp(dirt * 255, 0, 255)
      }
    }
  }

  // Remove grass under a prop footprint (call before textures are created)
  clearGrass(x, z, r, strength = 1) {
    const { res, half } = WORLD
    const x0 = Math.max(0, Math.floor(x - r + half)), x1 = Math.min(res - 1, Math.ceil(x + r + half))
    const z0 = Math.max(0, Math.floor(z - r + half)), z1 = Math.min(res - 1, Math.ceil(z + r + half))
    for (let iz = z0; iz <= z1; iz++) {
      for (let ix = x0; ix <= x1; ix++) {
        const d = Math.hypot(ix - half - x, iz - half - z)
        const k = 1 - smoothstep(r * 0.6, r, d) * 1
        const i = (iz * res + ix) * 4
        this.groundMap[i] *= 1 - k * strength
        this.groundMap[i + 3] = Math.max(this.groundMap[i + 3], k * 200 * strength)
      }
    }
  }

  occupy(x, z, r) {
    this.occupied.push({ x, z, r })
  }

  isFree(x, z, r, { roadMargin = 1.5, allowWater = false } = {}) {
    if (Math.max(Math.abs(x), Math.abs(z)) > WORLD.half - 4) return false
    const q = this.queryRoad(x, z)
    if (q.d < WORLD.roadHalfWidth + roadMargin + r) return false
    if (!allowWater && this.getHeight(x, z) < WORLD.waterLevel + 0.5) return false
    for (const o of this.occupied) {
      if (Math.hypot(o.x - x, o.z - z) < o.r + r) return false
    }
    return true
  }

  // Position + heading on the road at sample i (used for spawn / respawn / checkpoints)
  roadFrame(i) {
    const N = this.roadCount
    i = ((i % N) + N) % N
    return {
      x: this.roadX[i],
      z: this.roadZ[i],
      y: this.roadH[i],
      tx: this.roadTX[i],
      tz: this.roadTZ[i],
      heading: Math.atan2(this.roadTX[i], this.roadTZ[i]),
    }
  }

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
    return { heightTex, groundTex }
  }
}

// GLSL helpers shared by every shader that needs terrain information
export const terrainGLSL = /* glsl */ `
uniform sampler2D uHeightTex;
uniform sampler2D uGroundTex;
const float WORLD_HALF = ${WORLD.half.toFixed(1)};
const float WORLD_RES = ${WORLD.res.toFixed(1)};
float terrainHeight(vec2 xz) {
  vec2 f = clamp(xz + WORLD_HALF, vec2(0.0), vec2(WORLD_RES - 1.001));
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
  vec2 uv = (xz + WORLD_HALF + 0.5) / WORLD_RES;
  return texture2D(uGroundTex, uv);
}
`
