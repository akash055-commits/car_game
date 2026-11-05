// Dense wind-swept grass. A fixed patch of blades follows the camera focus and wraps
// around it in the vertex shader, so density is constant and the CPU cost is zero.
// Blades read terrain height + density from the shared textures, sway in the wind,
// and part around the car.
import * as THREE from 'three'
import { terrainGLSL } from './Layout.js'
import { U, noiseGLSL } from './Uniforms.js'
import { makeRandom } from '../core/math.js'

export class Grass {
  constructor(scene, quality) {
    const sub = quality.grass
    const size = quality.grassPatch
    const count = sub * sub
    const rnd = makeRandom(11)

    const base = new THREE.BufferGeometry()
    // One triangle: x = side (-1/1, 0 at tip), y = 0 base / 1 tip
    base.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 0, 1, 0], 3))
    base.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3))
    const geo = new THREE.InstancedBufferGeometry()
    geo.index = null
    geo.attributes.position = base.attributes.position
    geo.attributes.normal = base.attributes.normal
    const blade = new Float32Array(count * 4)
    const cellSize = size / sub
    for (let ix = 0; ix < sub; ix++) {
      for (let iz = 0; iz < sub; iz++) {
        const i = (ix * sub + iz) * 4
        blade[i] = (ix + rnd.random()) * cellSize
        blade[i + 1] = (iz + rnd.random()) * cellSize
        blade[i + 2] = rnd.random()
        blade[i + 3] = rnd.random()
      }
    }
    geo.setAttribute('aBlade', new THREE.InstancedBufferAttribute(blade, 4))
    geo.instanceCount = count
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5)

    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide })
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, {
        uHeightTex: U.uHeightTex, uGroundTex: U.uGroundTex, uTime: U.uTime, uFocus: U.uFocus,
        uCarPos: U.uCarPos, uWindDir: U.uWindDir, uWindStrength: U.uWindStrength,
        uGrassRoot: U.uGrassRoot, uGrassTip: U.uGrassTip, uWet: U.uWet,
        uPatch: { value: size },
      })
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
attribute vec4 aBlade;
uniform float uTime, uPatch, uWindStrength;
uniform vec3 uFocus, uCarPos;
uniform vec2 uWindDir;
varying float vTip;
varying float vRand;
varying float vShade;
${terrainGLSL}
${noiseGLSL}
`)
        .replace('#include <begin_vertex>', `
vec2 wp = uFocus.xz + mod(aBlade.xy - uFocus.xz + uPatch * 0.5, uPatch) - uPatch * 0.5;
float ground = terrainHeight(wp);
vec4 gm = groundMask(wp);
float keep = step(aBlade.z, gm.r * 1.6);
float dist = length(wp - uFocus.xz);
float fade = 1.0 - smoothstep(uPatch * 0.3, uPatch * 0.5, dist);
float height = (0.5 + aBlade.w * 0.55) * keep * fade * mix(0.55, 1.0, gm.r);
vec3 toCam = cameraPosition - vec3(wp.x, ground, wp.y);
vec2 side = normalize(vec2(-toCam.z, toCam.x) + 1e-4);
float width = 0.16 + aBlade.z * 0.1;
vec3 transformed = vec3(wp.x, ground, wp.y);
transformed.xz += side * position.x * width;
transformed.y += position.y * height;
// Wind: slow gust waves + fast flutter
float gust = vnoise(wp * 0.07 - uWindDir * uTime * 0.6);
float flutter = sin(uTime * 2.3 + aBlade.w * 6.28 + wp.x * 0.4 + wp.y * 0.3) * 0.25;
vec2 bend = uWindDir * (gust * 1.1 + flutter) * uWindStrength * 0.55;
// Push away from the car
vec2 away = wp - uCarPos.xz;
float d = length(away);
bend += (away / max(d, 0.001)) * smoothstep(2.4, 0.7, d) * 0.9 * step(abs(uCarPos.y - ground), 2.0);
transformed.xz += bend * position.y * height;
transformed.y -= length(bend) * position.y * height * 0.45;
vTip = position.y;
vRand = aBlade.w;
vShade = gust;
`)
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
uniform vec3 uGrassRoot, uGrassTip;
uniform float uWet;
varying float vTip;
varying float vRand;
varying float vShade;
`)
        .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);')
        .replace('#include <color_fragment>', `#include <color_fragment>
vec3 gcol = mix(uGrassRoot, uGrassTip, smoothstep(0.0, 1.0, vTip));
gcol *= 0.82 + vRand * 0.3 + vShade * 0.12;
gcol *= 1.0 - uWet * 0.18;
diffuseColor.rgb = gcol;`)
    }

    this.mesh = new THREE.Mesh(geo, mat)
    this.mesh.frustumCulled = false
    this.mesh.receiveShadow = true
    scene.add(this.mesh)
  }
}
