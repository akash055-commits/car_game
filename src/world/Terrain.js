// Terrain: one heightfield mesh shaded procedurally from the ground mask + season palette,
// plus the matching Rapier heightfield collider.
import * as THREE from 'three'
import { WORLD, terrainGLSL, roadGLSL } from './Layout.js'
import { U, noiseGLSL } from './Uniforms.js'

export function buildTerrainPhysics(physics, layout) {
  const R = physics.RAPIER
  const n = WORLD.res - 1
  const body = physics.world.createRigidBody(R.RigidBodyDesc.fixed())
  const desc = R.ColliderDesc.heightfield(n, n, layout.physHeights, { x: WORLD.size, y: 1, z: WORLD.size })
    .setFriction(0.9)
  const collider = physics.world.createCollider(desc, body)
  physics.tag(collider, { kind: 'ground', material: 'ground' })

  // Invisible boundary walls well beyond the rim hills
  const h = WORLD.half - 2
  for (const [x, z, sx, sz] of [[h, 0, 1, h], [-h, 0, 1, h], [0, h, h, 1], [0, -h, h, 1]]) {
    const b = physics.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(x, 20, z))
    physics.world.createCollider(R.ColliderDesc.cuboid(sx, 40, sz), b)
  }
  return collider
}

// The valley floor is split into chunks (frustum-culled individually). Each chunk has a
// full-resolution and a half-resolution index buffer, picked by distance, plus a skirt
// that hides the tiny cracks where the two resolutions meet.
const CHUNK = 50 // cells per chunk side (100 m)

