// Time of day. Composes final sky / sun / fog / exposure from the season base, moves the
// sun across the sky, and handles night (stars, lanterns, headlights) and lightning.
import * as THREE from 'three'
import { U } from '../world/Uniforms.js'
import { clamp, smoothstep, lerp } from '../core/math.js'

const NIGHT_TOP = new THREE.Color('#0a1226')
const NIGHT_HORIZON = new THREE.Color('#1e2d4a')
const NIGHT_FOG = new THREE.Color('#18233a')
const MOON = new THREE.Color('#8fa8dc')
const GOLD = new THREE.Color('#ff9d5c')
const GOLD_SKY = new THREE.Color('#ffb07a')
const DUSK_SKY = new THREE.Color('#e5866f')

const GOLDEN_HOUR = 0.665
const NIGHT_TIME = 0.97

export class DayCycle {
  constructor(seasons, tweens) {
    this.seasons = seasons
    this.tweens = tweens
    this.time = GOLDEN_HOUR // 0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset
    this.duration = 480 // seconds for a full day
    this.paused = false
    this.speed = 1
    this.night = 0
    this.lightning = 0
    this.nextLightning = 8
    this.onThunder = null
    this._c = new THREE.Color()
    this.fog = { near: 70, far: 270 }
    this.sunIntensity = 2.7
    this.hemiIntensity = 1
    this.exposure = 1
  }

  isNight() {
    return this.night > 0.5
  }

  // Jump smoothly between golden hour and night
  toggleNight() {
    const target = this.isNight() ? GOLDEN_HOUR : NIGHT_TIME + 0.0
    let t = target
    if (t < this.time) t += 1 // always move forward in time
    this.transitioning = true
    this.tweens.to(this, 'time', t, 3.5, 'inOut', () => {
      this.time %= 1
      this.transitioning = false
    })
    return !this.isNight()
  }

  update(dt) {
    if (!this.paused && !this.transitioning) this.time = (this.time + (dt * this.speed) / this.duration) % 1
    const t = this.time % 1
    const b = this.seasons.base

    // Sun path
    const phase = (t - 0.25) * Math.PI * 2
    const elevSin = Math.sin(phase) * 0.82
    const elev = Math.asin(elevSin)
    const az = t * Math.PI * 2 + 2.2
    U.uSunDir.value.set(Math.cos(elev) * Math.cos(az), elevSin, Math.cos(elev) * Math.sin(az)).normalize()

    const day = smoothstep(-0.1, 0.16, elevSin)
    const golden = smoothstep(0.55, 0.08, elevSin) * smoothstep(-0.12, 0.05, elevSin)
    this.night = 1 - day
    U.uNight.value = this.night

    const rain = U.uRain.value
    const c = this._c
    // Sky
    c.copy(b.skyHorizon).lerp(GOLD_SKY, golden * 0.45 * (1 - rain)).lerp(DUSK_SKY, golden * smoothstep(0.2, -0.05, elevSin) * 0.35 * (1 - rain))
    U.uSkyHorizon.value.copy(c).lerp(NIGHT_HORIZON, this.night)
    U.uSkyTop.value.copy(b.skyTop).lerp(NIGHT_TOP, this.night)
    // Sun / moon colour
    c.copy(b.sun).lerp(GOLD, golden * 0.55 * (1 - rain))
    U.uSunColor.value.copy(c).lerp(MOON, this.night)
    // Fog
    c.copy(b.fog).lerp(GOLD_SKY, golden * 0.25 * (1 - rain))
    U.uFogColor.value.copy(c).lerp(NIGHT_FOG, this.night)
    this.fog.near = lerp(b.fogNear, b.fogNear * 0.6, this.night)
    this.fog.far = lerp(b.fogFar, b.fogFar * 0.75, this.night)

    this.sunIntensity = lerp(0.24, b.sunIntensity * (0.75 + 0.25 * smoothstep(0.0, 0.4, elevSin)), day)
    this.hemiIntensity = lerp(0.2, b.hemiIntensity, day)
    this.exposure = lerp(1.1, b.exposure, day)

    // Lightning (monsoon only)
    this.lightning = Math.max(0, this.lightning - dt * 3.5)
    if (rain > 0.6) {
      this.nextLightning -= dt
      if (this.nextLightning <= 0) {
        this.lightning = 1
        this.nextLightning = 7 + Math.random() * 12
        const delay = 0.6 + Math.random() * 1.8
        if (this.onThunder) this.onThunder(delay)
      }
    } else this.nextLightning = 5
    const flicker = this.lightning > 0 ? this.lightning * (0.6 + 0.4 * Math.sin(performance.now() * 0.05)) : 0
    U.uLightning.value = clamp(flicker, 0, 1)
  }
}
