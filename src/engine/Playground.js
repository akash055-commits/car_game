import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32, canvasTexture, speckle } from './utils.js';

/** Island centre — far from the race circuit so the two worlds never meet. */
export const PG = new THREE.Vector3(1600, 0, 0);
const R = 80;          // island radius
const SEA = -1.2;

const PASTEL = [0xff5d8f, 0xffb703, 0x4cc9f0, 0x80ed99, 0xc77dff, 0xff7b00, 0x06d6a0, 0xf72585];

/**
 * The Playground: a bright toy-diorama island with physics toys to smash,
 * car-soccer, a bowling lane, a domino spiral, ramps and hidden stars.
 */
export class Playground {
  constructor(world, physics, env) {
    this.world = world;
    this.scene = world.scene;
    this.pw = physics.world;
    this.env = env;
    this.rng = mulberry32(777);
    this.group = new THREE.Group();
    this.group.visible = false;
    this.scene.add(this.group);
    this.body = this.pw.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.dynamic = [];        // { mesh, body, home:{p,q} }
    this.groundHandles = new Set();
    this.time = 0;
    this.lamps = [];
    this.spinners = [];

    this.buildIsland();
    this.buildSea();
    this.buildTrees();
    this.buildSign();
    this.buildRamps();
    this.buildBowling();
    this.buildSoccer();
    this.buildDominoes();
    this.buildToys();
    this.buildWindmill();
    this.buildLamps();
    this.buildStars();
  }

  w(x, y, z) { return new THREE.Vector3(PG.x + x, PG.y + y, PG.z + z); }

  add(obj, shadow = true) {
    obj.traverse?.((o) => { if (o.isMesh) { o.castShadow = shadow; o.receiveShadow = true; } });
    this.group.add(obj);
    return obj;
  }