export class Terrain {
  constructor(scene, layout, quality = { name: 'high' }) {
    const { res, half, cell } = WORLD
    const H = layout.heights
    const hAt = (ix, iz) => H[Math.min(res - 1, Math.max(0, iz)) * res + Math.min(res - 1, Math.max(0, ix))]
    this.chunks = []
    this.lodFar = quality.name === 'low' ? 140 : 230
    const nC = Math.ceil((res - 1) / CHUNK)
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 })
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, {
        uHeightTex: U.uHeightTex, uGroundTex: U.uGroundTex, uTime: U.uTime,
        uGrassRoot: U.uGrassRoot, uGrassTip: U.uGrassTip, uGround: U.uGround, uDirt: U.uDirt,
        uSand: U.uSand, uRock: U.uRock, uLeafA: U.uLeafA, uLeafB: U.uLeafB, uLeafC: U.uLeafC,
        uWet: U.uWet, uAutumn: U.uAutumn, uSpring: U.uSpring, uFlowerA: U.uFlowerA, uFlowerB: U.uFlowerB,
        uRoadTex: U.uRoadTex, uRoadTex2: U.uRoadTex2, uRoad: U.uRoad, uRoadEdge: U.uRoadEdge, uAsphalt: U.uAsphalt,
      })
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;\nvarying vec3 vWorldNormal;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWorldNormal = normalize(mat3(modelMatrix) * objectNormal);')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
uniform vec3 uGrassRoot, uGrassTip, uGround, uDirt, uSand, uRock, uLeafA, uLeafB, uLeafC, uFlowerA, uFlowerB, uRoad, uRoadEdge, uAsphalt;
uniform float uWet, uAutumn, uSpring, uTime;
${terrainGLSL}
${roadGLSL}
${noiseGLSL}
float gWet;
float gPuddle;
`)
        .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec2 xz = vWorldPos.xz;
  vec4 m = groundMask(xz);
  float n1 = fbm2(xz * 0.35);
  float n2 = vnoise(xz * 2.2);
  vec3 grassFloor = mix(uGrassRoot, uGrassTip, 0.22 + n1 * 0.3);
  vec3 col = mix(uGround, grassFloor, smoothstep(0.05, 0.6, m.r));
  col = mix(col, uDirt * (0.9 + n2 * 0.2), m.a * (1.0 - m.r) * 0.9);
  col = mix(col, uSand * (0.92 + n2 * 0.12), m.b);
  float steep = smoothstep(0.82, 0.62, vWorldNormal.y);
  col = mix(col, uRock * (0.85 + n1 * 0.3), steep);
  col *= 0.88 + n1 * 0.22;
  // Autumn leaf litter
  float litter = step(0.72, vnoise(xz * 3.1 + 11.0)) * step(0.5, hash12(floor(xz * 6.0))) * uAutumn * (1.0 - m.g) * (1.0 - m.b) * (1.0 - m.a);
  vec3 leaf = mix(uLeafA, mix(uLeafB, uLeafC, hash12(floor(xz * 6.0) + 3.0)), hash12(floor(xz * 6.0) + 9.0));
  col = mix(col, leaf, litter * 0.85);
  // Spring flower specks
  float fl = step(0.86, hash12(floor(xz * 4.0))) * smoothstep(0.4, 0.8, m.r) * step(0.55, vnoise(xz * 0.4)) * uSpring;
  col = mix(col, mix(uFlowerA, uFlowerB, hash12(floor(xz * 4.0) + 5.0)), fl);
  // ---- Town surfaces: dirt yards, paved plazas, sidewalks, curbs, asphalt + markings
  vec4 rd = roadData(xz);
  float dR = rd.r;
  float hard = 0.0;
  float hwy = smoothstep(1.4, 1.9, -rd.a);
  float zPaved = clamp(rd.a, 0.0, 1.0), zDirt = clamp(-rd.a, 0.0, 1.0) * (1.0 - hwy);
  col = mix(col, uDirt * (0.85 + n2 * 0.2), zDirt * 0.95);
  // paved zones: cobbles
  {
    vec2 c = xz / 0.55;
    vec2 cid = floor(c + vec2(mod(floor(c.y), 2.0) * 0.5, 0.0));
    vec2 cf = fract(c + vec2(mod(floor(c.y), 2.0) * 0.5, 0.0));
    float grout = 1.0 - smoothstep(0.04, 0.1, min(min(cf.x, 1.0 - cf.x), min(cf.y, 1.0 - cf.y)));
    vec3 cob = uRoad * (0.85 + hash12(cid) * 0.25);
    cob = mix(cob, uRoadEdge * 0.8, grout * 0.7);
    col = mix(col, cob, zPaved);
    hard = max(hard, zPaved);
  }
  float walk = smoothstep(ROAD_HW + 0.2, ROAD_HW + 0.26, dR) * (1.0 - smoothstep(ROAD_HW + ROAD_SW - 0.05, ROAD_HW + ROAD_SW + 0.05, dR)) * (1.0 - hwy);
  // highways: gravel shoulders instead of sidewalks
  float shoulder = hwy * smoothstep(ROAD_HW - 0.05, ROAD_HW + 0.1, dR) * (1.0 - smoothstep(ROAD_HW + 1.6, ROAD_HW + 2.4, dR));
  col = mix(col, mix(uDirt, uRoadEdge, 0.45) * (0.8 + n2 * 0.25), shoulder * 0.92);
  hard = max(hard, shoulder * 0.6);
  {
    vec2 tcell = floor(xz / 0.9);
    vec2 tf = fract(xz / 0.9);
    float tg = 1.0 - smoothstep(0.02, 0.06, min(min(tf.x, 1.0 - tf.x), min(tf.y, 1.0 - tf.y)));
    vec3 tile = mix(uRoad, vec3(0.86, 0.84, 0.8), 0.45) * (0.92 + hash12(tcell) * 0.1);
    tile = mix(tile, uRoadEdge, tg * 0.45);
    col = mix(col, tile, walk);
    hard = max(hard, walk);
  }
  float curb = smoothstep(ROAD_HW - 0.02, ROAD_HW + 0.02, dR) * (1.0 - smoothstep(ROAD_HW + 0.2, ROAD_HW + 0.26, dR)) * (1.0 - hwy);
  col = mix(col, vec3(0.74, 0.71, 0.67), curb);
  float asphalt = 1.0 - smoothstep(ROAD_HW - 0.03, ROAD_HW + 0.03, dR);
  {
    vec3 asp = uAsphalt * (0.88 + fbm2(xz * 0.9) * 0.18 + (hash12(floor(xz * 9.0)) - 0.5) * 0.06);
    // axis-aligned streets: find the direction the street runs along
    float e = 0.6;
    float vx = abs(roadData(xz + vec2(e, 0.0)).r - dR) + abs(roadData(xz - vec2(e, 0.0)).r - dR);
    float vz = abs(roadData(xz + vec2(0.0, e)).r - dR) + abs(roadData(xz - vec2(0.0, e)).r - dR);
    float along = vx < vz ? xz.x : xz.y;
    float jd = rd.g;
    float open = smoothstep(ROAD_HW + 3.4, ROAD_HW + 4.2, jd);
    float centre = (1.0 - smoothstep(0.07, 0.11, abs(rd.b))) * step(fract(along / 4.5), 0.55) * open;
    float edgeLine = (1.0 - smoothstep(0.05, 0.08, abs(dR - (ROAD_HW - 0.45)))) * open;
    // highway centre line is a solid double yellow
    float hc = hwy * (1.0 - smoothstep(0.045, 0.075, abs(abs(rd.b) - 0.16))) * open;
    float zebra = step(ROAD_HW + 0.8, jd) * (1.0 - step(ROAD_HW + 3.2, jd)) * step(0.5, fract(dR / 0.9 + 0.25)) * step(dR, ROAD_HW - 0.3);
    centre *= 1.0 - hwy;
    float paint = max(max(centre, edgeLine * 0.85), zebra);
    paint *= 0.75 + 0.25 * vnoise(xz * 3.0);
    asp = mix(asp, vec3(0.92, 0.9, 0.84), paint);
    asp = mix(asp, vec3(0.95, 0.75, 0.25), hc * (0.8 + 0.2 * vnoise(xz * 3.0)));
    col = mix(col, asp, asphalt);
    hard = max(hard, asphalt);
  }
  // Underwater darkening
  float under = smoothstep(-0.2, -1.2, vWorldPos.y);
  col *= 1.0 - under * 0.35;
  // Rain: wet ground and puddles in dirt
  gPuddle = smoothstep(0.6, 0.68, fbm2(xz * 0.22 + 4.0)) * uWet * max(max(m.a, zDirt), hard * 0.9) * (1.0 - m.b);
  gWet = uWet;
  col *= 1.0 - uWet * 0.28 - gPuddle * 0.25;
  diffuseColor.rgb = col;
}`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.55, gWet);
roughnessFactor = mix(roughnessFactor, 0.06, gPuddle);`)
    }

    for (let cz = 0; cz < nC; cz++) {
      for (let cx = 0; cx < nC; cx++) {
        const ix0 = cx * CHUNK, iz0 = cz * CHUNK
        const nx = Math.min(CHUNK, res - 1 - ix0), nz = Math.min(CHUNK, res - 1 - iz0)
        const vx = nx + 1, vz = nz + 1
        const grid = vx * vz
        const border = 2 * (vx + vz) - 4
        const pos = new Float32Array((grid + border) * 3)
        const nor = new Float32Array((grid + border) * 3)
        const setV = (i, ix, iz, drop = 0) => {
          pos[i * 3] = ix * cell - half
          pos[i * 3 + 1] = hAt(ix, iz) - drop
          pos[i * 3 + 2] = iz * cell - half
          const nxv = hAt(ix - 1, iz) - hAt(ix + 1, iz), nzv = hAt(ix, iz - 1) - hAt(ix, iz + 1)
          const l = Math.hypot(nxv, 2 * cell, nzv)
          nor[i * 3] = nxv / l
          nor[i * 3 + 1] = (2 * cell) / l
          nor[i * 3 + 2] = nzv / l
        }
        for (let z = 0; z < vz; z++) for (let x = 0; x < vx; x++) setV(z * vx + x, ix0 + x, iz0 + z)
        // skirt vertices: one per border vertex, dropped 3 m
        const skirt = new Map()
        let si = grid
        const addSkirt = (x, z) => {
          const k = z * vx + x
          if (skirt.has(k)) return
          skirt.set(k, si)
          setV(si++, ix0 + x, iz0 + z, 3)
        }
        for (let x = 0; x < vx; x++) { addSkirt(x, 0); addSkirt(x, vz - 1) }
        for (let z = 0; z < vz; z++) { addSkirt(0, z); addSkirt(vx - 1, z) }
        const makeIndex = (step) => {
          const idx = []
          for (let z = 0; z < nz; z += step) {
            for (let x = 0; x < nx; x += step) {
              const s1 = Math.min(step, nx - x), s2 = Math.min(step, nz - z)
              const a = z * vx + x, b = a + s1, c = (z + s2) * vx + x, d = c + s1
              idx.push(a, c, b, b, c, d)
            }
          }
          // skirts along the four edges (walls hanging down from the border)
          const edge = (list) => {
            for (let k = 0; k < list.length - 1; k++) {
              const a = list[k], b = list[k + 1]
              const sa = skirt.get(a), sb = skirt.get(b)
              idx.push(a, sa, b, b, sa, sb, a, b, sa, b, sb, sa)
            }
          }
          const pts = (fn, n) => { const out = []; for (let k = 0; k <= n; k += step) out.push(fn(Math.min(k, n))); if (out[out.length - 1] !== fn(n)) out.push(fn(n)); return out }
          edge(pts((x) => x, nx))
          edge(pts((x) => nz * vx + x, nx))
          edge(pts((z) => z * vx, nz))
          edge(pts((z) => z * vx + nx, nz))
          const total = grid + border
          return new THREE.BufferAttribute(total > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1)
        }
        const geo = new THREE.BufferGeometry()
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
        geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
        const full = makeIndex(1), coarse = makeIndex(2)
        geo.setIndex(full)
        geo.computeBoundingSphere()
        geo.computeBoundingBox()
        const mesh = new THREE.Mesh(geo, mat)
        mesh.receiveShadow = true
        mesh.castShadow = true
        mesh.matrixAutoUpdate = false
        scene.add(mesh)
        const c = geo.boundingSphere.center
        this.chunks.push({ mesh, geo, full, coarse, cx: c.x, cz: c.z, lod: 0 })
      }
    }
    this.mesh = this.chunks[0].mesh
    this.lodTimer = 0
  }

  // Swap index buffers by distance from the camera (cheap: no re-upload)
  update(dt, camPos) {
    this.lodTimer -= dt
    if (this.lodTimer > 0) return
    this.lodTimer = 0.3
    const far2 = this.lodFar * this.lodFar
    for (const ch of this.chunks) {
      const d2 = (ch.cx - camPos.x) ** 2 + (ch.cz - camPos.z) ** 2
      const lod = d2 > far2 ? 1 : 0
      if (lod !== ch.lod) {
        ch.lod = lod
        ch.geo.setIndex(lod ? ch.coarse : ch.full)
      }
      ch.mesh.castShadow = d2 < 160 * 160
    }
  }
}
