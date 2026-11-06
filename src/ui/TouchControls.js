// On-screen controls for phones / tablets. A left joystick plus a right button cluster that
// changes with what you're doing:
//   on foot  – stick walks (push to the edge to run), JUMP, SPRINT (hold)
//   buggy / bike – stick steers + throttle / brake, GAS, BOOST, DRIFT, EXIT
//   helicopter – stick pitches + turns, UP / DOWN collective, ENGINE, EXIT
// One-finger drag on the scene orbits the camera. Context actions (get in, start an
// activity) are taps on the on-screen prompt.
import { ICONS } from './UI.js'

const LAYOUTS = {
  foot: [['jump', 'JUMP'], ['sprint', 'SPRINT', ICONS.boost]],
  car: [['boost', 'BOOST', ICONS.boost], ['gas', 'GAS'], ['drift', 'DRIFT', ICONS.drift], ['exit', 'EXIT']],
  bike: [['boost', 'BOOST', ICONS.boost], ['gas', 'GAS'], ['drift', 'BRAKE'], ['exit', 'EXIT']],
  heli: [['up', 'UP'], ['down', 'DOWN'], ['engine', 'ENGINE'], ['exit', 'EXIT']],
}

export class TouchControls {
  constructor(input, rig, canvas) {
    this.input = input
    this.mode = null
    document.body.classList.add('touch-mode')
    const el = document.createElement('div')
    el.className = 'touch'
    el.innerHTML = '<div class="stick"><div class="knob"></div></div><div class="touch-btns"></div>'
    document.body.appendChild(el)
    this.el = el
    this.btns = el.querySelector('.touch-btns')
    this.stickVec = { x: 0, y: 0 }

    // Joystick
    const stick = el.querySelector('.stick')
    const knob = el.querySelector('.knob')
    let id = null, cx = 0, cy = 0
    const R = 52
    const move = (e) => {
      let dx = e.clientX - cx, dy = e.clientY - cy
      const d = Math.hypot(dx, dy)
      if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R }
      knob.style.transform = `translate(${dx}px, ${dy}px)`
      this.stickVec.x = dx / R
      this.stickVec.y = dy / R
      this.apply()
    }
    stick.addEventListener('pointerdown', (e) => {
      id = e.pointerId
      const r = stick.getBoundingClientRect()
      cx = r.left + r.width / 2
      cy = r.top + r.height / 2
      stick.setPointerCapture(id)
      move(e)
      e.preventDefault()
    })
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === id) move(e) })
    const release = (e) => {
      if (e.pointerId !== id) return
      id = null
      knob.style.transform = ''
      this.stickVec.x = this.stickVec.y = 0
      this.apply()
    }
    stick.addEventListener('pointerup', release)
    stick.addEventListener('pointercancel', release)

    // Drag on the scene to orbit
    let orbitId = null, lastX = 0
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch' || orbitId !== null) return
      orbitId = e.pointerId
      lastX = e.clientX
    })
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerId !== orbitId) return
      rig.orbit((e.clientX - lastX) * 0.008)
      lastX = e.clientX
    })
    const end = (e) => { if (e.pointerId === orbitId) orbitId = null }
    canvas.addEventListener('pointerup', end)
    canvas.addEventListener('pointercancel', end)
    el.addEventListener('contextmenu', (e) => e.preventDefault())
    this.setMode('car')
  }

  // Translate the stick into the fields each control scheme reads
  apply() {
    const t = this.input.touch
    const sx = this.stickVec.x, sy = this.stickVec.y
    const dead = (v, d) => Math.sign(v) * Math.max(0, Math.abs(v) - d) / (1 - d)
    if (this.mode === 'car' || this.mode === 'bike') {
      t.steer = -dead(sx, 0.12)
      t.throttle = Math.max(t.gas ? 1 : 0, sy < -0.25 ? Math.min(1, (-sy - 0.25) / 0.6) : 0)
      t.brake = Math.max(t.brakeBtn ? 1 : 0, sy > 0.3 ? Math.min(1, (sy - 0.3) / 0.6) : 0)
    } else {
      t.moveX = dead(sx, 0.1)
      t.moveY = -dead(sy, 0.1)
      if (this.mode === 'foot') t.run = Math.hypot(sx, sy) > 0.93
    }
  }

  setMode(mode) {
    if (mode === this.mode) return
    this.mode = mode
    // clear everything the previous scheme wrote
    Object.assign(this.input.touch, { steer: 0, throttle: 0, brake: 0, handbrake: false, boost: false, gas: false, brakeBtn: false, run: false, moveX: 0, moveY: 0, jump: false, up: false, down: false })
    this.btns.className = `touch-btns m-${mode}`
    this.btns.innerHTML = LAYOUTS[mode].map(([k, label, icon]) => `<div class="tbtn ${k}" data-b="${k}">${icon || ''}<span>${label}</span></div>`).join('')
    this.btns.querySelectorAll('.tbtn').forEach((b) => {
      const k = b.dataset.b
      const set = (down) => {
        b.classList.toggle('down', down)
        const t = this.input.touch
        if (k === 'boost') t.boost = down
        if (k === 'drift') { if (mode === 'bike') t.brakeBtn = down; else t.handbrake = down }
        if (k === 'gas') t.gas = down
        if (k === 'jump') t.jump = down
        if (k === 'sprint') t.boost = down
        if (k === 'up') t.up = down
        if (k === 'down') t.down = down
        if (down && k === 'exit') this.input.emit('press', 'KeyF')
        if (down && k === 'engine') this.input.emit('press', 'KeyI')
        this.apply()
      }
      b.addEventListener('pointerdown', (e) => { b.setPointerCapture(e.pointerId); set(true); e.preventDefault() })
      b.addEventListener('pointerup', () => set(false))
      b.addEventListener('pointercancel', () => set(false))
    })
    this.stickVec.x = this.stickVec.y = 0
    this.el.querySelector('.knob').style.transform = ''
  }
}
