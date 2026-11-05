import * as THREE from 'three';
import { damp, clamp, noise2 } from './utils.js';

export const CAMERA_MODES = ['Chase', 'Far Chase', 'Hood', 'Cinematic'];

const _target = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _look = new THREE.Vector3();

export class CameraRig {
  constructor(camera, env) {
    this.camera = camera;
    this.env = env;
    this.mode = 0;
    this.trauma = 0;
    this.time = 0;
    this.heading = 0;
    this.fov = camera.fov;
    this.orbitAngle = 0;
    this.lookPos = new THREE.Vector3();
    this.initialized = false;
    this.cinematicTimer = 0;
    this.cinematicSpot = new THREE.Vector3();
    this.groundAt = (x, z) => env.heightAt(x, z);
    this.iso = false;
    this.zoom = 1;
    window.addEventListener('wheel', (e) => { if (this.iso) this.zoom = clamp(this.zoom * (e.deltaY > 0 ? 1.08 : 0.92), 0.55, 1.7); }, { passive: true });
  }

  cycle() { this.mode = (this.mode + 1) % CAMERA_MODES.length; this.initialized = false; return CAMERA_MODES[this.mode]; }

  addTrauma(a) { this.trauma = clamp(this.trauma + a, 0, 1); }

  snap() { this.initialized = false; }

  /** Slow orbit used for the menu / garage / results screens. */
  updateOrbit(car, dt, radius = 7.5, height = 2.2, speed = 0.18) {
    this.orbitAngle += dt * speed;
    const p = car.mesh.position;
    _desired.set(p.x + Math.sin(this.orbitAngle) * radius, p.y + height, p.z + Math.cos(this.orbitAngle) * radius);
    if (!this.initialized) { this.camera.position.copy(_desired); this.initialized = true; }
    this.camera.position.lerp(_desired, 1 - Math.exp(-3 * dt));
    _look.set(p.x, p.y + 0.3, p.z);
    this.camera.lookAt(_look);
    this.fov = damp(this.fov, 45, 3, dt);
    this.applyFov();
  }

  /** High, fixed-angle diorama camera used by the Playground. */
  updateIso(car, dt) {
    this.time += dt;
    const p = car.mesh.position;
    const z = this.zoom;
    _desired.set(p.x - 11 * z, p.y + 14 * z, p.z - 11 * z);
    // lead the camera slightly in the direction of travel
    _desired.x += car.velocity.x * 0.18;
    _desired.z += car.velocity.z * 0.18;
    if (!this.initialized) { this.camera.position.copy(_desired); this.lookPos.copy(p); this.initialized = true; }
    const cp = this.camera.position;
    cp.x = damp(cp.x, _desired.x, 4, dt);
    cp.y = damp(cp.y, _desired.y, 4, dt);
    cp.z = damp(cp.z, _desired.z, 4, dt);
    _target.set(p.x + car.velocity.x * 0.18, p.y, p.z + car.velocity.z * 0.18);
    this.lookPos.lerp(_target, 1 - Math.exp(-5 * dt));
    this.camera.lookAt(this.lookPos);
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    const shake = this.trauma * this.trauma;
    if (shake > 0.0005) {
      const t = this.time * 22;
      this.camera.position.x += noise2(t, 1.3) * shake * 0.6;
      this.camera.position.y += noise2(t, 7.1) * shake * 0.6;
    }
    this.fov = damp(this.fov, 45, 3, dt);
    this.applyFov();
  }

