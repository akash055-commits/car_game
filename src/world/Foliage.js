// Trees and bushes made of clustered alpha-tested leaf cards with spherical normals,
// giving soft, fluffy crowns. Colours come from the season palette per tree, so
// switching season recolours every tree without touching geometry.
import * as THREE from 'three'
import { U, occlusionGLSL } from './Uniforms.js'
import { makeRandom } from '../core/math.js'

export function createLeafTexture() {
  const size = 128
  const cv = document.createElement('canvas')
  cv.width = cv.height = size
  const ctx = cv.getContext('2d')
  const rnd = makeRandom(5)
  ctx.clearRect(0, 0, size, size)
  for (let i = 0; i < 22; i++) {
    const a = rnd.random() * Math.PI * 2
    const r = Math.sqrt(rnd.random()) * size * 0.3
    const x = size / 2 + Math.cos(a) * r
    const y = size / 2 + Math.sin(a) * r
    const shade = 170 + Math.floor(rnd.random() * 85)
    ctx.fillStyle = `rgb(${shade},${shade},${shade})`
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(rnd.random() * Math.PI)
    ctx.beginPath()
    ctx.ellipse(0, 0, size * 0.13, size * 0.07, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.generateMipmaps = true
  tex.minFilter = THREE.LinearMipmapLinearFilter
  return tex
}

function cardMaterial(leafTex, { pushFromCar = false } = {}) {
  const mat = new THREE.MeshLambertMaterial({ map: leafTex, alphaTest: 0.45, side: THREE.DoubleSide })
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uTime: U.uTime, uWindDir: U.uWindDir, uWindStrength: U.uWindStrength, uCarPos: U.uCarPos,
      uLeafA: U.uLeafA, uLeafB: U.uLeafB, uLeafC: U.uLeafC, uWet: U.uWet,
    })
    shader.uniforms.uCarPos = U.uCarPos
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 aCenter; // crown centre xyz, crown radius
attribute vec2 aRand;   // tree random, card random
uniform float uTime, uWindStrength;
uniform vec2 uWindDir;
uniform vec3 uCarPos;
varying vec2 vRand;
varying float vAO;
varying vec3 vWP;
`)
      .replace('#include <defaultnormal_vertex>', `#include <defaultnormal_vertex>
vec3 cardWorld = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
vec3 sph = normalize(cardWorld - aCenter.xyz + vec3(0.0, aCenter.w * 0.35, 0.0));
transformedNormal = normalize(normalMatrix * sph);
`)
      .replace('#include <project_vertex>', `
vec4 wPos = instanceMatrix * vec4(transformed, 1.0);
float h = max(wPos.y - (aCenter.y - aCenter.w), 0.0);
float sway = sin(uTime * 1.4 + aCenter.x * 0.21 + aCenter.z * 0.17) * 0.6 + sin(uTime * 3.1 + aRand.y * 6.28) * 0.15;
wPos.xz += uWindDir * sway * uWindStrength * h * 0.05;
${pushFromCar ? `vec2 away = wPos.xz - uCarPos.xz; float dd = length(away);
wPos.xz += away / max(dd, 0.001) * smoothstep(2.2, 0.5, dd) * 0.6;
wPos.y -= smoothstep(2.2, 0.5, dd) * 0.25;` : ''}
vec4 mvPosition = viewMatrix * modelMatrix * wPos;
gl_Position = projectionMatrix * mvPosition;
vWP = wPos.xyz;
vRand = aRand;
float up = dot(normalize(cardWorld - aCenter.xyz), vec3(0.0, 1.0, 0.0));
float outer = length(cardWorld - aCenter.xyz) / aCenter.w;
vAO = mix(0.5, 1.0, smoothstep(-0.9, 0.7, up)) * mix(0.75, 1.0, smoothstep(0.3, 1.0, outer));
`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec3 uLeafA, uLeafB, uLeafC, uCarPos;
uniform float uWet;
varying vec2 vRand;
varying float vAO;
varying vec3 vWP;
${occlusionGLSL}
`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
if (bayer4(gl_FragCoord.xy) < carOcclusion(vWP, uCarPos) * 0.9) discard;`)
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);')
      .replace('#include <color_fragment>', `#include <color_fragment>
float r = clamp(vRand.x + (vRand.y - 0.5) * 0.28, 0.0, 1.0);
vec3 leaf = mix(uLeafA, uLeafB, smoothstep(0.3, 0.5, r));
leaf = mix(leaf, uLeafC, smoothstep(0.68, 0.86, r));
diffuseColor.rgb *= leaf * vAO * (1.0 - uWet * 0.15);`)
  }
  return mat
}

function trunkMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 })
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTrunk = U.uTrunk
    shader.uniforms.uWet = U.uWet
    shader.uniforms.uCarPos = U.uCarPos
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWP = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform vec3 uTrunk, uCarPos;\nuniform float uWet;\nvarying vec3 vWP;\n${occlusionGLSL}`)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (bayer4(gl_FragCoord.xy) < carOcclusion(vWP, uCarPos) * 0.9) discard;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = uTrunk * (1.0 - uWet * 0.3);')
  }
  return mat
}

function trunkGeometry() {
  const main = new THREE.CylinderGeometry(0.16, 0.3, 1, 7, 1).translate(0, 0.5, 0)
  const b1 = new THREE.CylinderGeometry(0.05, 0.1, 0.9, 5).translate(0, 0.45, 0)
  b1.rotateZ(0.8).translate(0.08, 0.6, 0)
  const b2 = new THREE.CylinderGeometry(0.04, 0.09, 0.8, 5).translate(0, 0.4, 0)
  b2.rotateZ(-0.9).rotateY(1.8).translate(-0.05, 0.72, 0.05)
  const merged = mergeSimple([main, b1, b2])
  return merged
}

