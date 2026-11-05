import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { buildCarModel, buildToyModel, CAR_DIMS } from './CarModel.js';
import { clamp, lerp, damp } from './utils.js';
import { WATER_LEVEL } from './Environment.js';

const MASS = 1250;
const GEARS = [3.3, 2.15, 1.58, 1.22, 0.98, 0.8];
const REVERSE_RATIO = 3.1;
const FINAL_DRIVE = 3.6;
const IDLE_RPM = 900;
const REDLINE = 7600;
const SUSPENSION_REST = 0.3;
const TORQUE_TABLE = [[0, 250], [1000, 300], [2500, 410], [4000, 490], [5400, 530], [6600, 500], [7600, 430], [9000, 300]];

function torqueAt(rpm) {
  for (let i = 1; i < TORQUE_TABLE.length; i++) {
    const [r1, t1] = TORQUE_TABLE[i];
    if (rpm <= r1) {
      const [r0, t0] = TORQUE_TABLE[i - 1];
      return lerp(t0, t1, (rpm - r0) / (r1 - r0));
    }
  }
  return 300;
}

const _q = new THREE.Quaternion();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _v = new THREE.Vector3();

export class Car {
  constructor(world, physics, env, color) {
    this.world = world;
    this.physics = physics;
    this.env = env;
    this.scene = world.scene;

    this.models = { sport: buildCarModel(color), toy: buildToyModel() };
    for (const m of Object.values(this.models)) { this.scene.add(m.root, m.blob); m.root.visible = m.blob.visible = false; }
    this.model = this.models.sport;
    this.model.root.visible = this.model.blob.visible = true;
    this.mesh = this.model.root;
    this.speedCap = Infinity;
    this.groundAt = (x, z) => env.heightAt(x, z);
    this.offRoad = false;
    this.antennaRot = new THREE.Vector2();
    this.antennaVel = new THREE.Vector2();

    // Headlight beams
    this.spots = [];
    for (const sx of [-0.62, 0.62]) {
      const s = new THREE.SpotLight(0xfff2d8, 0, 70, 0.42, 0.55, 1.4);
      s.position.set(sx, 0.1, 2.25);
      s.target.position.set(sx * 1.5, -1.2, 14);
      this.model.body.add(s, s.target);
      this.spots.push(s);
    }
    this.nitroLight = new THREE.PointLight(0x55aaff, 0, 6, 2);
    this.nitroLight.position.set(0, -0.2, -2.9);
    this.model.body.add(this.nitroLight);
    this.modelKind = 'sport';

    this.input = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false };
    this.frozen = false;
    this.steerSens = 1.2;
    this.pitchVel = 0;
    this.rollVel = 0;
    this.lightsOn = false;

    this.rpm = IDLE_RPM;
    this.gear = 1;
    this.reverse = false;
    this.shiftTimer = 0;
    this.steerAngle = 0;
    this.nitro = 1;
    this.nitroActive = false;
    this.forwardSpeed = 0;
    this.lateralSpeed = 0;
    this.speed = 0;
    this.slipAngle = 0;
    this.skid = [0, 0, 0, 0];
    this.wheelSpin = [0, 0, 0, 0];
    this.wheelContact = [false, false, false, false];
    this.contactPoints = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    this.onGroundCount = 0;
    this.localAccel = new THREE.Vector3();
    this.bodyRoll = 0;
    this.bodyPitch = 0;
    this.events = [];          // 'shift', 'backfire'
    this.lastDeltaV = 0;
    this.inWater = false;
    this.throttleSmoothed = 0;
    this.upsideTimer = 0;

    this.prevPos = new THREE.Vector3();
    this.currPos = new THREE.Vector3();
    this.prevQuat = new THREE.Quaternion();
    this.currQuat = new THREE.Quaternion();
    this.prevVel = new THREE.Vector3();
    this.velocity = new THREE.Vector3();

