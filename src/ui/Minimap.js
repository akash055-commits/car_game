// GTA-style minimap: a pre-rendered map of the town (streets, water, parks, buildings,
// airport) drawn rotated with the camera around the player, plus markers for activity
// starts, the current target, your vehicles and the player arrow. Click to enlarge.
import { WORLD, AIRPORT } from '../world/Layout.js'

const SCALE = 1.6 // px per metre on the base map

export class Minimap {
  constructor(root, game) {
    this.game = game
    this.big = false
    const wrap = document.createElement('div')
    wrap.className = 'minimap panel'
    wrap.innerHTML = '<canvas></canvas><div class="mm-n">N</div>'
    root.appendChild(wrap)
    this.wrap = wrap
    this.canvas = wrap.querySelector('canvas')
    this.north = wrap.querySelector('.mm-n')
    this.ctx = this.canvas.getContext('2d')
    wrap.addEventListener('click', () => {
      this.big = !this.big
      wrap.classList.toggle('big', this.big)
      // match the canvas to the final size once the CSS transition settles
      clearTimeout(this.rt)
      this.rt = setTimeout(() => this.resize(), 340)
    })
    wrap.addEventListener('transitionend', () => this.resize())
    this.base = this.render()
    this.resize()
    window.addEventListener('resize', () => this.resize())
  }

  resize() {
    const r = this.wrap.getBoundingClientRect()
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.canvas.width = Math.max(1, Math.round(r.width * dpr))
    this.canvas.height = Math.max(1, Math.round(r.height * dpr))
    this.dpr = dpr
  }

