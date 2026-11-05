import * as THREE from 'three';
import { buildCarModel } from './CarModel.js';
import { safeStorage, clamp } from './utils.js';

const LAPS = 3;
const CHECKPOINTS = 8;
const store = safeStorage();

export class Game {
  constructor({ world, env, car, ui, audio, effects, rig, input }) {
    Object.assign(this, { world, env, car, ui, audio, effects, rig, input });
    this.mode = 'free';
    this.state = 'menu';
    this.time = 0;
    this.trackIndex = 0;
    this.best = store.get('vr.bestLap', null);
    this.ghostData = store.get('vr.ghost', null);
    this.buildCollectibles();
    this.buildCheckpointMarkers();
    this.ghost = buildCarModel(0x66ddff, { ghost: true });
    this.ghost.root.visible = false;
    this.world.scene.add(this.ghost.root);
    this.resetStats();
  }

  resetStats() {
    this.score = 0;
    this.coins = 0;
    this.topSpeed = 0;
    this.drift = { active: false, score: 0, time: 0, grace: 0, mult: 1 };
    this.airTime = 0;
    this.lap = 1;
    this.lapTimes = [];
    this.lapStart = 0;
    this.raceTime = 0;
    this.nextCp = 0;
    this.wrongWayTimer = 0;
    this.recording = [];
    this.recordTimer = 0;
    this.lastCrash = 0;
  }

  // ------------------------------------------------ collectibles
  buildCollectibles() {
    const env = this.env;
    const coinGeo = new THREE.CylinderGeometry(0.7, 0.7, 0.14, 28).rotateX(Math.PI / 2);
    const coinMat = new THREE.MeshStandardMaterial({ color: 0xffc400, metalness: 1, roughness: 0.25, emissive: 0x6b4a00, emissiveIntensity: 0.9 });
    const spots = [];
    for (let i = 10; i < env.N; i += 22) {
      const p = env.samples[i], r = env.rights[i];
      const off = Math.sin(i * 0.37) * (env.trackWidth / 2 - 2);
      spots.push(new THREE.Vector3(p.x + r.x * off, 1.3, p.z + r.z * off));
    }
    // coins in the stunt park, some above ramps for airtime rewards
    for (const [x, y, z] of [[0, 5, -16], [0, 6, -10], [36, 7, -2], [36, 8, -8], [-32, 4, -18], [-20, 1.3, 30], [20, 1.3, 30], [-25, 1.3, 20], [25, 1.3, -20]]) spots.push(new THREE.Vector3(x, y, z));
    this.coinSpots = spots.map((p) => ({ p, alive: true, respawn: 0 }));
    this.coinMesh = new THREE.InstancedMesh(coinGeo, coinMat, spots.length);
    this.coinMesh.castShadow = true;
    this.world.scene.add(this.coinMesh);

    const nGeo = new THREE.CapsuleGeometry(0.35, 0.8, 6, 16);
    const nMat = new THREE.MeshStandardMaterial({ color: 0x2979ff, emissive: 0x00b0ff, emissiveIntensity: 2.2, metalness: 0.5, roughness: 0.2 });
    const nSpots = [];
    for (let i = 45; i < env.N; i += 80) {
      const p = env.samples[i];
      nSpots.push(new THREE.Vector3(p.x, 1.4, p.z));
    }
    nSpots.push(new THREE.Vector3(0, 1.4, 0), new THREE.Vector3(-40, 1.4, 42));
    this.nitroSpots = nSpots.map((p) => ({ p, alive: true, respawn: 0 }));
    this.nitroMesh = new THREE.InstancedMesh(nGeo, nMat, nSpots.length);
    this.world.scene.add(this.nitroMesh);
    // ring halos for nitro pickups
    const haloGeo = new THREE.TorusGeometry(1.0, 0.06, 8, 32).rotateX(Math.PI / 2);
    this.haloMesh = new THREE.InstancedMesh(haloGeo, new THREE.MeshBasicMaterial({ color: 0x80d8ff, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }), nSpots.length);
    this.world.scene.add(this.haloMesh);
  }