// Tiny merge helper (avoids pulling BufferGeometryUtils for 3 parts)
function mergeSimple(geos) {
  const pos = [], nor = [], idx = []
  let offset = 0
  for (const g of geos) {
    const gi = g.index ? g.index.array : null
    pos.push(...g.attributes.position.array)
    nor.push(...g.attributes.normal.array)
    if (gi) for (const i of gi) idx.push(i + offset)
    offset += g.attributes.position.count
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  out.setIndex(idx)
  return out
}

export class Foliage {
  constructor(scene, physics, layout, quality) {
    const rnd = makeRandom(23)
    this.leafTex = createLeafTexture()
    const trees = []
    const bushes = []

    // Tree placement: clustered groves via noise, denser towards the valley rim
    let attempts = 0
    while (trees.length < 230 && attempts < 12000) {
      attempts++
      const x = rnd.range(-108, 108), z = rnd.range(-108, 108)
      const rr = Math.max(Math.abs(x), Math.abs(z))
      const grove = layout.n2(x * 0.03 + 20, z * 0.03) * 0.5 + 0.5
      const chance = rr > 85 ? 0.7 : grove > 0.55 ? 0.6 : 0.1
      if (rnd.random() > chance) continue
      const r = rnd.range(1.6, 2.7)
      if (!layout.isFree(x, z, 1.4, { roadMargin: 1.8 })) continue
      const y = layout.getHeight(x, z)
      if (y < 0) continue
      trees.push({ x, z, y, r, h: rnd.range(1.6, 2.8), rand: rnd.random() })
      layout.occupy(x, z, 1.3)
    }
    attempts = 0
    while (bushes.length < 150 && attempts < 8000) {
      attempts++
      const x = rnd.range(-100, 100), z = rnd.range(-100, 100)
      if (!layout.isFree(x, z, 0.9, { roadMargin: 1.0 })) continue
      const y = layout.getHeight(x, z)
      if (y < -0.1) continue
      bushes.push({ x, z, y, r: rnd.range(0.8, 1.35), rand: rnd.random() })
      layout.occupy(x, z, 0.6)
    }
    this.trees = trees

    // Trunks + colliders
    const trunkGeo = trunkGeometry()
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMaterial(), trees.length)
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const s = new THREE.Vector3()
    const p = new THREE.Vector3()
    const R = physics.RAPIER
    trees.forEach((t, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.rand * 6.28)
      m.compose(p.set(t.x, t.y - 0.1, t.z), q, s.set(1 + t.r * 0.15, t.h + t.r * 0.6, 1 + t.r * 0.15))
      trunks.setMatrixAt(i, m)
      const body = physics.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(t.x, t.y + 1.5, t.z))
      const col = physics.world.createCollider(R.ColliderDesc.cylinder(1.5, 0.32).setRestitution(0.2), body)
      physics.tag(col, { kind: 'tree', material: 'wood' })
      layout.clearGrass(t.x, t.z, 0.9, 0.6)
    })
    trunks.castShadow = true
    trunks.receiveShadow = true
    scene.add(trunks)
    this.trunks = trunks

    this.crowns = this.buildCards(scene, trees.map((t) => ({ cx: t.x, cy: t.y + t.h + t.r * 0.75, cz: t.z, r: t.r, rand: t.rand })), quality.foliageCards, rnd, false)
    this.bushes = this.buildCards(scene, bushes.map((b) => ({ cx: b.x, cy: b.y + b.r * 0.55, cz: b.z, r: b.r, rand: b.rand })), Math.round(quality.foliageCards * 0.32), rnd, true)
  }

  buildCards(scene, crowns, perCrown, rnd, pushFromCar) {
    const total = crowns.length * perCrown
    const geo = new THREE.PlaneGeometry(1, 1)
    const centers = new Float32Array(total * 4)
    const rands = new Float32Array(total * 2)
    const mesh = new THREE.InstancedMesh(geo, cardMaterial(this.leafTex, { pushFromCar }), total)
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const e = new THREE.Euler()
    const p = new THREE.Vector3()
    const s = new THREE.Vector3()
    const dir = new THREE.Vector3()
    const look = new THREE.Matrix4()
    let k = 0
    for (const c of crowns) {
      for (let j = 0; j < perCrown; j++) {
        // Points inside a slightly squashed ellipsoid, biased outward
        dir.set(rnd.range(-1, 1), rnd.range(-0.75, 1), rnd.range(-1, 1)).normalize()
        const rad = Math.pow(rnd.random(), 0.45) * c.r
        p.set(c.cx + dir.x * rad, c.cy + dir.y * rad * 0.82, c.cz + dir.z * rad)
        look.lookAt(p, new THREE.Vector3(c.cx, c.cy, c.cz), new THREE.Vector3(0, 1, 0))
        q.setFromRotationMatrix(look)
        q.multiply(new THREE.Quaternion().setFromEuler(e.set(0, 0, rnd.random() * 6.28)))
        const sc = rnd.range(0.9, 1.5) * (0.65 + c.r * 0.22)
        m.compose(p, q, s.set(sc, sc, sc))
        mesh.setMatrixAt(k, m)
        centers.set([c.cx, c.cy, c.cz, c.r], k * 4)
        rands.set([c.rand, rnd.random()], k * 2)
        k++
      }
    }
    geo.setAttribute('aCenter', new THREE.InstancedBufferAttribute(centers, 4))
    geo.setAttribute('aRand', new THREE.InstancedBufferAttribute(rands, 2))
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: this.leafTex, alphaTest: 0.45 })
    mesh.computeBoundingSphere()
    scene.add(mesh)
    return mesh
  }
}
