// GPU-animated weather particles that wrap around the camera focus:
// falling leaves (autumn), drifting petals + butterflies (spring), rain + splashes
// (monsoon) and fireflies (night). Zero per-frame CPU work besides uniforms.
import * as THREE from 'three'
import { terrainGLSL } from '../world/Layout.js'
import { U, noiseGLSL } from '../world/Uniforms.js'
import { makeRandom } from '../core/math.js'

function instanced(base, count, seed, attrs = 4) {
  const geo = new THREE.InstancedBufferGeometry()
  geo.index = base.index
  for (const [k, v] of Object.entries(base.attributes)) geo.setAttribute(k, v)
  const rnd = makeRandom(seed)
  const data = new Float32Array(count * attrs)
  for (let i = 0; i < data.length; i++) data[i] = rnd.random()
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(data, attrs))
  geo.instanceCount = count
  return geo
}

const common = {
  uTime: U.uTime, uFocus: U.uFocus, uWindDir: U.uWindDir, uWindStrength: U.uWindStrength,
  uHeightTex: U.uHeightTex, uGroundTex: U.uGroundTex, uNight: U.uNight,
  uLeafA: U.uLeafA, uLeafB: U.uLeafB, uLeafC: U.uLeafC, uSunColor: U.uSunColor,
}

const headerGLSL = /* glsl */ `
uniform float uTime, uWindStrength, uNight, uOpacity;
uniform vec3 uFocus;
uniform vec2 uWindDir;
attribute vec4 aSeed;
${terrainGLSL}
${noiseGLSL}
vec3 rotateAxis(vec3 p, vec3 axis, float a) {
  float c = cos(a), s = sin(a);
  return p * c + cross(axis, p) * s + axis * dot(axis, p) * (1.0 - c);
}
`

function makeMaterial({ vertex, fragment, uniforms = {}, blending = THREE.NormalBlending, transparent = true }) {
  return new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...common, uOpacity: { value: 0 }, ...uniforms },
    vertexShader: `${headerGLSL}\n#include <fog_pars_vertex>\n${vertex}`,
    fragmentShader: `uniform float uOpacity, uNight;\n#include <fog_pars_fragment>\n${fragment}`,
    transparent,
    depthWrite: false,
    blending,
    side: THREE.DoubleSide,
    fog: true,
  })
}