  buildCheckpointMarkers() {
    const env = this.env;
    this.cpIndices = [];
    for (let k = 1; k <= CHECKPOINTS; k++) this.cpIndices.push(Math.floor((k / (CHECKPOINTS + 1)) * env.N));
    const geo = new THREE.TorusGeometry(env.trackWidth / 2 + 1.5, 0.25, 8, 48, Math.PI);
    const mat = new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
    this.cpMarker = new THREE.Mesh(geo, mat);
    this.cpMarker.visible = false;
    this.world.scene.add(this.cpMarker);
  }

  placeCpMarker() {
    const env = this.env;
    if (this.mode !== 'trial' || this.state === 'finished') { this.cpMarker.visible = false; return; }
    const idx = this.nextCp < CHECKPOINTS ? this.cpIndices[this.nextCp] : 0;
    const p = env.samples[idx], t = env.tangents[idx];
    this.cpMarker.position.set(p.x, 0, p.z);
    this.cpMarker.rotation.set(0, Math.atan2(t.x, t.z) + Math.PI / 2, 0);
    this.cpMarker.material.color.setHex(this.nextCp < CHECKPOINTS ? 0x00e5ff : 0xffd740);
    this.cpMarker.visible = true;
  }

  // ------------------------------------------------ flow
  spawnAtStart() {
    const env = this.env;
    const back = this.mode === 'trial' ? -9 : -4;
    const t = env.tangents[0];
    const p = env.startPos.clone().addScaledVector(t, back);
    p.y = env.heightAt(p.x, p.z) + 0.9;
    this.car.reset(p, env.startYaw);
    this.trackIndex = 0;
    this.rig.snap();
  }

  start(mode) {
    this.mode = mode;
    this.resetStats();
    this.env.resetProps();
    this.effects.skids.clear();
    this.spawnAtStart();
    this.coinSpots.forEach((c) => { c.alive = mode === 'free'; });
    this.nitroSpots.forEach((c) => { c.alive = true; });
    this.car.nitro = 1;
    this.ui.setMode(mode);
    this.ui.showScreen('hud');
    this.ghost.root.visible = false;
    if (mode === 'trial') {
      this.state = 'countdown';
      this.countdownT = 0;
      this.countdownStep = -1;
      this.car.frozen = true;
      this.env.setStartLights(0);
    } else {
      this.state = 'playing';
      this.car.frozen = false;
      this.env.setStartLights(0, true);
      this.ui.banner('FREE ROAM', 'gold', 1.6);
    }
    this.placeCpMarker();
  }

  pause() {
    if (this.state !== 'playing' && this.state !== 'countdown') return;
    this.prevState = this.state;
    this.state = 'paused';
    this.ui.showScreen('pause');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = this.prevState;
    this.ui.showScreen('hud');
  }

  toMenu() {
    this.state = 'menu';
    this.car.frozen = true;
    this.ghost.root.visible = false;
    this.cpMarker.visible = false;
    this.ui.showScreen('menu');
    this.spawnAtStart();
  }

  resetCar() {
    const env = this.env;
    const n = env.nearestTrack(this.car.mesh.position.x, this.car.mesh.position.z, this.trackIndex);
    const p = env.samples[n.index].clone();
    p.y = env.heightAt(p.x, p.z) + 1.0;
    const t = env.tangents[n.index];
    this.car.reset(p, Math.atan2(t.x, t.z));
    this.rig.snap();
    this.endDrift(true);
    this.ui.popup('RESET', 'blue');
  }

