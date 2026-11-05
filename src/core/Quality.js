// Quality tiers. Mobile / weak GPUs start on "low"; a slow first few seconds also drops to low.
const isTouch = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0)
const isSmall = typeof window !== 'undefined' && Math.min(window.innerWidth, window.innerHeight) < 600

const TIERS = {
  high: { name: 'high', pixelRatio: 1, msaa: true, bloom: true, tiltShift: true, shadowMap: 2048, grass: 300, grassPatch: 64, foliageCards: 110, particles: 1 },
  low: { name: 'low', pixelRatio: 1, msaa: false, bloom: true, tiltShift: false, shadowMap: 1024, grass: 170, grassPatch: 50, foliageCards: 60, particles: 0.5 },
}

export function getQuality() {
  let saved = null
  try { saved = localStorage.getItem('sv-quality') } catch {}
  const name = saved && TIERS[saved] ? saved : isTouch || isSmall ? 'low' : 'high'
  const q = { ...TIERS[name], isTouch }
  q.pixelRatio = Math.min(window.devicePixelRatio || 1, name === 'high' ? 2 : 1.5)
  return q
}

export function saveQuality(name) {
  try { localStorage.setItem('sv-quality', name) } catch {}
}
