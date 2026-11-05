import { damp, clamp } from './utils.js';

/** Unified keyboard / gamepad / touch input with smoothed analog output. */
export class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();     // edge-triggered actions this frame
    this.touch = { left: false, right: false, gas: false, brake: false, nitro: false, handbrake: false };
    this.state = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false };
    this.usingGamepad = false;
    this.prevPadButtons = [];
    this.steerSmoothed = 0;

    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      this.usingGamepad = false;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  bindTouch(root) {
    root.querySelectorAll('[data-touch]').forEach((el) => {
      const key = el.dataset.touch;
      const on = (e) => { e.preventDefault(); this.touch[key] = true; el.classList.add('active'); if (key === 'camera') this.pressed.add('KeyC'); };
      const off = (e) => { e.preventDefault(); this.touch[key] = false; el.classList.remove('active'); };
      el.addEventListener('touchstart', on, { passive: false });
      el.addEventListener('touchend', off, { passive: false });
      el.addEventListener('touchcancel', off, { passive: false });
      el.addEventListener('mousedown', on);
      el.addEventListener('mouseup', off);
      el.addEventListener('mouseleave', off);
    });
  }

  justPressed(code) { return this.pressed.has(code); }

  update(dt) {
    const k = this.keys, t = this.touch;
    let throttle = (k.has('KeyW') || k.has('ArrowUp') || t.gas) ? 1 : 0;
    let brake = (k.has('KeyS') || k.has('ArrowDown') || t.brake) ? 1 : 0;
    let steerTarget = 0;
    if (k.has('KeyA') || k.has('ArrowLeft') || t.left) steerTarget += 1;
    if (k.has('KeyD') || k.has('ArrowRight') || t.right) steerTarget -= 1;
    let handbrake = k.has('Space') || t.handbrake;
    let nitro = k.has('ShiftLeft') || k.has('ShiftRight') || t.nitro;

    // Digital steering is ramped so it feels analog and never twitchy
    const rate = steerTarget === 0 ? 7 : (Math.sign(steerTarget) !== Math.sign(this.steerSmoothed) ? 9 : 4.5);
    this.steerSmoothed = damp(this.steerSmoothed, steerTarget, rate, dt);
    let steer = this.steerSmoothed;

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp) continue;
      const btn = (i) => (gp.buttons[i] ? gp.buttons[i].value : 0);
      const ax = gp.axes[0] || 0;
      const stick = Math.abs(ax) > 0.12 ? -Math.sign(ax) * ((Math.abs(ax) - 0.12) / 0.88) ** 1.4 : 0;
      const rt = btn(7), lt = btn(6);
      if (Math.abs(stick) > 0.01 || rt > 0.05 || lt > 0.05 || gp.buttons.some((b) => b.pressed)) this.usingGamepad = true;
      if (this.usingGamepad) {
        steer = clamp(stick + (btn(14) ? 1 : 0) - (btn(15) ? 1 : 0), -1, 1);
        throttle = Math.max(throttle, rt, btn(12));
        brake = Math.max(brake, lt, btn(13));
        handbrake = handbrake || btn(0) > 0.5;
        nitro = nitro || btn(1) > 0.5 || btn(5) > 0.5;
      }
      const map = { 3: 'KeyC', 9: 'Escape', 2: 'KeyR', 8: 'KeyM' };
      for (const [i, code] of Object.entries(map)) {
        const p = !!(gp.buttons[i] && gp.buttons[i].pressed);
        if (p && !this.prevPadButtons[i]) this.pressed.add(code);
        this.prevPadButtons[i] = p;
      }
      break;
    }

    Object.assign(this.state, { throttle, brake, steer, handbrake, nitro });
    return this.state;
  }

  endFrame() { this.pressed.clear(); }

  rumble(strength, duration = 120) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (gp && gp.vibrationActuator && gp.vibrationActuator.playEffect) {
        gp.vibrationActuator.playEffect('dual-rumble', { duration, strongMagnitude: clamp(strength, 0, 1), weakMagnitude: clamp(strength * 0.6, 0, 1) }).catch(() => {});
      }
    }
  }
}