  // ------------------------------------------------ per-frame logic
  update(dt) {
    const car = this.car;
    this.time += dt;
    this.animateCollectibles(dt);
    if (this.state === 'countdown') this.updateCountdown(dt);
    if (this.state !== 'playing' && this.state !== 'countdown') return;

    const p = car.mesh.position;
    const n = this.env.nearestTrack(p.x, p.z, this.trackIndex);
    this.trackIndex = n.index;
    car.trackIndex = n.index;
    this.offRoad = n.dist > this.env.trackWidth / 2 + 1.5 && Math.hypot(p.x, p.z) > 58;
    this.topSpeed = Math.max(this.topSpeed, car.kmh);

    if (this.state === 'playing') {
      this.updateDrift(dt);
      this.updateAir(dt);
      this.updatePickups(dt);
      if (this.mode === 'trial') this.updateRace(dt);
      if (car.upsideTimer > 2) this.resetCar();
    }

    if (this.mode === 'trial') {
      this.ui.updateTrial({ lap: this.lap, laps: LAPS, time: this.state === 'playing' ? this.time - this.lapStart : 0, best: this.best, cp: this.nextCp, cps: CHECKPOINTS });
    } else {
      this.ui.updateFree({ score: this.score, coins: this.coins, top: this.topSpeed });
    }
  }

  updateCountdown(dt) {
    this.countdownT += dt;
    const step = Math.floor(this.countdownT / 0.8);
    if (step !== this.countdownStep) {
      this.countdownStep = step;
      if (step >= 1 && step <= 3) {
        this.ui.countdown(String(4 - step));
        this.audio.countdown(false);
        this.env.setStartLights(Math.min(5, step * 2 - 1 + (step === 3 ? 1 : 0)));
      } else if (step === 4) {
        this.ui.countdown('GO!', true);
        this.audio.countdown(true);
        this.env.setStartLights(5, true);
        this.state = 'playing';
        this.car.frozen = false;
        this.lapStart = this.time;
        this.raceStart = this.time;
        this.env.crowdExcite = 1;
        this.startGhostPlayback();
      }
    }
  }

  updateDrift(dt) {
    const car = this.car, d = this.drift;
    const angle = Math.abs(car.slipAngle);
    const drifting = car.onGroundCount >= 3 && car.speed > 9 && angle > 0.22 && angle < 1.6 && car.forwardSpeed > 0;
    if (drifting) {
      if (!d.active) { d.active = true; d.score = 0; d.time = 0; d.mult = 1; }
      d.grace = 0.7;
      d.time += dt;
      d.score += car.speed * angle * dt * 14 * d.mult;
      const newMult = clamp(1 + Math.floor(d.time / 1.6), 1, 6);
      if (newMult > d.mult) { d.mult = newMult; this.audio.drift(newMult); }
    } else if (d.active) {
      d.grace -= dt;
      if (d.grace <= 0) this.endDrift(false);
    }
    this.ui.updateDrift(d.active && d.score > 30, d.score, d.mult);
  }

  endDrift(failed) {
    const d = this.drift;
    if (!d.active) return;
    d.active = false;
    if (failed) {
      if (d.score > 100) { this.ui.popup('DRIFT LOST', 'red'); this.audio.fail(); }
    } else if (d.score > 30) {
      const pts = Math.round(d.score);
      this.score += pts;
      const label = pts > 5000 ? 'INSANE DRIFT' : pts > 2000 ? 'GREAT DRIFT' : 'DRIFT';
      this.ui.popup(`+${pts.toLocaleString()} ${label}`, 'gold');
      if (pts > 2000) this.env.crowdExcite = 1;
    }
    this.ui.updateDrift(false, 0, 1);
  }

  updateAir(dt) {
    const car = this.car;
    if (car.onGroundCount === 0) this.airTime += dt;
    else if (this.airTime > 0) {
      if (this.airTime > 0.6) {
        const pts = Math.round(this.airTime * 400);
        this.score += pts;
        this.ui.popup(`AIR ${this.airTime.toFixed(1)}s +${pts}`, 'blue');
        this.rig.addTrauma(clamp(this.airTime * 0.25, 0.1, 0.5));
        this.audio.impact(4 + this.airTime * 3);
      }
      this.airTime = 0;
    }
  }