  update(car, dt, boostAmount) {
    if (this.iso) { this.updateIso(car, dt); return; }
    this.time += dt;
    const p = car.mesh.position;
    const fwd = car.forward;
    const speed = car.speed;
    const flatYaw = Math.atan2(fwd.x, fwd.z);
    // Camera heading follows the car's velocity when moving, so drifts look cinematic
    let velYaw = flatYaw;
    if (speed > 4 && car.forwardSpeed > 0) velYaw = Math.atan2(car.velocity.x, car.velocity.z);
    const desiredHeading = speed > 4 ? lerpAngle(flatYaw, velYaw, 0.45) : flatYaw;
    if (!this.initialized) this.heading = desiredHeading;
    if (car.forwardSpeed < -2) this.heading = lerpAngle(this.heading, flatYaw, 1 - Math.exp(-2 * dt));
    else this.heading = lerpAngle(this.heading, desiredHeading, 1 - Math.exp(-4.5 * dt));

    const mode = CAMERA_MODES[this.mode];
    let fovTarget = 62 + clamp(speed * 0.38, 0, 24) + boostAmount * 10;
    const hx = Math.sin(this.heading), hz = Math.cos(this.heading);

    if (mode === 'Hood') {
      _desired.set(0, 0.55, 0.35).applyQuaternion(car.mesh.quaternion).add(p);
      this.camera.position.copy(_desired);
      _look.set(0, 0.35, 12).applyQuaternion(car.mesh.quaternion).add(p);
      this.camera.lookAt(_look);
      fovTarget += 4;
    } else if (mode === 'Cinematic') {
      // Trackside cameras that hand over as the car passes
      this.cinematicTimer -= dt;
      if (this.cinematicTimer <= 0 || this.cinematicSpot.distanceTo(p) > 55 || !this.initialized) {
        const ahead = car.velocity.clone().setY(0);
        if (ahead.lengthSq() < 1) ahead.copy(fwd);
        ahead.normalize().multiplyScalar(25 + speed * 0.8);
        const side = new THREE.Vector3(-ahead.z, 0, ahead.x).normalize().multiplyScalar((Math.random() < 0.5 ? -1 : 1) * (6 + Math.random() * 8));
        this.cinematicSpot.copy(p).add(ahead).add(side);
        this.cinematicSpot.y = this.groundAt(this.cinematicSpot.x, this.cinematicSpot.z) + 1.2 + Math.random() * 3;
        this.cinematicTimer = 6;
        this.camera.position.copy(this.cinematicSpot);
        this.initialized = true;
      }
      this.camera.position.copy(this.cinematicSpot);
      _look.copy(p).y += 0.5;
      this.lookPos.lerp(_look, 1 - Math.exp(-10 * dt));
      this.camera.lookAt(this.lookPos);
      fovTarget = clamp(70 - this.cinematicSpot.distanceTo(p) * 0.6, 22, 60);
    } else {
      const far = mode === 'Far Chase';
      const dist = (far ? 9.5 : 6.2) + clamp(speed * 0.04, 0, 1.8);
      const height = (far ? 3.4 : 2.1) + clamp(speed * 0.01, 0, 0.5);
      _desired.set(p.x - hx * dist, p.y + height, p.z - hz * dist);
      const ground = this.groundAt(_desired.x, _desired.z) + 0.6;
      if (_desired.y < ground) _desired.y = ground;
      if (!this.initialized) { this.camera.position.copy(_desired); this.lookPos.copy(p); }
      const cp = this.camera.position;
      // stiffer horizontally, softer vertically (smooths bumps & jumps)
      cp.x = damp(cp.x, _desired.x, 9, dt);
      cp.z = damp(cp.z, _desired.z, 9, dt);
      cp.y = damp(cp.y, _desired.y, 5, dt);
      _target.set(p.x + hx * 4, p.y + 0.9, p.z + hz * 4);
      this.lookPos.lerp(_target, 1 - Math.exp(-14 * dt));
      this.camera.lookAt(this.lookPos);
      this.initialized = true;
    }

    // Trauma-based shake (squared for nice falloff) + subtle high-speed rumble
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    const shake = this.trauma * this.trauma + clamp((speed - 30) / 60, 0, 0.04) + boostAmount * 0.03;
    if (shake > 0.0005) {
      const t = this.time * 22;
      this.camera.position.x += noise2(t, 1.3) * shake * 0.5;
      this.camera.position.y += noise2(t, 7.1) * shake * 0.5;
      this.camera.rotation.z += noise2(t, 13.7) * shake * 0.06;
    }
    this.fov = damp(this.fov, fovTarget, 4, dt);
    this.applyFov();
  }

  applyFov() {
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
