import * as THREE from 'three';
import { WATER_LEVEL } from './Environment.js';

function softTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

class ParticlePool {
  constructor(scene, max, { additive = false, texture }) {
    this.max = max;
    this.cursor = 0;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.alpha0 = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry = g;
    this.material = new THREE.ShaderMaterial({
      uniforms: { map: { value: texture }, scale: { value: window.innerHeight * 0.9 } },
      vertexShader: /* glsl */`
        attribute float size; attribute float alpha; attribute vec3 color;
        uniform float scale; varying float vA; varying vec3 vC;
        void main(){
          vA = alpha; vC = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = min(size * scale / max(-mv.z, 0.1), 600.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D map; varying float vA; varying vec3 vC;
        void main(){
          vec4 t = texture2D(map, gl_PointCoord);
          if (t.a * vA < 0.003) discard;
          gl_FragColor = vec4(vC, t.a * vA);
        }`,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  spawn(p, v, { color = 0xffffff, size = 1, life = 1, grow = 0, drag = 0, gravity = 0, alpha = 1 }) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x; this.vel[i * 3 + 1] = v.y; this.vel[i * 3 + 2] = v.z;
    const c = typeof color === 'number' ? _c.setHex(color) : color;
    this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b;
    this.size[i] = size;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.grow[i] = grow;
    this.drag[i] = drag;
    this.grav[i] = gravity;
    this.alpha0[i] = alpha;
    this.alpha[i] = alpha;
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const k = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= k; this.vel[i * 3 + 1] *= k; this.vel[i * 3 + 2] *= k;
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      const t = this.life[i] / this.maxLife[i];
      this.alpha[i] = this.alpha0[i] * Math.min(1, t * 2.5) * Math.min(1, (1 - t) * 8 + 0.2);
    }
    const a = this.geometry.attributes;
    a.position.needsUpdate = a.color.needsUpdate = a.size.needsUpdate = a.alpha.needsUpdate = true;
  }
}
const _c = new THREE.Color();
const _p = new THREE.Vector3();
const _v = new THREE.Vector3();

class SkidMarks {
  constructor(scene, max = 2400) {
    this.max = max;
    this.cursor = 0;
    this.count = 0;
    this.positions = new Float32Array(max * 6 * 3);
    this.colors = new Float32Array(max * 6 * 4);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.colors, 4).setUsage(THREE.DynamicDrawUsage));
    this.geometry = g;
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
    this.last = [null, null, null, null];
    this.dirty = false;
  }

  add(wheel, point, side, intensity) {
    const prev = this.last[wheel];
    const cur = { x: point.x, y: point.y + 0.045, z: point.z, sx: side.x * 0.13, sz: side.z * 0.13, a: intensity };
    this.last[wheel] = cur;
    if (!prev) return;
    const d = Math.hypot(cur.x - prev.x, cur.z - prev.z);
    if (d < 0.08) { this.last[wheel] = prev; return; }
    if (d > 3) return;
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.count = Math.min(this.count + 1, this.max);
    const P = this.positions, C = this.colors;
    const verts = [
      [prev.x - prev.sx, prev.y, prev.z - prev.sz, prev.a], [prev.x + prev.sx, prev.y, prev.z + prev.sz, prev.a], [cur.x - cur.sx, cur.y, cur.z - cur.sz, cur.a],
      [prev.x + prev.sx, prev.y, prev.z + prev.sz, prev.a], [cur.x + cur.sx, cur.y, cur.z + cur.sz, cur.a], [cur.x - cur.sx, cur.y, cur.z - cur.sz, cur.a],
    ];
    verts.forEach((v, k) => {
      const o = (i * 6 + k);
      P[o * 3] = v[0]; P[o * 3 + 1] = v[1]; P[o * 3 + 2] = v[2];
      C[o * 4] = 0.04; C[o * 4 + 1] = 0.04; C[o * 4 + 2] = 0.045; C[o * 4 + 3] = v[3] * 0.6;
    });
    this.dirty = true;
  }

  lift(wheel) { this.last[wheel] = null; }

  clear() {
    this.positions.fill(0); this.colors.fill(0); this.count = 0; this.cursor = 0;
    this.last = [null, null, null, null];
    this.dirty = true;
  }

  update() {
    if (!this.dirty) return;
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
    this.geometry.setDrawRange(0, this.count * 6);
    this.dirty = false;
  }
}

export class Effects {
  constructor(scene, env) {
    this.env = env;
    const tex = softTexture();
    this.smoke = new ParticlePool(scene, 900, { texture: tex });
    this.glow = new ParticlePool(scene, 700, { texture: tex, additive: true });
    this.skids = new SkidMarks(scene);
    this.acc = [0, 0, 0, 0];
    this.dustAcc = 0;
    this.trailAcc = 0;
    this.smokeColor = new THREE.Color(0xe6e6e6);
  }

  setNight(night) { this.smokeColor.setHex(night ? 0x6a6f7a : 0xe8e8e8); }

  resize(h) { this.smoke.material.uniforms.scale.value = h * 0.9; this.glow.material.uniforms.scale.value = h * 0.9; }