  onCrash(strength, point) {
    if (this.time - this.lastCrash < 0.25) return;
    this.lastCrash = this.time;
    if (strength > 3) {
      this.audio.impact(strength);
      this.rig.addTrauma(clamp(strength / 18, 0.12, 0.8));
      this.input.rumble(clamp(strength / 15, 0.2, 1), 200);
      this.effects.sparks(point, Math.round(clamp(strength * 4, 10, 60)), clamp(strength / 10, 0.5, 1.5));
      if (strength > 6) this.endDrift(true);
    }
  }

  updatePickups(dt) {
    const p = this.car.mesh.position;
    const check = (list, radius, onPick) => {
      for (const c of list) {
        if (!c.alive) {
          c.respawn -= dt;
          if (c.respawn <= 0) c.alive = true;
          continue;
        }
        if (c.p.distanceToSquared(p) < radius * radius) { c.alive = false; c.respawn = 25; onPick(c); }
      }
    };
    if (this.mode === 'free') {
      check(this.coinSpots, 2.6, (c) => {
        this.coins++;
        this.score += 100;
        this.audio.coin();
        this.effects.burst(c.p, 0xffd54f, 30);
        this.ui.popup('+100', 'gold');
      });
    }
    check(this.nitroSpots, 2.8, (c) => {
      this.car.nitro = 1;
      this.audio.powerup();
      this.effects.burst(c.p, 0x40c4ff, 45);
      this.ui.popup('NITRO REFILL', 'blue');
    });
  }

  animateCollectibles() {
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const t = this.time;
    this.coinSpots.forEach((c, i) => {
      const sc = c.alive ? 1 : 0;
      q.setFromAxisAngle(up, t * 3 + i);
      m4.compose(v.set(c.p.x, c.p.y + Math.sin(t * 2.5 + i) * 0.25, c.p.z), q, s.setScalar(sc));
      this.coinMesh.setMatrixAt(i, m4);
    });
    this.coinMesh.instanceMatrix.needsUpdate = true;
    this.nitroSpots.forEach((c, i) => {
      const sc = c.alive ? 1 : 0;
      q.setFromAxisAngle(up, t * 1.5 + i);
      m4.compose(v.set(c.p.x, c.p.y + Math.sin(t * 2 + i) * 0.3, c.p.z), q, s.setScalar(sc));
      this.nitroMesh.setMatrixAt(i, m4);
      const pulse = 1 + Math.sin(t * 4 + i) * 0.15;
      m4.compose(v.set(c.p.x, c.p.y - 0.6, c.p.z), q.identity(), s.setScalar(sc * pulse * 1.3));
      this.haloMesh.setMatrixAt(i, m4);
    });
    this.nitroMesh.instanceMatrix.needsUpdate = true;
    this.haloMesh.instanceMatrix.needsUpdate = true;
    this.coinMesh.computeBoundingSphere();
    this.nitroMesh.computeBoundingSphere();
    this.haloMesh.computeBoundingSphere();
    if (this.cpMarker.visible) this.cpMarker.material.opacity = 0.4 + Math.sin(t * 5) * 0.2;
  }

  // ------------------------------------------------ race
  updateRace(dt) {
    const car = this.car, env = this.env;
    const idx = this.trackIndex;
    // Ghost recording
    this.recordTimer += dt;
    if (this.recordTimer >= 0.05) {
      this.recordTimer = 0;
      const p = car.mesh.position, q = car.mesh.quaternion;
      this.recording.push([+(this.time - this.lapStart).toFixed(3), +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), +q.x.toFixed(4), +q.y.toFixed(4), +q.z.toFixed(4), +q.w.toFixed(4)]);
    }
    this.updateGhost();

    const near = (target) => ((idx - target + env.N) % env.N) < 25;
    if (this.nextCp < CHECKPOINTS) {
      if (near(this.cpIndices[this.nextCp])) {
        this.nextCp++;
        this.audio.checkpoint();
        const split = this.time - this.lapStart;
        this.ui.popup(`CHECKPOINT ${this.nextCp}/${CHECKPOINTS}`, 'green');
        this.placeCpMarker();
        void split;
      }
    } else if (near(0)) {
      this.completeLap();
    }

