// Small math helpers shared across modules.

export const clamp = (v, min, max) => (v < min ? min : v > max ? max : v)
export const lerp = (a, b, t) => a + (b - a) * t
export const invLerp = (a, b, v) => (v - a) / (b - a)
export const remap = (v, a, b, c, d) => c + ((v - a) / (b - a)) * (d - c)
export const remapClamp = (v, a, b, c, d) => c + clamp((v - a) / (b - a), 0, 1) * (d - c)
export const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}
// Frame-rate independent exponential smoothing
export const damp = (current, target, lambda, dt) => lerp(current, target, 1 - Math.exp(-lambda * dt))

export function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return d
}

// Deterministic PRNG so the world layout is identical on every load
export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function makeRandom(seed) {
  const r = mulberry32(seed)
  return {
    random: r,
    range: (a, b) => a + (b - a) * r(),
    int: (a, b) => Math.floor(a + (b - a + 1) * r()),
    pick: (arr) => arr[Math.floor(r() * arr.length)],
  }
}