  // Base map image
  render() {
    const L = this.game.layout
    const town = this.game.town
    const size = Math.round(WORLD.size * SCALE)
    const cv = document.createElement('canvas')
    cv.width = cv.height = size
    const c = cv.getContext('2d')
    const P = (x) => (x + WORLD.half) * SCALE
    c.fillStyle = '#d9cdb3'
    c.fillRect(0, 0, size, size)
    // terrain shading: hills darker
    const step = 6
    for (let z = -WORLD.half; z < WORLD.half; z += step) {
      for (let x = -WORLD.half; x < WORLD.half; x += step) {
        const h = L.getHeight(x, z)
        if (h > 2) {
          c.fillStyle = `rgba(110, 90, 60, ${Math.min(0.35, (h - 2) * 0.02)})`
          c.fillRect(P(x), P(z), step * SCALE + 1, step * SCALE + 1)
        }
      }
    }
    // park + green blocks
    for (const b of L.blocks) {
      if (b.district === 'park' || b.district === 'school') c.fillStyle = '#b8cf96'
      else if (b.district === 'yard' || b.district === 'stunt') c.fillStyle = '#d6c09a'
      else if (b.district === 'square' || b.district === 'market') c.fillStyle = '#e9dccb'
      else c.fillStyle = '#e6dccb'
      c.fillRect(P(b.x0), P(b.z0), (b.x1 - b.x0) * SCALE, (b.z1 - b.z0) * SCALE)
    }
    // water
    c.fillStyle = '#7cc6d8'
    c.strokeStyle = '#7cc6d8'
    c.lineCap = 'round'
    c.lineJoin = 'round'
    const lake = L.lake
    c.beginPath()
    for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.1) {
      const r = L.lakeRadius(a) * 0.95
      const x = P(lake.x + Math.cos(a) * r), z = P(lake.z + Math.sin(a) * r)
      a === 0 ? c.moveTo(x, z) : c.lineTo(x, z)
    }
    c.fill()
    for (const w of [L.stream, L.river]) {
      c.lineWidth = w.hw * 2 * SCALE
      c.beginPath()
      w.pts.forEach(([x, z], i) => (i ? c.lineTo(P(x), P(z)) : c.moveTo(P(x), P(z))))
      c.stroke()
    }
    // airport
    const A = AIRPORT
    c.fillStyle = '#b9b4ad'
    c.fillRect(P(-A.runwayHalfLen), P(A.runwayZ - A.runwayHalfWidth), A.runwayHalfLen * 2 * SCALE, A.runwayHalfWidth * 2 * SCALE)
    c.fillRect(P(A.connectors[0] - 7), P(A.taxiZ - 7), (A.connectors[2] - A.connectors[0] + 14) * SCALE, 14 * SCALE)
    c.fillRect(P(A.apron.x0), P(A.apron.z0), (A.apron.x1 - A.apron.x0) * SCALE, (A.apron.z1 - A.apron.z0) * SCALE)
    c.strokeStyle = '#ffffff'
    c.lineWidth = 1
    c.setLineDash([10, 8])
    c.beginPath()
    c.moveTo(P(-A.runwayHalfLen + 8), P(A.runwayZ))
    c.lineTo(P(A.runwayHalfLen - 8), P(A.runwayZ))
    c.stroke()
    c.setLineDash([])
    // streets
    for (const [w, col] of [[(WORLD.roadHalfWidth + WORLD.sidewalk) * 2, '#c9bfae'], [WORLD.roadHalfWidth * 2, '#fbf8f2']]) {
      c.strokeStyle = col
      c.lineWidth = w * SCALE
      c.lineCap = 'square'
      for (const e of L.edges) {
        c.beginPath()
        c.moveTo(P(e.ax), P(e.az))
        c.lineTo(P(e.bx), P(e.bz))
        c.stroke()
      }
    }
    // buildings
    c.fillStyle = '#c4b49e'
    for (const p of town.places) {
      const s = p.kind === 'landmark' ? 14 : 8
      c.fillRect(P(p.x) - (s * SCALE) / 2, P(p.z) - (s * SCALE) / 2, s * SCALE, s * SCALE)
    }
    return cv
  }

  draw() {
    const g = this.game
    const c = this.ctx
    const W = this.canvas.width, H = this.canvas.height
    // Small map: centred on you, rotated so the camera's forward points up.
    // Big map: the whole town + airport, north up.
    const pos = this.big ? { x: 0, z: -30 } : g.carPos
    const yaw = g.rig.forwardYaw()
    const theta = this.big ? Math.PI : -Math.PI / 2 - Math.atan2(Math.cos(yaw), Math.sin(yaw))
    const k = this.big ? Math.min(W, H) / (650 * SCALE) : (1.35 * this.dpr) / SCALE
    c.save()
    c.clearRect(0, 0, W, H)
    c.beginPath()
    if (this.big) c.rect(0, 0, W, H)
    else c.arc(W / 2, H / 2, Math.min(W, H) / 2, 0, Math.PI * 2)
    c.clip()
    c.fillStyle = '#d9cdb3'
    c.fillRect(0, 0, W, H)
    c.translate(W / 2, H / 2)
    c.rotate(theta)
    c.scale(k, k)
    c.translate(-(pos.x + WORLD.half) * SCALE, -(pos.z + WORLD.half) * SCALE)
    c.drawImage(this.base, 0, 0)
    const P = (x) => (x + WORLD.half) * SCALE
    const dot = (x, z, r, fill, stroke = '#2f2118') => {
      c.beginPath()
      c.arc(P(x), P(z), r / k, 0, Math.PI * 2)
      c.fillStyle = fill
      c.fill()
      c.lineWidth = 1.6 / k
      c.strokeStyle = stroke
      c.stroke()
    }
    const acts = g.activities
    if (acts) {
      const colors = { courier: '#e8a33a', taxi: '#f2c94c', rally: '#4fe0c8' }
      if (!acts.current) for (const st of acts.starts) dot(st.x, st.z, 6 * this.dpr, colors[st.id])
      if (acts.target) dot(acts.target.x, acts.target.z, (6 + Math.sin(performance.now() / 180) * 2) * this.dpr, '#ff5a36', '#ffffff')
    }
    for (const v of g.vehicles) {
      if (g.active === v) continue
      dot(v.pos.x, v.pos.z, 4.5 * this.dpr, v.type === 'heli' ? '#3d4f7a' : v.type === 'bike' ? '#d84b3a' : '#2b9e96', '#ffffff')
    }
    for (const pl of g.aviation?.planes || []) dot(pl.pos.x, pl.pos.z, 2.5 * this.dpr, '#f4f1ea', '#5b6b7a')
    c.restore()
    // Player arrow (centre of the small map; true position on the big one)
    const q = g.carQuat
    const heading = g.active ? Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x)) : g.player.heading
    c.save()
    if (this.big) {
      const dx = (g.carPos.x - pos.x) * SCALE * k, dz = (g.carPos.z - pos.z) * SCALE * k
      c.translate(W / 2 + dx * Math.cos(theta) - dz * Math.sin(theta), H / 2 + dx * Math.sin(theta) + dz * Math.cos(theta))
    } else c.translate(W / 2, H / 2)
    c.rotate(Math.atan2(Math.cos(heading), Math.sin(heading)) + theta + Math.PI / 2)
    const sz = 7 * this.dpr
    c.beginPath()
    c.moveTo(0, -sz * 1.3)
    c.lineTo(sz, sz)
    c.lineTo(0, sz * 0.45)
    c.lineTo(-sz, sz)
    c.closePath()
    c.fillStyle = '#ffffff'
    c.fill()
    c.lineWidth = 2 * this.dpr
    c.strokeStyle = '#e8742c'
    c.stroke()
    c.restore()
    // "N" marker sits on the rim in the direction of world +z
    const na = Math.PI / 2 + theta
    const rr = Math.min(W, H) / 2 / this.dpr - 9
    this.north.style.transform = this.big ? 'translate(-50%, -50%)' : `translate(-50%, -50%) translate(${Math.cos(na) * rr}px, ${Math.sin(na) * rr}px)`
  }
}