    this.createPhysics();
  }

  createPhysics() {
    const pw = this.physics.world;
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, 3, 0)
      .setCanSleep(false)
      .setCcdEnabled(true)
      .setLinearDamping(0.02)
      .setAngularDamping(0.8)
      .setAdditionalMassProperties(
        MASS,
        { x: 0, y: -0.28, z: 0.05 },                  // low centre of mass = stable but lively
        { x: MASS * 1.9, y: MASS * 2.3, z: MASS * 0.6 },
        { x: 0, y: 0, z: 0, w: 1 },
      );
    this.body = pw.createRigidBody(desc);
    this.collider = pw.createCollider(
      RAPIER.ColliderDesc.cuboid(0.9, 0.28, 2.2).setTranslation(0, 0.02, 0).setDensity(0)
        .setFriction(0.25).setRestitution(0.15).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.body,
    );
    const roof = pw.createCollider(
      RAPIER.ColliderDesc.cuboid(0.7, 0.16, 1.0).setTranslation(0, 0.36, -0.4).setDensity(0).setFriction(0.3),
      this.body,
    );
    this.colliderHandles = new Set([this.collider.handle, roof.handle]);

    const vc = pw.createVehicleController(this.body);
    vc.indexUpAxis = 1;
    vc.setIndexForwardAxis = 2;
    const { wheelBase, track, connY, wheelRadius } = CAR_DIMS;
    const pos = [[track, wheelBase], [-track, wheelBase], [track, -wheelBase], [-track, -wheelBase]];
    pos.forEach(([x, z], i) => {
      vc.addWheel({ x, y: connY, z }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, SUSPENSION_REST, wheelRadius);
      vc.setWheelSuspensionStiffness(i, 27);
      vc.setWheelSuspensionCompression(i, 2.6);
      vc.setWheelSuspensionRelaxation(i, 3.0);
      vc.setWheelMaxSuspensionTravel(i, 0.26);
      vc.setWheelMaxSuspensionForce(i, 90000);
      vc.setWheelFrictionSlip(i, 2.2);
      vc.setWheelSideFrictionStiffness(i, 1.0);
    });
    this.vc = vc;
  }

  /** Swap between the realistic supercar and the Playground toy car. */
  useModel(kind) {
    if (kind === this.modelKind) return;
    const prev = this.model;
    const next = this.models[kind];
    prev.root.visible = prev.blob.visible = false;
    next.root.visible = next.blob.visible = true;
    next.root.position.copy(prev.root.position);
    next.root.quaternion.copy(prev.root.quaternion);
    for (const s of this.spots) next.body.add(s, s.target);
    next.body.add(this.nitroLight);
    this.model = next;
    this.mesh = next.root;
    this.modelKind = kind;
    this.setLights(this.lightsOn);
    // the toy is tuned for playful, controllable speeds
    this.speedCap = kind === 'toy' ? 21 : Infinity;
  }

  setColor(hex) {
    this.model.materials.paint.color.set(hex);
  }

  setLights(on) {
    this.lightsOn = on;
    this.spots.forEach((s) => { s.intensity = on ? 60 : 0; });
    this.model.materials.headlight.emissiveIntensity = on ? 8 : 0.6;
  }

  reset(pos, yaw) {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    this.body.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
    this.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.rpm = IDLE_RPM;
    this.gear = 1;
    this.reverse = false;
    this.steerAngle = 0;
    this.currPos.copy(pos); this.prevPos.copy(pos);
    this.currQuat.copy(q); this.prevQuat.copy(q);
    this.velocity.set(0, 0, 0); this.prevVel.set(0, 0, 0);
    this.upsideTimer = 0;
  }

  get kmh() { return Math.abs(this.forwardSpeed) * 3.6; }
  get yaw() { const f = this.forward; return Math.atan2(f.x, f.z); }
  get forward() { return new THREE.Vector3(0, 0, 1).applyQuaternion(this.mesh.quaternion); }

  /** Called once per fixed physics step, before world.step(). */
  fixedUpdate(dt) {
    const body = this.body, vc = this.vc;
    const r = body.rotation();
    _q.set(r.x, r.y, r.z, r.w);
    _fwd.set(0, 0, 1).applyQuaternion(_q);
    _right.set(-1, 0, 0).applyQuaternion(_q);
    _up.set(0, 1, 0).applyQuaternion(_q);
    const lv = body.linvel();
    _v.set(lv.x, lv.y, lv.z);
    this.speed = _v.length();
    this.forwardSpeed = _v.dot(_fwd);
    this.lateralSpeed = _v.dot(_right);

    const inp = this.input;
    let throttle = this.frozen ? 0 : inp.throttle;
    let brakeIn = this.frozen ? 0 : inp.brake;
    this.throttleSmoothed = damp(this.throttleSmoothed, inp.throttle, 10, dt);

    // Reverse logic: hold brake when (nearly) stopped to back up
    if (!this.frozen) {
      if (brakeIn > 0.1 && throttle < 0.1 && this.forwardSpeed < 0.6) this.reverse = true;
      if (throttle > 0.1 && this.forwardSpeed > -0.6) this.reverse = false;
    }
    let drive = this.reverse ? brakeIn : throttle;
    let brake = this.reverse ? throttle : brakeIn;
    if (!this.reverse && this.forwardSpeed < -0.5 && throttle > 0) brake = Math.max(brake, throttle);

    // Contacts
    let contacts = 0;
    for (let i = 0; i < 4; i++) {
      this.wheelContact[i] = vc.wheelIsInContact(i);
      if (this.wheelContact[i]) contacts++;
    }
    this.onGroundCount = contacts;

    // Engine & gearbox
    const ratio = this.reverse ? REVERSE_RATIO : GEARS[this.gear - 1];
    const wheelRpm = (Math.abs(this.forwardSpeed) / (2 * Math.PI * CAR_DIMS.wheelRadius)) * 60;
    let targetRpm = Math.max(IDLE_RPM, wheelRpm * ratio * FINAL_DRIVE);
    // Clutch engagement: blend from launch revs to wheel-locked revs as speed builds
    const clutchSlip = (this.gear === 1 || this.reverse) && Math.abs(this.forwardSpeed) < 9;
    if (this.frozen || contacts < 2) targetRpm = IDLE_RPM + this.throttleSmoothed * (REDLINE - IDLE_RPM) * 0.92;
    else if (clutchSlip) targetRpm = Math.max(targetRpm, lerp(IDLE_RPM + drive * 3400, targetRpm, Math.abs(this.forwardSpeed) / 9));
    this.rpm = damp(this.rpm, targetRpm, this.frozen ? 6 : 14, dt);
    let limiter = false;
    if (this.rpm > REDLINE) { this.rpm = REDLINE - 250; limiter = true; this.events.push('limiter'); }

    this.shiftTimer -= dt;
    if (!this.reverse && !this.frozen && this.shiftTimer <= 0 && contacts >= 2) {
      if (this.rpm > 7050 && this.gear < GEARS.length && drive > 0.2) {
        this.gear++; this.shiftTimer = 0.32; this.events.push('shift');
        if (Math.random() < 0.6) this.events.push('backfire');
      } else if (this.gear > 1) {
        const lowerRpm = wheelRpm * GEARS[this.gear - 2] * FINAL_DRIVE;
        if (lowerRpm < 6000 && this.rpm < 3300) { this.gear--; this.shiftTimer = 0.25; this.events.push('downshift'); }
      }
    }
    if (this.reverse) this.gear = 1;

    const shifting = this.shiftTimer > 0.12;
    let force = (torqueAt(this.rpm) * ratio * FINAL_DRIVE * 0.88 / CAR_DIMS.wheelRadius) * drive;
    if (shifting || limiter) force *= 0.15;

    // Nitro boost
    this.nitroActive = !this.frozen && inp.nitro && this.nitro > 0 && drive > 0.1 && !this.reverse;
    if (this.nitroActive) {
      force += 7500;
      this.nitro = Math.max(0, this.nitro - dt * 0.22);
    } else {
      this.nitro = Math.min(1, this.nitro + dt * 0.035);
    }
    const cap = this.speedCap + (this.nitroActive ? 9 : 0);
    if (this.forwardSpeed > cap) force = Math.min(force, 0);
    else if (this.forwardSpeed > cap - 4) force *= (cap - this.forwardSpeed) / 4;
    if (this.reverse) {
      force = -force * 0.6;
      if (this.forwardSpeed < -14) force = 0;
    }

    // Torque split 30 / 70 (rear-biased AWD)
    vc.setWheelEngineForce(0, force * 0.15);
    vc.setWheelEngineForce(1, force * 0.15);
    vc.setWheelEngineForce(2, force * 0.35);
    vc.setWheelEngineForce(3, force * 0.35);

    // Brakes (impulse per step)
    const rolling = drive < 0.05 ? 4 : 0;
    const b = brake * 70 + rolling;
    const hb = !this.frozen && inp.handbrake ? 95 : 0;
    vc.setWheelBrake(0, b);
    vc.setWheelBrake(1, b);
    vc.setWheelBrake(2, b * 0.8 + hb);
    vc.setWheelBrake(3, b * 0.8 + hb);
    if (this.frozen) for (let i = 0; i < 4; i++) vc.setWheelBrake(i, 200);

    // Grip: handbrake & power-oversteer let the rear slide for drifts
    const absSpeed = Math.abs(this.forwardSpeed);
    let rearGrip = 2.25;
    if (hb) rearGrip = 0.95;
    else if (drive > 0.8 && this.gear <= 2 && absSpeed > 4) rearGrip = 1.75;
    if (this.inWater) rearGrip *= 0.6;
    vc.setWheelFrictionSlip(0, this.inWater ? 1.4 : 2.45);
    vc.setWheelFrictionSlip(1, this.inWater ? 1.4 : 2.45);
    vc.setWheelFrictionSlip(2, rearGrip);
    vc.setWheelFrictionSlip(3, rearGrip);

    // Speed-sensitive steering with a touch of counter-steer assist
    const maxSteer = lerp(0.6, 0.085 + 0.035 * this.steerSens, clamp(absSpeed / 38, 0, 1));
    this.slipAngle = absSpeed > 2 ? Math.atan2(this.lateralSpeed, Math.abs(this.forwardSpeed)) : 0;
    let target = inp.steer * maxSteer;
    if (absSpeed > 6 && !this.reverse) target += clamp(-this.slipAngle * 0.35, -0.2, 0.2) * (1 - Math.abs(inp.steer) * 0.5);
    this.steerAngle = damp(this.steerAngle, target, 9 * this.steerSens, dt);
    vc.setWheelSteering(0, this.steerAngle);
    vc.setWheelSteering(1, this.steerAngle);

    // Aero: downforce + drag; water drag
    const drag = 0.38 * this.speed;
    const down = 1.6 * this.speed * this.speed;
    const waterDrag = this.inWater ? 900 : 0;
    body.applyImpulse({
      x: (-_v.x * (drag + waterDrag / Math.max(this.speed, 1)) - _up.x * down) * dt,
      y: (-_v.y * drag - _up.y * down) * dt,
      z: (-_v.z * (drag + waterDrag / Math.max(this.speed, 1)) - _up.z * down) * dt,
    }, true);

    // Air control: gently level the car mid-air so landings feel good
    if (contacts === 0) {
      const av = body.angvel();
      const levelX = _up.z * -1, levelZ = _up.x;
      body.applyTorqueImpulse({ x: (levelX * 900 - av.x * 300) * dt + _right.x * 0, y: inp.steer * 400 * dt, z: (levelZ * 900 - av.z * 300) * dt }, true);
    }

    // Grip-based yaw stability at speed when not drifting
    if (contacts >= 3 && !hb && Math.abs(this.slipAngle) < 0.2) {
      const av = body.angvel();
      body.applyTorqueImpulse({ x: 0, y: -av.y * 180 * dt * clamp(absSpeed / 30, 0, 1), z: 0 }, true);
    }

    vc.updateVehicle(dt);

    // Per-wheel skid amount for smoke, skid marks and tyre squeal
    const lat = Math.abs(this.lateralSpeed);
    const spinning = drive > 0.85 && this.gear === 1 && absSpeed < 4.5 && !this.reverse && !this.frozen;
    for (let i = 0; i < 4; i++) {
      let s = clamp((lat - 2.2) / 5, 0, 1);
      if (i >= 2) {
        if (hb && absSpeed > 3) s = Math.max(s, clamp(absSpeed / 15, 0.4, 1));
        if (spinning) s = Math.max(s, 0.55);
      }
      if (brake > 0.9 && absSpeed > 18) s = Math.max(s, 0.35);
      this.skid[i] = this.wheelContact[i] ? s : 0;
    }

    // Upside-down auto recovery
    if (_up.y < 0.2 && this.speed < 2) this.upsideTimer += dt; else this.upsideTimer = 0;
  }

  /** Called after world.step() each fixed step. */
  postStep(dt) {
    this.prevPos.copy(this.currPos);
    this.prevQuat.copy(this.currQuat);
    const t = this.body.translation(), r = this.body.rotation();
    this.currPos.set(t.x, t.y, t.z);
    this.currQuat.set(r.x, r.y, r.z, r.w);
    this.prevVel.copy(this.velocity);
    const lv = this.body.linvel();
    this.velocity.set(lv.x, lv.y, lv.z);
    const dv = _v.copy(this.velocity).sub(this.prevVel);
    dv.y += 9.81 * dt;
    this.lastDeltaV = Math.hypot(dv.x, dv.z) + Math.max(0, dv.y) * 0.4;
    // local acceleration for body roll / pitch
    const inv = _q.copy(this.currQuat).invert();
    const acc = dv.divideScalar(dt).applyQuaternion(inv);
    this.localAccel.lerp(acc, 0.35);
    this.inWater = this.currPos.y < WATER_LEVEL + 0.25;
  }

  updateVisual(alpha, dt, time) {
    const root = this.model.root;
    root.position.lerpVectors(this.prevPos, this.currPos, alpha);
    root.quaternion.slerpQuaternions(this.prevQuat, this.currQuat, alpha);

    // Extra body roll & pitch layered on the physics for a juicy feel
    // Under-damped springs: the body squats on launch, dives under braking and
    // visibly bounces back when the car comes to rest.
    const pitchTarget = clamp(-this.localAccel.z * 0.006, -0.06, 0.06);
    const rollTarget = clamp(this.localAccel.x * 0.0065, -0.07, 0.07);
    const h = Math.min(dt, 1 / 30);
    this.pitchVel += ((pitchTarget - this.bodyPitch) * 110 - this.pitchVel * 7.5) * h;
    this.bodyPitch += this.pitchVel * h;
    this.rollVel += ((rollTarget - this.bodyRoll) * 90 - this.rollVel * 7) * h;
    this.bodyRoll += this.rollVel * h;
    this.model.body.rotation.set(this.bodyPitch, 0, this.bodyRoll);
    // Toy antenna: a springy whip that reacts to acceleration and turning
    if (this.model.antenna) {
      const tx = clamp(this.localAccel.z * 0.03, -0.6, 0.6), tz = clamp(-this.localAccel.x * 0.03, -0.6, 0.6);
      this.antennaVel.x += ((tx - this.antennaRot.x) * 160 - this.antennaVel.x * 5) * h;
      this.antennaVel.y += ((tz - this.antennaRot.y) * 160 - this.antennaVel.y * 5) * h;
      this.antennaRot.x += this.antennaVel.x * h;
      this.antennaRot.y += this.antennaVel.y * h;
      this.model.antenna.rotation.set(this.antennaRot.x, 0, this.antennaRot.y);
    }
    // idle engine shake
    this.model.body.position.y = Math.sin(time * (this.rpm / 60) * 0.5) * 0.0025 * (this.rpm < 1500 ? 1 : 0.3);

    const R = CAR_DIMS.wheelRadius;
    for (let i = 0; i < 4; i++) {
      const w = this.model.wheels[i];
      const len = this.vc.wheelSuspensionLength(i) ?? SUSPENSION_REST;
      w.pivot.position.y = CAR_DIMS.connY - len;
      if (w.front) w.pivot.rotation.y = this.steerAngle;
      let spinRate = this.forwardSpeed / R;
      if (i >= 2) {
        if (this.input.handbrake && !this.frozen) spinRate = 0;
        else if (this.skid[i] > 0.8 && this.input.throttle > 0.8) spinRate = 40;
      }
      if (!this.wheelContact[i]) spinRate = (this.input.throttle * 30) * (i >= 2 ? 1 : 0) + this.wheelSpin[i] * 0;
      this.wheelSpin[i] += spinRate * dt;
      w.spin.rotation.x = this.wheelSpin[i];
      if (this.wheelContact[i]) {
        const cp = this.vc.wheelContactPoint(i);
        if (cp) this.contactPoints[i].set(cp.x, cp.y, cp.z);
      }
    }

    // Lights
    const m = this.model.materials;
    const braking = (this.reverse ? this.input.throttle : this.input.brake) > 0.1 || this.frozen;
    m.taillight.emissiveIntensity = braking ? 5 : (this.lightsOn ? 1.6 : 0.35);
    m.reverse.emissiveIntensity = this.reverse && this.input.brake > 0.1 ? 6 : 0;

    // Nitro flames & backfire
    const flick = 0.75 + Math.random() * 0.5;
    const backfire = this.backfireTimer > 0;
    this.backfireTimer = (this.backfireTimer || 0) - dt;
    for (const f of this.model.flames) {
      f.visible = this.nitroActive || backfire;
      if (this.nitroActive) { f.scale.set(flick, flick, 1 + Math.random() * 0.8); m.flame.color.setHex(0x5aa8ff); }
      else if (backfire) { f.scale.set(0.8, 0.8, 0.5 + Math.random() * 0.4); m.flame.color.setHex(0xff8a2a); }
    }
    this.nitroLight.intensity = this.nitroActive ? 25 * flick : backfire ? 12 : 0;
    this.nitroLight.color.setHex(this.nitroActive ? 0x55aaff : 0xff8a2a);

    // Contact shadow follows the ground under the car
    const p = root.position;
    const gy = this.onGroundCount > 0 ? Math.min(...this.contactPoints.map((c) => c.y)) : this.groundAt(p.x, p.z);
    this.model.blob.position.set(p.x, gy + 0.05, p.z);
    this.model.blob.rotation.z = Math.atan2(this.forward.x, this.forward.z);
    const hgt = clamp(p.y - gy, 0, 6);
    this.model.blob.material.opacity = 0.75 * (1 - hgt / 6);
  }

  triggerBackfire() { this.backfireTimer = 0.12; }

  consumeEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }
}