export class Particles {
  constructor(scene, quality) {
    const q = quality.particles
    this.items = []

    // ---------------------------------------------------------------- Leaves / petals
    const fallVertex = (size, fall, drift) => /* glsl */ `
      varying vec2 vUv;
      varying float vRand;
      varying float vFade;
      void main() {
        vec2 box = vec2(${size.toFixed(1)});
        float H = 16.0;
        vec2 p = aSeed.xy * box + uWindDir * uTime * ${drift.toFixed(2)} * (0.6 + uWindStrength);
        vec2 wp = uFocus.xz + mod(p - uFocus.xz + box * 0.5, box) - box * 0.5;
        float fallT = mod(uTime * ${fall.toFixed(2)} * (0.7 + aSeed.z * 0.6) + aSeed.w * H, H);
        float ground = terrainHeight(wp);
        float y = max(uFocus.y, ground) + H - fallT - 1.0;
        vFade = smoothstep(ground - 0.1, ground + 0.8, y) * smoothstep(H * 0.95, H * 0.7, fallT) * (1.0 - smoothstep(box.x * 0.3, box.x * 0.5, length(wp - uFocus.xz)));
        y = max(y, ground + 0.03);
        // flutter sideways while falling
        wp += vec2(sin(uTime * 1.7 + aSeed.w * 30.0), cos(uTime * 1.3 + aSeed.z * 20.0)) * 0.6;
        vec3 axis = normalize(vec3(aSeed.z - 0.5, aSeed.w - 0.5, aSeed.x - 0.5) + 0.01);
        vec3 local = rotateAxis(position * (0.75 + aSeed.z * 0.5), axis, uTime * (1.5 + aSeed.w * 3.0) + aSeed.x * 20.0);
        vec3 world = vec3(wp.x, y, wp.y) + local;
        vec4 mvPosition = viewMatrix * vec4(world, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        vUv = uv;
        vRand = aSeed.z;
        #include <fog_vertex>
      }
    `
    const leafFragment = /* glsl */ `
      uniform vec3 uLeafA, uLeafB, uLeafC, uSunColor;
      uniform float uPetal;
      varying vec2 vUv;
      varying float vRand;
      varying float vFade;
      void main() {
        vec2 c = vUv - 0.5;
        float shape = uPetal > 0.5 ? length(c * vec2(1.0, 1.4)) : length(vec2(c.x * 2.0 / (1.0 - abs(c.y) * 1.3 + 0.05), c.y));
        if (shape > 0.48) discard;
        vec3 col = uPetal > 0.5 ? mix(vec3(1.0, 0.72, 0.84), vec3(1.0, 0.96, 0.97), step(0.5, vRand)) : mix(uLeafA, mix(uLeafB, uLeafC, step(0.6, vRand)), step(0.35, vRand));
        col *= mix(vec3(1.0), uSunColor, 0.25) * mix(1.0, 0.22, uNight);
        col *= 0.85 + 0.3 * (1.0 - shape);
        gl_FragColor = vec4(col, uOpacity * vFade);
        #include <fog_fragment>
      }
    `
    const quad = new THREE.PlaneGeometry(0.22, 0.22)
    this.leaves = this.add(scene, new THREE.Mesh(instanced(quad, Math.round(520 * q), 31), makeMaterial({ vertex: fallVertex(56, 1.1, 2.2), fragment: leafFragment, uniforms: { uPetal: { value: 0 } } })))
    this.petals = this.add(scene, new THREE.Mesh(instanced(new THREE.PlaneGeometry(0.13, 0.13), Math.round(650 * q), 37), makeMaterial({ vertex: fallVertex(56, 0.6, 1.6), fragment: leafFragment, uniforms: { uPetal: { value: 1 } } })))

    // ---------------------------------------------------------------- Butterflies
    const wing = new THREE.BufferGeometry()
    wing.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.06, 0, 0, -0.08, 0.16, 0, 0.05, 0, 0, 0.06, 0, 0, -0.08, -0.16, 0, 0.05, 0, 0, -0.08, 0.12, 0, -0.1, 0, 0, 0.0, 0, 0, -0.08, -0.12, 0, -0.1, 0, 0, 0.0], 3))
    wing.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(24).fill(0), 2))
    this.butterflies = this.add(scene, new THREE.Mesh(instanced(wing, Math.round(36 * q), 41), makeMaterial({
      vertex: /* glsl */ `
        varying float vRand;
        void main() {
          vec2 box = vec2(40.0);
          float t = uTime * (0.25 + aSeed.z * 0.2);
          vec2 p = aSeed.xy * box + vec2(sin(t + aSeed.w * 6.0), cos(t * 0.8 + aSeed.x * 6.0)) * 6.0;
          vec2 wp = uFocus.xz + mod(p - uFocus.xz + box * 0.5, box) - box * 0.5;
          float y = terrainHeight(wp) + 0.6 + sin(uTime * 1.3 + aSeed.w * 10.0) * 0.35 + aSeed.z * 1.4;
          float flap = sin(uTime * 18.0 + aSeed.w * 40.0) * 1.1;
          vec3 pos = position;
          float side = sign(pos.x);
          pos = vec3(pos.x * cos(flap), abs(pos.x) * sin(flap), pos.z);
          float heading = atan(cos(t * 0.8 + aSeed.x * 6.0), -sin(t + aSeed.w * 6.0));
          float c = cos(heading), s = sin(heading);
          pos.xz = mat2(c, -s, s, c) * pos.xz;
          vec4 mvPosition = viewMatrix * vec4(vec3(wp.x, y, wp.y) + pos * 1.4, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          vRand = aSeed.z;
          #include <fog_vertex>
        }`,
      fragment: /* glsl */ `
        varying float vRand;
        void main() {
          vec3 col = vRand < 0.33 ? vec3(1.0, 0.85, 0.3) : vRand < 0.66 ? vec3(1.0, 0.55, 0.75) : vec3(0.55, 0.75, 1.0);
          gl_FragColor = vec4(col * mix(1.0, 0.2, uNight), uOpacity);
          #include <fog_fragment>
        }`,
      transparent: true,
    })))

    // ---------------------------------------------------------------- Rain
    const streak = new THREE.PlaneGeometry(0.018, 0.75).translate(0, 0.375, 0)
    this.rain = this.add(scene, new THREE.Mesh(instanced(streak, Math.round(4200 * q), 53), makeMaterial({
      vertex: /* glsl */ `
        varying float vA;
        void main() {
          vec2 box = vec2(46.0);
          float H = 13.0;
          vec2 slant = uWindDir * 3.5 * uWindStrength;
          float fallT = mod(uTime * 21.0 * (0.85 + aSeed.z * 0.3) + aSeed.w * H, H);
          vec2 p = aSeed.xy * box + slant * (fallT / 21.0);
          vec2 wp = uFocus.xz + mod(p - uFocus.xz + box * 0.5, box) - box * 0.5;
          float ground = terrainHeight(wp);
          float y = uFocus.y + H - fallT - 1.0;
          float camDist = distance(cameraPosition, vec3(wp.x, y, wp.y));
          vA = step(ground, y) * (1.0 - smoothstep(box.x * 0.35, box.x * 0.5, length(wp - uFocus.xz))) * smoothstep(6.0, 14.0, camDist);
          // billboard around the fall axis
          vec3 axis = normalize(vec3(-slant.x / 21.0, 1.0, -slant.y / 21.0));
          vec3 toCam = normalize(cameraPosition - vec3(wp.x, y, wp.y));
          vec3 side = normalize(cross(axis, toCam));
          vec3 world = vec3(wp.x, y, wp.y) + side * position.x + axis * position.y;
          vec4 mvPosition = viewMatrix * vec4(world, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragment: /* glsl */ `
        varying float vA;
        void main() {
          gl_FragColor = vec4(vec3(0.82, 0.88, 0.95) * mix(1.0, 0.45, uNight), uOpacity * vA * 0.3);
          #include <fog_fragment>
        }`,
    })))

    const ring = new THREE.PlaneGeometry(0.5, 0.5).rotateX(-Math.PI / 2)
    this.splashes = this.add(scene, new THREE.Mesh(instanced(ring, Math.round(700 * q), 59), makeMaterial({
      vertex: /* glsl */ `
        varying vec2 vUv;
        varying float vPh;
        void main() {
          vec2 box = vec2(36.0);
          float rate = 1.4 + aSeed.z;
          float cycle = floor(uTime * rate + aSeed.w);
          vPh = fract(uTime * rate + aSeed.w);
          vec2 jitter = vec2(hash12(vec2(cycle, aSeed.x * 91.0)), hash12(vec2(aSeed.y * 37.0, cycle)));
          vec2 p = (aSeed.xy + jitter) * box;
          vec2 wp = uFocus.xz + mod(p - uFocus.xz + box * 0.5, box) - box * 0.5;
          float g = max(terrainHeight(wp), ${(-0.45).toFixed(2)});
          vec3 world = vec3(wp.x, g + 0.06, wp.y) + position * (0.25 + vPh * 0.7);
          vec4 mvPosition = viewMatrix * vec4(world, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          vUv = uv;
          #include <fog_vertex>
        }`,
      fragment: /* glsl */ `
        varying vec2 vUv;
        varying float vPh;
        void main() {
          float r = length(vUv - 0.5) * 2.0;
          float ring = smoothstep(0.12, 0.0, abs(r - 0.8)) * (1.0 - vPh);
          if (ring < 0.01) discard;
          gl_FragColor = vec4(vec3(0.85, 0.9, 0.95) * mix(1.0, 0.4, uNight), ring * uOpacity * 0.35);
          #include <fog_fragment>
        }`,
    })))

    // ---------------------------------------------------------------- Fireflies
    const fly = new THREE.PlaneGeometry(0.16, 0.16)
    this.fireflies = this.add(scene, new THREE.Mesh(instanced(fly, Math.round(160 * q), 67), makeMaterial({
      vertex: /* glsl */ `
        varying vec2 vUv;
        varying float vBlink;
        void main() {
          vec2 box = vec2(44.0);
          float t = uTime * 0.35;
          vec2 p = aSeed.xy * box + vec2(sin(t + aSeed.z * 12.0), cos(t * 1.3 + aSeed.w * 12.0)) * 2.5;
          vec2 wp = uFocus.xz + mod(p - uFocus.xz + box * 0.5, box) - box * 0.5;
          float y = max(terrainHeight(wp), -0.3) + 0.4 + aSeed.z * 2.2 + sin(uTime * 0.9 + aSeed.x * 20.0) * 0.3;
          vBlink = pow(max(sin(uTime * (1.2 + aSeed.w) + aSeed.x * 40.0), 0.0), 3.0);
          vec4 mvPosition = viewMatrix * vec4(wp.x, y, wp.y, 1.0);
          mvPosition.xy += position.xy * (0.6 + vBlink * 0.6);
          gl_Position = projectionMatrix * mvPosition;
          vUv = uv;
          #include <fog_vertex>
        }`,
      fragment: /* glsl */ `
        varying vec2 vUv;
        varying float vBlink;
        void main() {
          float d = length(vUv - 0.5) * 2.0;
          float a = pow(max(1.0 - d, 0.0), 2.5);
          gl_FragColor = vec4(vec3(1.0, 0.95, 0.45) * (1.5 + vBlink * 5.0) * a, a * uOpacity * (0.25 + vBlink));
        }`,
      blending: THREE.AdditiveBlending,
    })))
  }

  add(scene, mesh) {
    mesh.frustumCulled = false
    mesh.renderOrder = 5
    scene.add(mesh)
    this.items.push(mesh)
    return mesh
  }

  update(base, night) {
    const set = (m, v) => {
      m.material.uniforms.uOpacity.value = v
      m.visible = v > 0.01
    }
    set(this.leaves, base.leaves)
    set(this.petals, base.petals)
    set(this.butterflies, base.petals * (1 - night))
    set(this.rain, base.rain)
    set(this.splashes, base.rain)
    set(this.fireflies, night * (1 - base.rain))
  }
}
