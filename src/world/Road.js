// Road ribbon conformed to the terrain, shaded as worn stone pavers with curbs.
// Gets darker, glossier and puddled in the Monsoon season.
import * as THREE from 'three'
import { WORLD } from './Layout.js'
import { U, noiseGLSL } from './Uniforms.js'

export class Road {
  constructor(scene, layout) {
    const N = layout.roadCount
    const hw = WORLD.roadHalfWidth + 0.35
    const across = [-1, -0.82, -0.5, 0, 0.5, 0.82, 1]
    const cols = across.length
    const pos = []
    const uv = []
    for (let i = 0; i <= N; i++) {
      const j = i % N
      const x = layout.roadX[j], z = layout.roadZ[j], h = layout.roadH[j]
      const nx = -layout.roadTZ[j], nz = layout.roadTX[j] // left normal
      for (const a of across) {
        const px = x + nx * a * hw, pz = z + nz * a * hw
        let py = h + 0.05
        if (Math.abs(a) > 0.9) py = Math.max(py, layout.getHeight(px, pz) + 0.04)
        pos.push(px, py, pz)
        uv.push(a * hw, i * layout.roadStep)
      }
    }
    const index = []
    for (let i = 0; i < N; i++) {
      if (layout.isOnBridge(i) && layout.isOnBridge((i + 1) % N)) continue // bridge deck replaces road
      for (let k = 0; k < cols - 1; k++) {
        const a = i * cols + k, b = a + 1, c = a + cols, d = c + 1
        index.push(a, b, c, b, d, c)
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    geo.setIndex(index)
    geo.computeVertexNormals()

    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.85,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    })
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, { uRoad: U.uRoad, uRoadEdge: U.uRoadEdge, uWet: U.uWet, uTime: U.uTime, uAutumn: U.uAutumn, uLeafB: U.uLeafB, uLeafA: U.uLeafA })
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vRoadUv;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvRoadUv = uv;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec2 vRoadUv;
uniform vec3 uRoad, uRoadEdge, uLeafA, uLeafB;
uniform float uWet, uTime, uAutumn;
${noiseGLSL}
float rPuddle; float rGap;
`)
        .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec2 p = vRoadUv;
  float lateral = abs(p.x);
  // Running-bond pavers
  vec2 cell = vec2(0.62, 0.42);
  float row = floor(p.y / cell.y);
  vec2 q = vec2(p.x + mod(row, 2.0) * cell.x * 0.5, p.y);
  vec2 id = floor(q / cell);
  vec2 f = fract(q / cell);
  vec2 e = min(f, 1.0 - f) * cell;
  float gap = 1.0 - smoothstep(0.012, 0.04, min(e.x, e.y));
  float rnd = hash12(id);
  vec3 stone = uRoad * (0.86 + rnd * 0.24);
  stone = mix(stone, stone * vec3(1.05, 0.97, 0.9), step(0.7, hash12(id + 4.0)));
  // Worn wheel tracks are smoother and lighter
  float track = smoothstep(0.55, 0.15, abs(lateral - 1.0));
  stone *= 1.0 + track * 0.06;
  gap *= 1.0 - track * 0.5;
  vec3 col = mix(stone, uRoadEdge * 0.55, gap * 0.85);
  // Curbs
  float curb = smoothstep(${(WORLD.roadHalfWidth - 0.1).toFixed(2)}, ${(WORLD.roadHalfWidth + 0.05).toFixed(2)}, lateral);
  vec3 curbCol = mix(uRoadEdge, uRoadEdge * 1.25, step(0.5, fract(p.y / 1.6)));
  col = mix(col, curbCol, curb);
  float edgeDirt = smoothstep(${(WORLD.roadHalfWidth - 1.2).toFixed(2)}, ${(WORLD.roadHalfWidth + 0.35).toFixed(2)}, lateral) * fbm2(p * 0.8);
  col = mix(col, uRoadEdge * 0.8, edgeDirt * 0.5);
  col *= 0.92 + fbm2(p * 0.25) * 0.16;
  // Autumn leaves blown onto the road edges
  float leafy = step(0.78, vnoise(p * 2.7 + 3.0)) * step(0.55, hash12(floor(p * 5.0))) * uAutumn * smoothstep(1.5, 3.4, lateral);
  col = mix(col, mix(uLeafA, uLeafB, hash12(floor(p * 5.0) + 1.0)), leafy * 0.8);
  // Monsoon: wet stone + puddles collecting in dips
  rPuddle = smoothstep(0.6, 0.68, fbm2(p * vec2(0.35, 0.18) + 2.0)) * uWet * (1.0 - curb);
  rGap = gap;
  col *= 1.0 - uWet * 0.32;
  col = mix(col, col * 0.55, rPuddle);
  diffuseColor.rgb = col;
}`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor + rGap * 0.1, 0.32, uWet);
roughnessFactor = mix(roughnessFactor, 0.03, rPuddle);`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  // Rain ripples in puddles
  vec2 rp = vRoadUv * 3.0;
  vec2 rc = floor(rp);
  float ph = fract(uTime * 0.9 + hash12(rc));
  float rr = length(fract(rp) - 0.5 - (vec2(hash12(rc + 1.0), hash12(rc + 2.0)) - 0.5) * 0.4);
  float ring = sin((rr - ph * 0.5) * 60.0) * smoothstep(0.5, 0.0, rr) * (1.0 - ph) * rPuddle;
  normal = normalize(normal + vec3(ring * 0.15, 0.0, ring * 0.15));
}`)
    }
    this.mesh = new THREE.Mesh(geo, mat)
    this.mesh.receiveShadow = true
    scene.add(this.mesh)
  }
}
