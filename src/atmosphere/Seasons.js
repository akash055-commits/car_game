// Season palettes. Switching tweens every shared uniform over ~2.5 s; the DayCycle then
// composes sky / sun / fog from the tweened season base each frame.
import * as THREE from 'three'
import { U } from '../world/Uniforms.js'

export const SEASONS = {
  autumn: {
    label: 'Autumn',
    colors: {
      uGrassRoot: '#6e2a0c', uGrassTip: '#ffbe45', uGround: '#b5551f', uDirt: '#d27a3c', uSand: '#e7b07a', uRock: '#9a7a66',
      uLeafA: '#f8c845', uLeafB: '#f0792a', uLeafC: '#cc3526', uTrunk: '#5a3424',
      uRoad: '#e0a072', uRoadEdge: '#8a4a2a', uWaterShallow: '#4cc4b2', uWaterDeep: '#17566a', uFoam: '#fff1dc',
      uFlowerA: '#ff8fb8', uFlowerB: '#fff0a0',
    },
    values: { uWet: 0, uRain: 0, uSpring: 0, uAutumn: 1, uWindStrength: 0.75 },
    sky: { top: '#6db3d6', horizon: '#ffcc9a', fog: '#f1b487', sun: '#ffd09a', hemiSky: '#b4b2ea', hemiGround: '#a0522d' },
    light: { sun: 3.3, hemi: 0.62, fogNear: 80, fogFar: 300, exposure: 1.0 },
    grade: { lift: [0.02, 0.0, 0.03], gain: [1.03, 0.99, 0.93], saturation: 1.14, contrast: 1.12 },
    particles: 'leaves',
  },
  spring: {
    label: 'Spring',
    colors: {
      uGrassRoot: '#2c6a2b', uGrassTip: '#b0dc62', uGround: '#6f9b45', uDirt: '#b39166', uSand: '#e8d6a6', uRock: '#a8a197',
      uLeafA: '#86c955', uLeafB: '#ffb2cd', uLeafC: '#fff1f4', uTrunk: '#5d4632',
      uRoad: '#e9dac2', uRoadEdge: '#9b8466', uWaterShallow: '#6ad8c8', uWaterDeep: '#1c6b86', uFoam: '#ffffff',
      uFlowerA: '#ff8fb8', uFlowerB: '#fff0a0',
    },
    values: { uWet: 0, uRain: 0, uSpring: 1, uAutumn: 0, uWindStrength: 0.45 },
    sky: { top: '#58aeea', horizon: '#dff2ff', fog: '#cfe7ef', sun: '#fff3da', hemiSky: '#bcd6ff', hemiGround: '#5a7a3a' },
    light: { sun: 3.3, hemi: 0.7, fogNear: 90, fogFar: 320, exposure: 1.0 },
    grade: { lift: [0.0, 0.006, 0.015], gain: [0.99, 1.0, 1.0], saturation: 1.14, contrast: 1.1 },
    particles: 'petals',
  },
  monsoon: {
    label: 'Monsoon',
    colors: {
      uGrassRoot: '#173d24', uGrassTip: '#5c9e52', uGround: '#4a6838', uDirt: '#6a5840', uSand: '#8c7f67', uRock: '#6c7270',
      uLeafA: '#2d6c3b', uLeafB: '#4c8a44', uLeafC: '#1d5848', uTrunk: '#36291f',
      uRoad: '#a29c93', uRoadEdge: '#5c564e', uWaterShallow: '#5a9894', uWaterDeep: '#1b3d48', uFoam: '#e6f0ef',
      uFlowerA: '#ff8fb8', uFlowerB: '#fff0a0',
    },
    values: { uWet: 1, uRain: 1, uSpring: 0, uAutumn: 0, uWindStrength: 1.15 },
    sky: { top: '#5b6f7a', horizon: '#9fadb2', fog: '#8f9fa4', sun: '#cfd8dc', hemiSky: '#bccacd', hemiGround: '#38483a' },
    light: { sun: 1.2, hemi: 1.0, fogNear: 30, fogFar: 180, exposure: 1.05 },
    grade: { lift: [0.0, 0.012, 0.03], gain: [0.95, 0.98, 1.03], saturation: 0.9, contrast: 1.07 },
    particles: 'rain',
  },
}

export const SEASON_ORDER = ['autumn', 'spring', 'monsoon']

export class Seasons {
  constructor(tweens) {
    this.tweens = tweens
    this.listeners = []
    // Season-owned base values that DayCycle composes into the final sky/light
    this.base = {
      skyTop: new THREE.Color(), skyHorizon: new THREE.Color(), fog: new THREE.Color(), sun: new THREE.Color(),
      hemiSky: new THREE.Color(), hemiGround: new THREE.Color(),
      sunIntensity: 2.7, hemiIntensity: 1, fogNear: 70, fogFar: 270, exposure: 1,
      lift: new THREE.Vector3(), gain: new THREE.Vector3(1, 1, 1), saturation: 1, contrast: 1,
      leaves: 0, petals: 0, rain: 0,
    }
    let saved = null
    try { saved = localStorage.getItem('sv-season') } catch {}
    this.current = SEASONS[saved] ? saved : 'autumn'
    this.apply(this.current, 0)
  }

  onChange(fn) {
    this.listeners.push(fn)
  }

  set(name) {
    if (!SEASONS[name] || name === this.current) return
    this.current = name
    try { localStorage.setItem('sv-season', name) } catch {}
    this.apply(name, 2.5)
    for (const fn of this.listeners) fn(name)
  }

  apply(name, duration) {
    const s = SEASONS[name]
    const tw = this.tweens
    const b = this.base
    const go = (target, key, value) => {
      if (duration === 0) {
        if (target[key] instanceof THREE.Color) target[key].set(value)
        else target[key] = value
      } else tw.to(target, key, value, duration)
    }
    for (const [k, v] of Object.entries(s.colors)) go(U[k], 'value', new THREE.Color(v))
    for (const [k, v] of Object.entries(s.values)) go(U[k], 'value', v)
    go(b, 'skyTop', new THREE.Color(s.sky.top))
    go(b, 'skyHorizon', new THREE.Color(s.sky.horizon))
    go(b, 'fog', new THREE.Color(s.sky.fog))
    go(b, 'sun', new THREE.Color(s.sky.sun))
    go(b, 'hemiSky', new THREE.Color(s.sky.hemiSky))
    go(b, 'hemiGround', new THREE.Color(s.sky.hemiGround))
    go(b, 'sunIntensity', s.light.sun)
    go(b, 'hemiIntensity', s.light.hemi)
    go(b, 'fogNear', s.light.fogNear)
    go(b, 'fogFar', s.light.fogFar)
    go(b, 'exposure', s.light.exposure)
    go(b, 'saturation', s.grade.saturation)
    go(b, 'contrast', s.grade.contrast)
    if (duration === 0) {
      b.lift.fromArray(s.grade.lift)
      b.gain.fromArray(s.grade.gain)
    } else {
      for (const [i, axis] of ['x', 'y', 'z'].entries()) {
        tw.to(b.lift, axis, s.grade.lift[i], duration)
        tw.to(b.gain, axis, s.grade.gain[i], duration)
      }
    }
    go(b, 'leaves', s.particles === 'leaves' ? 1 : 0)
    go(b, 'petals', s.particles === 'petals' ? 1 : 0)
    go(b, 'rain', s.particles === 'rain' ? 1 : 0)
  }
}
