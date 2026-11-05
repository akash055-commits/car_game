// Minimal tween manager used for season / time-of-day / UI transitions.
import * as THREE from 'three'

const ease = {
  linear: (t) => t,
  inOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  out: (t) => 1 - Math.pow(1 - t, 3),
}

export class Tweens {
  constructor() {
    this.items = []
  }

  // Animate a numeric property: tweens.to(obj, 'value', 1, 2.5)
  to(target, key, value, duration, easing = 'inOut', onDone) {
    this.items = this.items.filter((i) => !(i.target === target && i.key === key))
    const from = target[key]
    if (from instanceof THREE.Color) {
      const start = from.clone()
      const end = value instanceof THREE.Color ? value.clone() : new THREE.Color(value)
      this.items.push({ target, key, t: 0, duration, easing, onDone, apply: (k) => target[key].copy(start).lerp(end, k) })
    } else {
      this.items.push({ target, key, t: 0, duration, easing, onDone, apply: (k) => (target[key] = from + (value - from) * k) })
    }
  }

  update(dt) {
    if (!this.items.length) return
    for (const item of this.items) {
      item.t = Math.min(1, item.t + dt / Math.max(item.duration, 1e-4))
      item.apply(ease[item.easing](item.t))
    }
    const done = this.items.filter((i) => i.t >= 1)
    this.items = this.items.filter((i) => i.t < 1)
    for (const d of done) d.onDone && d.onDone()
  }
}