  sparks(pos, count = 30, power = 1) {
    for (let i = 0; i < count; i++) {
      _v.set((Math.random() - 0.5) * 12, Math.random() * 7, (Math.random() - 0.5) * 12).multiplyScalar(power);
      this.glow.spawn(pos, _v, { color: Math.random() < 0.5 ? 0xffb347 : 0xffe28a, size: 0.12 + Math.random() * 0.1, life: 0.4 + Math.random() * 0.5, gravity: 14, drag: 1.5, alpha: 1 });
    }
  }

  burst(pos, color = 0xffd54f, count = 40) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * Math.PI - Math.PI / 2;
      _v.set(Math.cos(a) * Math.cos(e), Math.sin(e) + 0.6, Math.sin(a) * Math.cos(e)).multiplyScalar(5 + Math.random() * 5);
      this.glow.spawn(pos, _v, { color, size: 0.25 + Math.random() * 0.25, life: 0.6 + Math.random() * 0.5, drag: 3, gravity: 3 });
    }
  }

  confetti(pos, count = 200) {
    const colors = [0xff1744, 0xffea00, 0x00e676, 0x2979ff, 0xd500f9, 0xffffff];
    for (let i = 0; i < count; i++) {
      _p.set(pos.x + (Math.random() - 0.5) * 6, pos.y + 4 + Math.random() * 3, pos.z + (Math.random() - 0.5) * 6);
      _v.set((Math.random() - 0.5) * 10, 4 + Math.random() * 8, (Math.random() - 0.5) * 10);
      this.smoke.spawn(_p, _v, { color: colors[(Math.random() * colors.length) | 0], size: 0.22, life: 2.5 + Math.random() * 1.5, drag: 1.2, gravity: 4 });
    }
  }

  splash(pos, speed) {
    for (let i = 0; i < 6; i++) {
      _v.set((Math.random() - 0.5) * 6, 3 + Math.random() * 4 * Math.min(speed / 10, 2), (Math.random() - 0.5) * 6);
      this.smoke.spawn(pos, _v, { color: 0xcfe9ff, size: 0.5 + Math.random() * 0.6, life: 0.8, gravity: 9, drag: 1, alpha: 0.7, grow: 1.2 });
    }
  }

  update(dt, car) {
    const right = new THREE.Vector3(-1, 0, 0).applyQuaternion(car.mesh.quaternion);
    const offRoadDist = this.env.trackWidth / 2 + 1.6;
    for (let i = 0; i < 4; i++) {
      const s = car.skid[i];
      const cp = car.contactPoints[i];
      if (car.wheelContact[i] && s > 0.12) {
        this.skids.add(i, cp, right, Math.min(1, s * 1.2));
        this.acc[i] += dt * (8 + 45 * s);
        while (this.acc[i] > 1) {
          this.acc[i] -= 1;
          _p.set(cp.x + (Math.random() - 0.5) * 0.4, cp.y + 0.25, cp.z + (Math.random() - 0.5) * 0.4);
          _v.set(car.velocity.x * 0.15 + (Math.random() - 0.5) * 1.5, 0.6 + Math.random() * 1.2, car.velocity.z * 0.15 + (Math.random() - 0.5) * 1.5);
          this.smoke.spawn(_p, _v, { color: this.smokeColor, size: 0.7 + Math.random() * 0.5, life: 1.3 + Math.random() * 1.0, grow: 2.2, drag: 1.4, gravity: -0.35, alpha: 0.16 * s + 0.04 });
        }
      } else {
        this.skids.lift(i);
      }
    }
    // Off-road dust
    const p = car.mesh.position;
    if (car.onGroundCount > 0 && car.speed > 4) {
      const n = this.env.nearestTrack(p.x, p.z, car.trackIndex ?? -1);
      const onPad = Math.hypot(p.x, p.z) < 58;
      if (n.dist > offRoadDist && !onPad && !car.inWater) {
        this.dustAcc += dt * Math.min(car.speed, 40) * 1.6;
        while (this.dustAcc > 1) {
          this.dustAcc -= 1;
          const w = 2 + ((Math.random() * 2) | 0);
          const cp = car.contactPoints[w];
          _p.set(cp.x, cp.y + 0.2, cp.z);
          _v.set(-car.velocity.x * 0.1 + (Math.random() - 0.5) * 2, 1 + Math.random() * 1.5, -car.velocity.z * 0.1 + (Math.random() - 0.5) * 2);
          this.smoke.spawn(_p, _v, { color: 0xb59a6a, size: 0.8 + Math.random() * 0.7, life: 1.4 + Math.random(), grow: 2.2, drag: 1.6, alpha: 0.35 });
        }
      }
    }
    if (car.inWater && car.speed > 2) this.splash(p, car.speed);
    // Nitro sparkle trail
    if (car.nitroActive) {
      this.trailAcc += dt * 60;
      const back = car.forward.multiplyScalar(-2.6);
      while (this.trailAcc > 1) {
        this.trailAcc -= 1;
        _p.copy(p).add(back);
        _p.y -= 0.3;
        _v.set(car.velocity.x * 0.4 + (Math.random() - 0.5), Math.random() * 0.8, car.velocity.z * 0.4 + (Math.random() - 0.5));
        this.glow.spawn(_p, _v, { color: 0x4f9dff, size: 0.35 + Math.random() * 0.3, life: 0.35, drag: 2, alpha: 0.8 });
      }
    }
    this.smoke.update(dt);
    this.glow.update(dt);
    this.skids.update();
  }
}