  addDynamic(mesh, colliderDesc, pos, { rot = null, damping = 0.2, ccd = false } = {}) {
    mesh.position.copy(pos);
    if (rot) mesh.quaternion.copy(rot);
    this.add(mesh);
    const desc = RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z)
      .setLinearDamping(damping).setAngularDamping(damping + 0.2).setCcdEnabled(ccd);
    if (rot) desc.setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w });
    const body = this.pw.createRigidBody(desc);
    this.pw.createCollider(colliderDesc, body);
    const entry = { mesh, body, home: { p: pos.clone(), q: rot ? rot.clone() : new THREE.Quaternion() } };
    this.dynamic.push(entry);
    return entry;
  }

  // ------------------------------------------------------------ island & sea
  buildIsland() {
    const S = 2048, px = S / (2 * R);
    const toC = (x, z) => [S / 2 + x * px, S / 2 + z * px];
    const tex = canvasTexture(S, S, (ctx) => {
      const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
      g.addColorStop(0, '#7ad957'); g.addColorStop(0.8, '#62c94a'); g.addColorStop(0.9, '#f4dca0'); g.addColorStop(1, '#f1d38c');
      ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
      speckle(ctx, S, S, 30000, ['rgba(70,160,60,0.5)', 'rgba(140,230,110,0.45)', 'rgba(90,190,70,0.5)'], 4);
      // mowing stripes
      ctx.globalAlpha = 0.07; ctx.fillStyle = '#ffffff';
      for (let i = 0; i < S; i += 96) ctx.fillRect(i, 0, 48, S);
      ctx.globalAlpha = 1;
      // paths
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      const path = (pts, w) => {
        ctx.beginPath();
        pts.forEach(([x, z], i) => { const [cx, cy] = toC(x, z); i ? ctx.lineTo(cx, cy) : ctx.moveTo(cx, cy); });
        ctx.strokeStyle = '#e9cf98'; ctx.lineWidth = w * px + 10; ctx.stroke();
        ctx.strokeStyle = '#f6e3b6'; ctx.lineWidth = w * px; ctx.stroke();
      };
      ctx.beginPath(); { const [cx, cy] = toC(0, 0); ctx.arc(cx, cy, 52 * px, 0, Math.PI * 2); }
      ctx.strokeStyle = '#e9cf98'; ctx.lineWidth = 7 * px + 10; ctx.stroke();
      ctx.strokeStyle = '#f6e3b6'; ctx.lineWidth = 7 * px; ctx.stroke();
      path([[0, 0], [34, -8]], 6); path([[0, 0], [-20, -18]], 6); path([[0, 0], [-26, 30]], 6); path([[0, 0], [24, 28]], 6);
      // spawn plaza
      { const [cx, cy] = toC(0, 0); ctx.fillStyle = '#f6e3b6'; ctx.beginPath(); ctx.arc(cx, cy, 10 * px, 0, 7); ctx.fill();
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 6; ctx.setLineDash([24, 18]); ctx.beginPath(); ctx.arc(cx, cy, 8 * px, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
      // bowling lane (x 32..38, z -48..6)
      { const [x0, y0] = toC(31.5, -50); const [x1, y1] = toC(38.5, 6);
        ctx.fillStyle = '#d9a066'; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
        ctx.strokeStyle = 'rgba(120,70,30,0.35)'; ctx.lineWidth = 3;
        for (let x = x0; x < x1; x += 14) { ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke(); }
        ctx.fillStyle = '#7a4a22';
        for (let k = -2; k <= 2; k++) { const [ax, ay] = toC(35 + k * 1.1, -20 - Math.abs(k) * 1.2); ctx.beginPath(); ctx.moveTo(ax, ay - 14); ctx.lineTo(ax + 9, ay + 8); ctx.lineTo(ax - 9, ay + 8); ctx.fill(); } }
      // soccer pitch centred (-36, -22), 42 x 28
      { const [x0, y0] = toC(-57, -36); const [x1, y1] = toC(-15, -8);
        for (let i = 0; i < 8; i++) { ctx.fillStyle = i % 2 ? '#56bf3f' : '#4cb137'; ctx.fillRect(x0 + (x1 - x0) * i / 8, y0, (x1 - x0) / 8 + 1, y1 - y0); }
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 8; ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
        ctx.beginPath(); ctx.moveTo((x0 + x1) / 2, y0); ctx.lineTo((x0 + x1) / 2, y1); ctx.stroke();
        ctx.beginPath(); ctx.arc((x0 + x1) / 2, (y0 + y1) / 2, 5 * px, 0, 7); ctx.stroke(); }
      // flowers
      for (let i = 0; i < 900; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 70;
        const [cx, cy] = toC(Math.cos(a) * r, Math.sin(a) * r);
        ctx.fillStyle = ['#ffffff', '#ffe066', '#ff8fab', '#a0c4ff', '#ffadad'][i % 5];
        ctx.beginPath(); ctx.arc(cx, cy, 3 + Math.random() * 3, 0, 7); ctx.fill();
      }
    });
    tex.anisotropy = this.world.renderer.capabilities.getMaxAnisotropy();
    const top = new THREE.Mesh(new THREE.CircleGeometry(R, 96), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
    top.rotation.x = -Math.PI / 2;
    top.position.copy(this.w(0, 0, 0));
    // CircleGeometry UVs: u follows +x and v follows local +y (= world -z after rotation),
    // which matches the canvas (row 0 = top = v 1 = world -z).
    this.add(top);
    const sideMat = new THREE.MeshStandardMaterial({ color: 0xe8c27a, roughness: 1 });
    const side = new THREE.Mesh(new THREE.CylinderGeometry(R, R - 6, 6, 96, 1, true), sideMat);
    side.position.copy(this.w(0, -3, 0));
    this.add(side, false);
    const col = this.pw.createCollider(RAPIER.ColliderDesc.cylinder(3, R).setTranslation(PG.x, -3, PG.z).setFriction(1.1), this.body);
    this.groundHandles.add(col.handle);
  }

  buildSea() {
    const normal = this.env.waterNormal ? this.env.waterNormal.clone() : null;
    if (normal) { normal.repeat.set(120, 120); normal.needsUpdate = true; }
    this.seaNormal = normal;
    const sea = new THREE.Mesh(new THREE.CircleGeometry(1400, 64), new THREE.MeshStandardMaterial({
      color: 0x16b6d9, roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.92,
      normalMap: normal, normalScale: new THREE.Vector2(0.25, 0.25),
    }));
    sea.rotation.x = -Math.PI / 2;
    sea.position.copy(this.w(0, SEA, 0));
    this.add(sea, false);
    this.foam = new THREE.Mesh(new THREE.RingGeometry(R - 1, R + 3.5, 96), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }));
    this.foam.rotation.x = -Math.PI / 2;
    this.foam.position.copy(this.w(0, SEA + 0.05, 0));
    this.add(this.foam, false);
  }

  // ------------------------------------------------------------ decoration
  buildTrees() {
    const trunk = new THREE.CylinderGeometry(0.25, 0.35, 2.2, 8).translate(0, 1.1, 0);
    const crown = new THREE.SphereGeometry(1.6, 16, 12).translate(0, 3.2, 0);
    const crown2 = new THREE.SphereGeometry(1.1, 14, 10).translate(0.6, 4.3, 0.2);
    const crownGeo = mergeGeometries([crown, crown2]);
    const n = 70;
    const trunks = new THREE.InstancedMesh(trunk, new THREE.MeshStandardMaterial({ color: 0x9c6b3f, roughness: 0.9 }), n);
    const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75 }), n);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3();
    const colors = [0x52b788, 0x74c69d, 0xff8fab, 0xffc8dd, 0x95d5b2, 0xffd166];
    const c = new THREE.Color();
    let k = 0;
    for (let i = 0; i < n * 3 && k < n; i++) {
      const a = this.rng() * Math.PI * 2, r = 58 + this.rng() * 15;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (x > 25 && x < 45 && z > -55 && z < 12) continue;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.rng() * 6);
      m4.compose(v.copy(this.w(x, 0, z)), q, s.setScalar(0.8 + this.rng() * 0.6));
      trunks.setMatrixAt(k, m4); crowns.setMatrixAt(k, m4);
      crowns.setColorAt(k, c.setHex(colors[(this.rng() * colors.length) | 0]));
      this.pw.createCollider(RAPIER.ColliderDesc.cylinder(1.5, 0.4).setTranslation(PG.x + x, 1.5, PG.z + z), this.body);
      k++;
    }
    trunks.count = crowns.count = k;
    this.add(trunks); this.add(crowns);
    // bushes & rocks
    const bush = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.9, 1), new THREE.MeshStandardMaterial({ color: 0x40916c, roughness: 0.8, flatShading: true }), 60);
    let nb = 0;
    for (let i = 0; i < 60; i++) {
      const a = this.rng() * Math.PI * 2, r = 59 + this.rng() * 13;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (x > 25 && x < 45 && z > -55 && z < 12) continue;
      m4.compose(v.copy(this.w(x, 0.3, z)), q.identity(), s.set(1 + this.rng(), 0.7 + this.rng() * 0.4, 1 + this.rng()));
      bush.setMatrixAt(nb++, m4);
    }
    bush.count = nb;
    this.add(bush);
  }

  buildSign() {
    const tex = canvasTexture(1024, 512, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#ff5d8f'); g.addColorStop(0.5, '#ffb703'); g.addColorStop(1, '#4cc9f0');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.beginPath(); ctx.roundRect(28, 28, w - 56, h - 56, 40); ctx.fill();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#1d3557'; ctx.font = '900 128px "Segoe UI", Arial, sans-serif';
      ctx.fillText('PLAYGROUND', w / 2, h / 2 - 60);
      ctx.fillStyle = '#e63946'; ctx.font = '700 54px "Segoe UI", Arial, sans-serif';
      ctx.fillText('smash · score · find the ★', w / 2, h / 2 + 70);
    });
    const sign = new THREE.Group();
    const board = new THREE.Mesh(new RoundedBoxGeometry(12, 6, 0.5, 4, 0.2), [
      new THREE.MeshStandardMaterial({ color: 0xffffff }), new THREE.MeshStandardMaterial({ color: 0xffffff }),
      new THREE.MeshStandardMaterial({ color: 0xffffff }), new THREE.MeshStandardMaterial({ color: 0xffffff }),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }),
    ]);
    board.position.y = 5.5;
    sign.add(board);
    for (const sx of [-4.5, 4.5]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 5), new THREE.MeshStandardMaterial({ color: 0xffffff }));
      post.position.set(sx, 2.5, 0);
      sign.add(post);
    }
    sign.position.copy(this.w(0, 0, 18));
    sign.rotation.y = Math.PI;
    this.add(sign);
    this.signBoard = board;
    for (const sx of [-4.5, 4.5]) this.pw.createCollider(RAPIER.ColliderDesc.cylinder(2.5, 0.35).setTranslation(PG.x - sx, 2.5, PG.z + 18), this.body);
  }

  buildRamps() {
    const tex = canvasTexture(128, 128, (ctx, w, h) => {
      ctx.fillStyle = '#ffb703'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#1d3557';
      for (let i = -2; i < 6; i++) { ctx.beginPath(); ctx.moveTo(i * 32, 0); ctx.lineTo(i * 32 + 16, 0); ctx.lineTo(i * 32 + 16 + h, h); ctx.lineTo(i * 32 + h, h); ctx.fill(); }
    }, { repeat: [2, 2] });
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55 });
    const ramps = [
      { x: 24, z: 30, yaw: Math.PI * 0.25, L: 10, H: 2.6, W: 6 },
      { x: 44, z: 40, yaw: Math.PI * 1.25, L: 7, H: 1.4, W: 6 },
      { x: -8, z: 44, yaw: Math.PI * 0.5, L: 8, H: 2, W: 5 },
      { x: 10, z: -30, yaw: Math.PI, L: 14, H: 4.5, W: 7 },
    ];
    for (const r of ramps) {
      const { mesh, handle } = this.env.addRamp({ ...r, x: PG.x + r.x, z: PG.z + r.z }, mat);
      this.group.attach(mesh);
      this.groundHandles.add(handle);
    }
    // a raised platform reachable from the big ramp, with a star on top
    const plat = new THREE.Mesh(new RoundedBoxGeometry(8, 4.5, 8, 3, 0.3), new THREE.MeshStandardMaterial({ color: 0x4cc9f0, roughness: 0.5 }));
    plat.position.copy(this.w(10, 2.25, -41));
    this.add(plat);
    const c = this.pw.createCollider(RAPIER.ColliderDesc.cuboid(4, 2.25, 4).setTranslation(PG.x + 10, 2.25, PG.z - 41), this.body);
    this.groundHandles.add(c.handle);
  }

  // ------------------------------------------------------------ games
  buildBowling() {
    const pts = [];
    const prof = [[0, 0], [0.16, 0], [0.24, 0.25], [0.27, 0.55], [0.18, 0.9], [0.1, 1.05], [0.12, 1.25], [0.13, 1.38], [0.08, 1.5], [0, 1.53]];
    for (const [x, y] of prof) pts.push(new THREE.Vector2(x * 1.6, y * 1.6));
    const geo = new THREE.LatheGeometry(pts, 20).translate(0, -1.22, 0);
    const tex = canvasTexture(64, 128, (ctx, w, h) => {
      ctx.fillStyle = '#fbfbfb'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#e63946'; ctx.fillRect(0, h * 0.28, w, h * 0.05); ctx.fillRect(0, h * 0.36, w, h * 0.05);
    });
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.25 });
    this.pins = [];
    const rows = [[0], [-0.75, 0.75], [-1.5, 0, 1.5], [-2.25, -0.75, 0.75, 2.25]];
    rows.forEach((row, ri) => row.forEach((x) => {
      const pos = this.w(35 + x, 1.24, -44 - ri * 1.3);
      const e = this.addDynamic(new THREE.Mesh(geo, mat),
        RAPIER.ColliderDesc.cylinder(1.1, 0.36).setDensity(14).setFriction(0.5).setRestitution(0.35), pos, { damping: 0.1 });
      this.pins.push(e);
    }));
    this.pinState = { announced: 0, timer: 0, reset: 0 };
    // back wall
    const wall = new THREE.Mesh(new RoundedBoxGeometry(9, 1.6, 0.8, 3, 0.2), new THREE.MeshStandardMaterial({ color: 0x1d3557 }));
    wall.position.copy(this.w(35, 0.8, -51));
    this.add(wall);
    this.pw.createCollider(RAPIER.ColliderDesc.cuboid(4.5, 0.8, 0.4).setTranslation(PG.x + 35, 0.8, PG.z - 51), this.body);
  }

  buildSoccer() {
    const cx = -36, cz = -22;
    this.soccer = { cx, cz, halfLen: 21, goalHalf: 4, timer: 0 };
    const netMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, side: THREE.DoubleSide, wireframe: false });
    const postMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
    for (const side of [-1, 1]) {
      const g = new THREE.Group();
      const gx = cx + side * 21;
      const d = side * 3;
      for (const pz of [-4, 4]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 3.4), postMat);
        post.position.set(gx, 1.7, cz + pz);
        g.add(post);
        this.pw.createCollider(RAPIER.ColliderDesc.cylinder(1.7, 0.18).setTranslation(PG.x + gx, 1.7, PG.z + cz + pz), this.body);
        const sideNet = new THREE.Mesh(new THREE.PlaneGeometry(3, 3.4), netMat);
        sideNet.position.set(gx + d / 2, 1.7, cz + pz);
        g.add(sideNet);
        this.pw.createCollider(RAPIER.ColliderDesc.cuboid(1.5, 1.7, 0.1).setTranslation(PG.x + gx + d / 2, 1.7, PG.z + cz + pz), this.body);
      }
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 8.4).rotateX(Math.PI / 2), postMat);
      bar.position.set(gx, 3.4, cz);
      g.add(bar);
      const back = new THREE.Mesh(new THREE.PlaneGeometry(8, 3.4), netMat);
      back.position.set(gx + d, 1.7, cz);
      back.rotation.y = Math.PI / 2;
      g.add(back);
      this.pw.createCollider(RAPIER.ColliderDesc.cuboid(0.1, 1.7, 4).setTranslation(PG.x + gx + d, 1.7, PG.z + cz), this.body);
      g.position.copy(PG);
      this.add(g);
    }
    const ballTex = canvasTexture(256, 128, (ctx, w, h) => {
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#1d3557';
      for (let i = 0; i < 12; i++) { ctx.beginPath(); ctx.arc((i % 6) * 44 + 20 + (i > 5 ? 22 : 0), i > 5 ? 90 : 36, 14, 0, 7); ctx.fill(); }
    });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(1.5, 32, 24), new THREE.MeshStandardMaterial({ map: ballTex, roughness: 0.35 }));
    this.ball = this.addDynamic(ball, RAPIER.ColliderDesc.ball(1.5).setDensity(0.6).setRestitution(0.7).setFriction(0.6), this.w(cx, 1.6, cz), { damping: 0.35, ccd: true });
    this.score = { left: 0, right: 0 };
  }

  buildDominoes() {
    const geo = new RoundedBoxGeometry(1.4, 2.4, 0.35, 2, 0.08);
    let k = 0;
    const N = 62;
    for (let i = 0; i < N; i++) {
      const t = i / N;
      const a = t * Math.PI * 3.2;
      const r = 4 + t * 11;
      const x = -26 + Math.cos(a) * r, z = 34 + Math.sin(a) * r;
      const tangentYaw = Math.atan2(-Math.sin(a), Math.cos(a));
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), tangentYaw);
      const mat = new THREE.MeshStandardMaterial({ color: PASTEL[k++ % PASTEL.length], roughness: 0.4 });
      this.addDynamic(new THREE.Mesh(geo, mat), RAPIER.ColliderDesc.cuboid(0.7, 1.2, 0.175).setDensity(3).setFriction(0.6),
        this.w(x, 1.21, z), { rot: q, damping: 0.05 });
    }
  }

  buildToys() {
    // crate towers
    const crateGeo = new RoundedBoxGeometry(1.6, 1.6, 1.6, 3, 0.12);
    const towers = [[-6, -48], [-60, 20], [50, -15]];
    let k = 0;
    for (const [tx, tz] of towers) {
      for (let l = 0; l < 4; l++) for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
        if (l === 3 && (a || b)) continue;
        const mat = new THREE.MeshStandardMaterial({ color: PASTEL[k++ % PASTEL.length], roughness: 0.45 });
        this.addDynamic(new THREE.Mesh(crateGeo, mat), RAPIER.ColliderDesc.cuboid(0.8, 0.8, 0.8).setDensity(1.5).setFriction(0.7),
          this.w(tx + (l === 3 ? 0.8 : a * 1.62), 0.81 + l * 1.61, tz + (l === 3 ? 0.8 : b * 1.62)));
      }
    }
    // beach balls
    const bb = canvasTexture(256, 128, (ctx, w, h) => {
      const cols = ['#ff5d8f', '#ffffff', '#ffb703', '#ffffff', '#4cc9f0', '#ffffff'];
      cols.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(i * w / 6, 0, w / 6 + 1, h); });
    });
    const ballMat = new THREE.MeshStandardMaterial({ map: bb, roughness: 0.3 });
    for (let i = 0; i < 10; i++) {
      const a = this.rng() * Math.PI * 2, r = 15 + this.rng() * 40;
      this.addDynamic(new THREE.Mesh(new THREE.SphereGeometry(0.8, 24, 16), ballMat),
        RAPIER.ColliderDesc.ball(0.8).setDensity(0.15).setRestitution(0.85), this.w(Math.cos(a) * r, 0.85, Math.sin(a) * r), { damping: 0.25 });
    }
    // traffic cones around the plaza
    const coneGeo = new THREE.ConeGeometry(0.35, 1.0, 16).translate(0, 0, 0);
    const coneMat = new THREE.MeshStandardMaterial({ color: 0xff7b00, roughness: 0.5 });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      this.addDynamic(new THREE.Mesh(coneGeo, coneMat), RAPIER.ColliderDesc.cone(0.5, 0.35).setDensity(5),
        this.w(Math.cos(a) * 12, 0.52, Math.sin(a) * 12));
    }
  }

  buildWindmill() {
    const g = new THREE.Group();
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 2.2, 12, 12), new THREE.MeshStandardMaterial({ color: 0xfff1e6 }));
    tower.position.y = 6;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(2, 2.5, 12), new THREE.MeshStandardMaterial({ color: 0xe63946 }));
    cap.position.y = 13.2;
    g.add(tower, cap);
    const blades = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Mesh(new RoundedBoxGeometry(0.9, 6, 0.15, 2, 0.06), new THREE.MeshStandardMaterial({ color: i % 2 ? 0xffb703 : 0xffffff }));
      b.position.y = 3.2;
      const holder = new THREE.Group();
      holder.rotation.z = (i / 4) * Math.PI * 2;
      holder.add(b);
      blades.add(holder);
    }
    blades.position.set(0, 11.5, 2.3);
    g.add(blades);
    g.position.copy(this.w(-48, 0, 46));
    g.rotation.y = Math.PI * 0.75;
    this.add(g);
    this.spinners.push({ obj: blades, axis: 'z', speed: 0.8 });
    this.pw.createCollider(RAPIER.ColliderDesc.cylinder(6, 2.0).setTranslation(PG.x - 48, 6, PG.z + 46), this.body);
    // balloons
    this.balloons = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.9, 20, 16).scale(1, 1.2, 1), new THREE.MeshStandardMaterial({ color: PASTEL[i], roughness: 0.25 }));
      const base = this.w(Math.cos(a) * 30, 9 + (i % 3) * 2, Math.sin(a) * 30);
      m.position.copy(base);
      this.add(m, true);
      this.balloons.push({ m, base, ph: i * 1.3 });
    }
  }

  buildLamps() {
    const postMat = new THREE.MeshStandardMaterial({ color: 0x1d3557, roughness: 0.5 });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.2;
      const x = Math.cos(a) * 56.5, z = Math.sin(a) * 56.5;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 4.5), postMat);
      post.position.copy(this.w(x, 2.25, z));
      const bulbMat = new THREE.MeshStandardMaterial({ color: 0xfff3c4, emissive: 0xffd27a, emissiveIntensity: 0.2 });
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 12), bulbMat);
      bulb.position.copy(this.w(x, 4.7, z));
      this.add(post); this.add(bulb, false);
      const light = i % 2 === 0 ? new THREE.PointLight(0xffc870, 0, 22, 1.6) : null;
      if (light) { light.position.copy(this.w(x, 4.4, z)); this.group.add(light); }
      this.lamps.push({ bulbMat, light });
      this.pw.createCollider(RAPIER.ColliderDesc.cylinder(2.25, 0.16).setTranslation(PG.x + x, 2.25, PG.z + z), this.body);
    }
  }

  setNight(night) {
    for (const l of this.lamps) {
      l.bulbMat.emissiveIntensity = night ? 6 : 0.2;
      if (l.light) l.light.intensity = night ? 60 : 0;
    }
  }

  buildStars() {
    const shape = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 0.45 : 1.0, a = (i / 10) * Math.PI * 2 + Math.PI / 2;
      i ? shape.lineTo(Math.cos(a) * r, Math.sin(a) * r) : shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.3, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.08, bevelSegments: 2 }).center();
    const mat = new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0xffa400, emissiveIntensity: 1.2, metalness: 0.4, roughness: 0.25 });
    const spots = [[10, 6.2, -41], [-36, 1.6, -38], [46, 1.6, -48], [-26, 1.6, 34], [66, 1.6, 10], [-62, 1.6, -10], [24, 6.5, 33]];
    this.stars = spots.map(([x, y, z]) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(this.w(x, y, z));
      this.add(m, false);
      return { m, base: m.position.clone(), got: false };
    });
    this.starsFound = 0;
  }

  // ------------------------------------------------------------ runtime
  setVisible(v) { this.group.visible = v; }

  surfaceAt(x, z) {
    const lx = x - PG.x, lz = z - PG.z;
    const r = Math.hypot(lx, lz);
    return r > 70 ? 'sand' : 'grass';
  }

  spawn() { return { pos: this.w(0, 1.2, 4), yaw: 0 }; }

  reset() {
    for (const e of this.dynamic) {
      e.body.setTranslation(e.home.p, true);
      e.body.setRotation({ x: e.home.q.x, y: e.home.q.y, z: e.home.q.z, w: e.home.q.w }, true);
      e.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      e.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    this.stars.forEach((s) => { s.got = false; s.m.visible = true; });
    this.starsFound = 0;
    this.pinState = { announced: 0, timer: 0, reset: 0 };
    this.score = { left: 0, right: 0 };
  }

  resetPins() {
    for (const e of this.pins) {
      e.body.setTranslation(e.home.p, true);
      e.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      e.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      e.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
  }

  /** Returns events for the game layer to turn into popups/sounds. */
  update(dt, car) {
    this.time += dt;
    const events = [];
    const t = this.time;
    // sync physics toys
    for (const e of this.dynamic) {
      if (e.body.isSleeping()) continue;
      const p = e.body.translation(), q = e.body.rotation();
      e.mesh.position.set(p.x, p.y, p.z);
      e.mesh.quaternion.set(q.x, q.y, q.z, q.w);
      if (p.y < -20) { e.body.setTranslation(e.home.p, true); e.body.setLinvel({ x: 0, y: 0, z: 0 }, true); }
    }
    for (const s of this.spinners) s.obj.rotation[s.axis] += s.speed * dt;
    for (const b of this.balloons) { b.m.position.y = b.base.y + Math.sin(t * 1.2 + b.ph) * 0.6; b.m.rotation.y = Math.sin(t * 0.7 + b.ph) * 0.3; }
    if (this.seaNormal) this.seaNormal.offset.set(t * 0.008, t * 0.005);
    this.foam.material.opacity = 0.4 + Math.sin(t * 1.5) * 0.15;
    this.foam.scale.setScalar(1 + Math.sin(t * 1.5) * 0.006);

    // stars
    const cp = car.mesh.position;
    for (const s of this.stars) {
      if (s.got) continue;
      s.m.rotation.y = t * 2;
      s.m.position.y = s.base.y + Math.sin(t * 2.5 + s.base.x) * 0.3;
      if (s.m.position.distanceToSquared(cp) < 3.2 * 3.2) {
        s.got = true; s.m.visible = false; this.starsFound++;
        events.push({ type: 'star', pos: s.m.position.clone(), found: this.starsFound, total: this.stars.length });
      }
    }

    // bowling: count pins knocked over
    const ps = this.pinState;
    let down = 0;
    const up = new THREE.Vector3();
    for (const e of this.pins) {
      const q = e.body.rotation();
      up.set(0, 1, 0).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
      if (up.y < 0.7 || e.body.translation().y < 0.5) down++;
    }
    if (down > ps.announced) { ps.timer = 1.4; ps.pending = down; }
    if (ps.timer > 0) {
      ps.timer -= dt;
      if (ps.timer <= 0) {
        const n = Math.max(down, ps.pending || 0);
        if (n > ps.announced) {
          events.push({ type: 'pins', count: n, strike: n === 10 && ps.announced === 0, pos: this.w(35, 2, -46) });
          ps.announced = n;
          ps.reset = 6;
        }
      }
    }
    if (ps.reset > 0) { ps.reset -= dt; if (ps.reset <= 0) { this.resetPins(); ps.announced = 0; } }

    // soccer goals
    const so = this.soccer;
    if (so.timer > 0) {
      so.timer -= dt;
      if (so.timer <= 0) {
        this.ball.body.setTranslation(this.w(so.cx, 3, so.cz), true);
        this.ball.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        this.ball.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
    } else {
      const b = this.ball.body.translation();
      const lx = b.x - PG.x - so.cx, lz = b.z - PG.z - so.cz;
      if (Math.abs(lx) > so.halfLen + 0.8 && Math.abs(lx) < so.halfLen + 3.2 && Math.abs(lz) < so.goalHalf && b.y < 3.4) {
        if (lx > 0) this.score.right++; else this.score.left++;
        events.push({ type: 'goal', pos: new THREE.Vector3(b.x, b.y, b.z), score: this.score });
        so.timer = 2.2;
      }
    }

    // car fell into the sea
    if (cp.y < SEA - 0.6) events.push({ type: 'splash', pos: cp.clone() });
    return events;
  }
}
