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

export class Terrain {
  constructor(scene, layout) {
    const { res, half, cell } = WORLD
    const count = res * res
    const pos = new Float32Array(count * 3)
    for (let iz = 0; iz < res; iz++) {
      for (let ix = 0; ix < res; ix++) {
        const i = iz * res + ix
        pos[i * 3] = ix * cell - half
        pos[i * 3 + 1] = layout.heights[i]
        pos[i * 3 + 2] = iz * cell - half
      }
    }
    const idx = new Uint32Array((res - 1) * (res - 1) * 6)
    let k = 0
    for (let iz = 0; iz < res - 1; iz++) {
      for (let ix = 0; ix < res - 1; ix++) {
        const a = iz * res + ix, b = a + 1, c = a + res, d = c + 1
        idx[k++] = a; idx[k++] = c; idx[k++] = b
        idx[k++] = b; idx[k++] = c; idx[k++] = d
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setIndex(new THREE.BufferAttribute(idx, 1))
    geo.computeVertexNormals()

    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 })
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, {
        uHeightTex: U.uHeightTex, uGroundTex: U.uGroundTex, uTime: U.uTime,
        uGrassRoot: U.uGrassRoot, uGrassTip: U.uGrassTip, uGround: U.uGround, uDirt: U.uDirt,
        uSand: U.uSand, uRock: U.uRock, uLeafA: U.uLeafA, uLeafB: U.uLeafB, uLeafC: U.uLeafC,
        uWet: U.uWet, uAutumn: U.uAutumn, uSpring: U.uSpring, uFlowerA: U.uFlowerA, uFlowerB: U.uFlowerB,
        uRoadTex: U.uRoadTex, uRoad: U.uRoad, uRoadEdge: U.uRoadEdge, uAsphalt: U.uAsphalt,
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
  float litter = step(0.72, vnoise(xz * 3.1 + 11.0)) * step(0.5, hash12(floor(xz * 6.0))) * uAutumn * (1.0 - m.g) * (1.0 - m.b);
  vec3 leaf = mix(uLeafA, mix(uLeafB, uLeafC, hash12(floor(xz * 6.0) + 3.0)), hash12(floor(xz * 6.0) + 9.0));
  col = mix(col, leaf, litter * 0.85);
  // Spring flower specks
  float fl = step(0.86, hash12(floor(xz * 4.0))) * smoothstep(0.4, 0.8, m.r) * step(0.55, vnoise(xz * 0.4)) * uSpring;
  col = mix(col, mix(uFlowerA, uFlowerB, hash12(floor(xz * 4.0) + 5.0)), fl);
  // ---- Town surfaces: dirt yards, paved plazas, sidewalks, curbs, asphalt + markings
  vec4 rd = roadData(xz);
  float dR = rd.r;
  float hard = 0.0;
  float zPaved = clamp(rd.a, 0.0, 1.0), zDirt = clamp(-rd.a, 0.0, 1.0);
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
  float walk = smoothstep(ROAD_HW + 0.2, ROAD_HW + 0.26, dR) * (1.0 - smoothstep(ROAD_HW + ROAD_SW - 0.05, ROAD_HW + ROAD_SW + 0.05, dR));
  {
    vec2 tcell = floor(xz / 0.9);
    vec2 tf = fract(xz / 0.9);
    float tg = 1.0 - smoothstep(0.02, 0.06, min(min(tf.x, 1.0 - tf.x), min(tf.y, 1.0 - tf.y)));
    vec3 tile = mix(uRoad, vec3(0.86, 0.84, 0.8), 0.45) * (0.92 + hash12(tcell) * 0.1);
    tile = mix(tile, uRoadEdge, tg * 0.45);
    col = mix(col, tile, walk);
    hard = max(hard, walk);
  }
  float curb = smoothstep(ROAD_HW - 0.02, ROAD_HW + 0.02, dR) * (1.0 - smoothstep(ROAD_HW + 0.2, ROAD_HW + 0.26, dR));
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
    float zebra = step(ROAD_HW + 0.8, jd) * (1.0 - step(ROAD_HW + 3.2, jd)) * step(0.5, fract(dR / 0.9 + 0.25)) * step(dR, ROAD_HW - 0.3);
    float paint = max(max(centre, edgeLine * 0.85), zebra);
    paint *= 0.75 + 0.25 * vnoise(xz * 3.0);
    asp = mix(asp, vec3(0.92, 0.9, 0.84), paint);
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

    this.mesh = new THREE.Mesh(geo, mat)
    this.mesh.receiveShadow = true
    this.mesh.castShadow = true
    scene.add(this.mesh)
  }
}
