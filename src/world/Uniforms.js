// Shared shader uniforms. Every season- or time-dependent value lives here so a season
// switch is just a tween of these values: no material rebuilds, no hitches.
import * as THREE from 'three'

const c = (hex) => ({ value: new THREE.Color(hex) })
const f = (v) => ({ value: v })

export const U = {
  uTime: f(0),
  uWindDir: { value: new THREE.Vector2(0.86, 0.5) },
  uWindStrength: f(0.6),
  uCarPos: { value: new THREE.Vector3() },
  uCarVel: { value: new THREE.Vector3() },
  uFocus: { value: new THREE.Vector3() },
  uHeightTex: { value: null },
  uGroundTex: { value: null },

  // Palette (overwritten by Seasons)
  uGrassRoot: c('#7a3b16'),
  uGrassTip: c('#f0a83c'),
  uGround: c('#c46a2c'),
  uDirt: c('#d98a4a'),
  uSand: c('#e3b07a'),
  uRock: c('#8e7d72'),
  uLeafA: c('#f2b33d'),
  uLeafB: c('#e8692a'),
  uLeafC: c('#c23a26'),
  uTrunk: c('#5a3424'),
  uRoad: c('#d8a27a'),
  uRoadEdge: c('#a8673f'),
  uWaterShallow: c('#5fc7b4'),
  uWaterDeep: c('#1d5b68'),
  uFoam: c('#fff3df'),
  uFlowerA: c('#ff7fb0'),
  uFlowerB: c('#fff2a8'),

  uWet: f(0), // 0 dry -> 1 soaked (Monsoon)
  uRain: f(0),
  uSpring: f(0), // flowers / blossoms visibility
  uAutumn: f(1), // leaf litter
  uNight: f(0), // 0 day -> 1 night
  uLightning: f(0),

  uSunDir: { value: new THREE.Vector3(0.5, 0.6, 0.3).normalize() },
  uSkyTop: c('#5aa6c8'),
  uSkyHorizon: c('#ffd2a1'),
  uSunColor: c('#ffd9a8'),
  uFogColor: c('#f2b98a'),
}

// Common GLSL noise helpers
export const noiseGLSL = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm2(vec2 p) {
  return vnoise(p) * 0.6 + vnoise(p * 2.13 + 7.1) * 0.3 + vnoise(p * 4.7 - 3.3) * 0.1;
}
`
