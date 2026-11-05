// On-screen controls for phones / tablets: left joystick (steer + throttle/brake),
// right buttons (gas, boost, drift) and one-finger drag on the scene to orbit the camera.
import { ICONS } from './UI.js'

export class TouchControls {
  constructor(input, rig, canvas) {
    this.input = input
    document.body.classList.add('touch-mode')
    const el = document.createElement('div')
    el.className = 'touch'
    el.innerHTML = `
      <div class="stick"><div class="knob"></div></div>
      <div class="touch-btns">
        <div class="tbtn" data-b="boost">${ICONS.boost}<span>BOOST</span></div>
        <div class="tbtn gas" data-b="gas"><span>GAS</span></div>
        <div class="tbtn" data-b="drift">${ICONS.drift}<span>DRIFT</span></div>
      </div>`
    document.body.appendChild(el)
    this.el = el

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
      const sx = dx / R, sy = dy / R
      input.touch.steer = -Math.sign(sx) * Math.max(0, Math.abs(sx) - 0.12) / 0.88
      input.touch.throttle = Math.max(input.touch.gas ? 1 : 0, sy < -0.25 ? Math.min(1, (-sy - 0.25) / 0.6) : 0)
      input.touch.brake = sy > 0.3 ? Math.min(1, (sy - 0.3) / 0.6) : 0
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
      input.touch.steer = 0
      input.touch.throttle = input.touch.gas ? 1 : 0
      input.touch.brake = 0
    }
    stick.addEventListener('pointerup', release)
    stick.addEventListener('pointercancel', release)

    // Buttons
    el.querySelectorAll('.tbtn').forEach((b) => {
      const set = (down) => {
        b.classList.toggle('down', down)
        const k = b.dataset.b
        if (k === 'boost') input.touch.boost = down
        if (k === 'drift') input.touch.handbrake = down
        if (k === 'gas') {
          input.touch.gas = down
          input.touch.throttle = down ? 1 : 0
        }
      }
      b.addEventListener('pointerdown', (e) => { b.setPointerCapture(e.pointerId); set(true); e.preventDefault() })
      b.addEventListener('pointerup', () => set(false))
      b.addEventListener('pointercancel', () => set(false))
    })

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
  }
}