    // Wrong way detection
    const t = env.tangents[idx];
    const f = car.forward;
    if (f.x * t.x + f.z * t.z < -0.5 && car.forwardSpeed > 5) this.wrongWayTimer += dt; else this.wrongWayTimer = 0;
    if (this.wrongWayTimer > 1.2) { this.ui.banner('WRONG WAY', 'warn', 0.5); }
  }

  completeLap() {
    const lapTime = this.time - this.lapStart;
    this.lapTimes.push(lapTime);
    const isBest = this.best == null || lapTime < this.best;
    if (isBest) {
      this.best = lapTime;
      store.set('vr.bestLap', lapTime);
      this.ghostData = this.recording;
      store.set('vr.ghost', this.recording);
    }
    this.recording = [];
    this.lapStart = this.time;
    this.nextCp = 0;
    this.env.crowdExcite = 1;
    if (this.lap >= LAPS) {
      this.finishRace();
      return;
    }
    this.lap++;
    this.audio.lap();
    this.ui.banner(isBest ? 'BEST LAP!' : `LAP ${this.lap}`, isBest ? 'gold' : 'good', 2);
    this.placeCpMarker();
    this.startGhostPlayback();
  }

  finishRace() {
    this.state = 'finished';
    this.audio.lap();
    this.car.frozen = true;
    this.cpMarker.visible = false;
    this.ghost.root.visible = false;
    this.effects.confetti(this.car.mesh.position, 260);
    const total = this.lapTimes.reduce((a, b) => a + b, 0);
    const prevBestTotal = store.get('vr.bestTotal', null);
    const record = prevBestTotal == null || total < prevBestTotal;
    if (record) store.set('vr.bestTotal', total);
    this.ui.banner('FINISH!', 'gold', 2.5);
    setTimeout(() => {
      if (this.state === 'finished') this.ui.showResults({ total, laps: this.lapTimes, best: Math.min(...this.lapTimes), record, score: this.score });
    }, 1800);
  }

  startGhostPlayback() {
    this.ghostIdx = 0;
    this.ghost.root.visible = !!(this.ghostData && this.ghostData.length > 10);
  }

  updateGhost() {
    const g = this.ghostData;
    if (!g || !this.ghost.root.visible) return;
    const t = this.time - this.lapStart;
    while (this.ghostIdx < g.length - 2 && g[this.ghostIdx + 1][0] < t) this.ghostIdx++;
    const a = g[this.ghostIdx], b = g[Math.min(this.ghostIdx + 1, g.length - 1)];
    if (t > g[g.length - 1][0]) { this.ghost.root.visible = false; return; }
    const k = clamp((t - a[0]) / Math.max(b[0] - a[0], 1e-3), 0, 1);
    this.ghost.root.position.set(a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k);
    const qa = new THREE.Quaternion(a[4], a[5], a[6], a[7]), qb = new THREE.Quaternion(b[4], b[5], b[6], b[7]);
    this.ghost.root.quaternion.slerpQuaternions(qa, qb, k);
    this.ghost.wheels.forEach((w) => { w.spin.rotation.x += 0.5; w.pivot.position.y = -0.6; });
  }

  minimapExtras() {
    const out = [];
    if (this.mode === 'free') for (const c of this.coinSpots) if (c.alive) out.push({ x: c.p.x, z: c.p.z, color: '#ffd740', r: 3 });
    for (const c of this.nitroSpots) if (c.alive) out.push({ x: c.p.x, z: c.p.z, color: '#40c4ff', r: 4 });
    if (this.mode === 'trial' && this.cpMarker.visible) out.push({ x: this.cpMarker.position.x, z: this.cpMarker.position.z, color: '#00e5ff', r: 7 });
    if (this.ghost.root.visible) out.push({ x: this.ghost.root.position.x, z: this.ghost.root.position.z, color: 'rgba(120,220,255,0.8)', r: 5 });
    return out;
  }
}
