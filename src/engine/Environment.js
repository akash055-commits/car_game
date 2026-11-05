import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clamp, smoothstep, fbm, mulberry32, canvasTexture, speckle } from './utils.js';

const SIZE = 800;
const SEG = 160;
const CELL = SIZE / SEG;
export const WATER_LEVEL = -1.6;

const TRACK_POINTS = [
  [0, -150], [90, -152], [150, -115], [172, -45], [128, 8], [150, 72], [122, 140],
  [42, 162], [-18, 118], [-62, 150], [-132, 140], [-172, 70], [-138, 2], [-170, -72], [-118, -140],
];

/** Patch a material so instanced foliage sways in the wind. */
function addWind(material, uniforms, strength = 0.08, minY = 0.6) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          float ph = instanceMatrix[3].x * 0.07 + instanceMatrix[3].z * 0.05;
        #else
          float ph = 0.0;
        #endif
        float h = max(transformed.y - ${minY.toFixed(2)}, 0.0);
        float sway = (sin(uTime * 1.7 + ph) * 0.7 + sin(uTime * 3.1 + ph * 1.7) * 0.3) * ${strength.toFixed(3)} * h;
        transformed.x += sway;
        transformed.z += sway * 0.6;`);
  };
  return material;
}

export class Environment {
  constructor(world, physics, quality) {
    this.world = world;
    this.scene = world.scene;
    this.physics = physics;
    this.pw = physics.world;
    this.quality = quality;
    this.rng = mulberry32(20261105);
    this.trackWidth = 14;
    this.wind = { uTime: { value: 0 } };
    this.dynamicProps = [];
    this.staticBody = this.pw.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.groundHandles = new Set();

    this.buildTrack();
    this.buildHeightGrid();
    this.buildTerrain();
    this.buildWater();
    this.buildRoad();
    this.buildKerbsAndBarriers();
    this.buildStartLine();
    this.buildGrandstand();
    this.buildTrees();
    this.buildGrass();
    this.buildRocks();
    this.buildStuntPark();
    this.buildProps();
    this.buildBounds();
  }

  // ---------------------------------------------------------------- TRACK
  buildTrack() {
    const pts = TRACK_POINTS.map(([x, z]) => new THREE.Vector3(x, 0, z));
    this.curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    this.length = this.curve.getLength();
    const N = 640;
    this.N = N;
    this.samples = this.curve.getSpacedPoints(N).slice(0, N);
    this.tangents = [];
    this.rights = [];
    for (let i = 0; i < N; i++) {
      const t = this.curve.getTangentAt(i / N).setY(0).normalize();
      this.tangents.push(t);
      this.rights.push(new THREE.Vector3(-t.z, 0, t.x)); // points to the right of travel direction
    }
    this.curvature = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = this.tangents[(i - 4 + N) % N], b = this.tangents[(i + 4) % N];
      const cross = a.x * b.z - a.z * b.x;
      this.curvature[i] = cross; // sign = turning direction
    }
    this.sampleSpacing = this.length / N;
  }

  /** Nearest track sample. Uses a windowed search around `hint` when given. */
  nearestTrack(x, z, hint = -1) {
    let best = -1, bestD = Infinity;
    const N = this.N;
    if (hint >= 0) {
      for (let k = -30; k <= 30; k++) {
        const i = (hint + k + N) % N;
        const p = this.samples[i];
        const d = (p.x - x) ** 2 + (p.z - z) ** 2;
        if (d < bestD) { bestD = d; best = i; }
      }
      if (bestD < 60 * 60) return { index: best, dist: Math.sqrt(bestD) };
    }
    for (let i = 0; i < N; i++) {
      const p = this.samples[i];
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    return { index: best, dist: Math.sqrt(bestD) };
  }

  trackDistance(x, z) {
    let bestD = Infinity;
    for (let i = 0; i < this.N; i += 2) {
      const p = this.samples[i];
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < bestD) bestD = d;
    }
    return Math.sqrt(bestD);
  }

  // ---------------------------------------------------------------- TERRAIN
  rawHeight(x, z, dTrack) {
    const W = this.trackWidth;
    const r = Math.hypot(x, z);
    let hills = fbm(x / 150, z / 150, 5) * 16 + fbm(x / 38 + 11, z / 38 - 4, 3) * 2.2;
    const roadFlat = smoothstep(W / 2 + 10, W / 2 + 65, dTrack);
    const parkFlat = smoothstep(62, 105, r);
    const edge = smoothstep(240, 390, Math.max(Math.abs(x), Math.abs(z)));
    return hills * roadFlat * parkFlat + edge * (55 + fbm(x / 70, z / 70, 4) * 40);
  }

  buildHeightGrid() {
    const n = SEG + 1;
    this.heights = new Float32Array(n * n);
    this.trackDist = new Float32Array(n * n);
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const x = -SIZE / 2 + ix * CELL, z = -SIZE / 2 + iz * CELL;
        const d = this.trackDistance(x, z);
        this.trackDist[iz * n + ix] = d;
        this.heights[iz * n + ix] = this.rawHeight(x, z, d);
      }
    }
  }

  heightAt(x, z) {
    const n = SEG + 1;
    const fx = clamp((x + SIZE / 2) / CELL, 0, SEG - 0.001);
    const fz = clamp((z + SIZE / 2) / CELL, 0, SEG - 0.001);
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const tx = fx - ix, tz = fz - iz;
    const h = this.heights;
    const a = h[iz * n + ix], b = h[iz * n + ix + 1], c = h[(iz + 1) * n + ix], d = h[(iz + 1) * n + ix + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }

  buildTerrain() {
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, this.heights[i]);
    geo.computeVertexNormals();

    const colors = new Float32Array(pos.count * 3);
    const nrm = geo.attributes.normal;
    const grassA = new THREE.Color(0x3a8a26), grassB = new THREE.Color(0x63ad30), dry = new THREE.Color(0x9aa33e);
    const rock = new THREE.Color(0x76705f), snow = new THREE.Color(0xf2f4f7), sand = new THREE.Color(0xc9b98a);
    const shoulder = new THREE.Color(0x5d6b3a);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const ny = nrm.getY(i);
      const n1 = fbm(x / 25, z / 25, 3) * 0.5 + 0.5;
      c.copy(grassA).lerp(grassB, n1);
      c.lerp(dry, smoothstep(0.55, 0.9, fbm(x / 90 + 50, z / 90, 3) * 0.5 + 0.5) * 0.6);
      const d = this.trackDist[i];
      if (d < this.trackWidth / 2 + 4) c.lerp(shoulder, 0.6);
      c.lerp(rock, smoothstep(0.88, 0.7, ny));
      c.lerp(rock, smoothstep(22, 38, y) * 0.8);
      c.lerp(snow, smoothstep(62, 80, y));
      c.lerp(sand, smoothstep(WATER_LEVEL + 0.9, WATER_LEVEL - 0.2, y));
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const detail = canvasTexture(256, 256, (ctx, w, h) => {
      ctx.fillStyle = '#d8d8d8';
      ctx.fillRect(0, 0, w, h);
      speckle(ctx, w, h, 9000, ['#bdbdbd', '#ececec', '#a9a9a9', '#f6f6f6', '#c8c8c8'], 2.5);
    }, { repeat: [140, 140] });

    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: detail, roughness: 0.96, metalness: 0 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.terrain = mesh;

    const verts = new Float32Array(pos.array);
    const idx = new Uint32Array(geo.index.array);
    const col = this.pw.createCollider(RAPIER.ColliderDesc.trimesh(verts, idx).setFriction(1.0), this.staticBody);
    this.groundHandles.add(col.handle);
  }

  buildWater() {
    const normalTex = canvasTexture(256, 256, (ctx, w, h) => {
      const img = ctx.createImageData(w, h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const f = (u, v) => Math.sin(u * 0.15 + Math.sin(v * 0.08) * 2) + Math.sin(v * 0.12 + u * 0.05) * 0.8;
        const dx = f(x + 1, y) - f(x - 1, y), dy = f(x, y + 1) - f(x, y - 1);
        const i = (y * w + x) * 4;
        img.data[i] = 128 + dx * 40; img.data[i + 1] = 128 + dy * 40; img.data[i + 2] = 255; img.data[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    }, { repeat: [40, 40], srgb: false });
    this.waterNormal = normalTex;
    const mat = new THREE.MeshStandardMaterial({
      color: 0x1d5670, roughness: 0.06, metalness: 0.3, transparent: true, opacity: 0.86,
      normalMap: normalTex, normalScale: new THREE.Vector2(0.35, 0.35),
    });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE), mat);
    water.rotation.x = -Math.PI / 2;
    water.position.y = WATER_LEVEL;
    water.receiveShadow = true;
    this.scene.add(water);
  }

  // ---------------------------------------------------------------- ROAD
  ribbon(offsetA, offsetB, y, indicesFilter, vScale) {
    const N = this.N;
    const positions = [], uvs = [], normals = [], indices = [];
    let dist = 0;
    for (let i = 0; i <= N; i++) {
      const k = i % N;
      const p = this.samples[k], r = this.rights[k];
      positions.push(p.x + r.x * offsetA, y, p.z + r.z * offsetA, p.x + r.x * offsetB, y, p.z + r.z * offsetB);
      normals.push(0, 1, 0, 0, 1, 0);
      uvs.push(0, dist / vScale, 1, dist / vScale);
      dist += this.sampleSpacing;
    }
    for (let i = 0; i < N; i++) {
      if (indicesFilter && !indicesFilter(i)) continue;
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      indices.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(indices);
    // Ensure front faces point up
    g.computeVertexNormals();
    if (g.attributes.normal.getY(0) < 0) {
      const ix = g.index.array;
      for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
      g.computeVertexNormals();
    }
    return g;
  }

  buildRoad() {
    const W = this.trackWidth;
    const asphalt = canvasTexture(512, 512, (ctx, w, h) => {
      ctx.fillStyle = '#3b3d40';
      ctx.fillRect(0, 0, w, h);
      speckle(ctx, w, h, 26000, ['#2f3134', '#45474b', '#505357', '#36383b', '#5a5c60'], 2);
      // tyre-worn racing line darkening
      const grd = ctx.createLinearGradient(0, 0, w, 0);
      grd.addColorStop(0, 'rgba(0,0,0,0)');
      grd.addColorStop(0.3, 'rgba(0,0,0,0.14)');
      grd.addColorStop(0.7, 'rgba(0,0,0,0.14)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, w, h);
      // cracks
      ctx.strokeStyle = 'rgba(20,20,22,0.5)';
      for (let i = 0; i < 8; i++) {
        ctx.beginPath();
        let x = Math.random() * w, y = Math.random() * h;
        ctx.moveTo(x, y);
        for (let k = 0; k < 6; k++) { x += (Math.random() - 0.5) * 40; y += Math.random() * 30; ctx.lineTo(x, y); }
        ctx.stroke();
      }
      ctx.fillStyle = '#e9e9e4';
      ctx.fillRect(14, 0, 11, h);
      ctx.fillRect(w - 25, 0, 11, h);
      ctx.fillStyle = '#e6e6df';
      ctx.fillRect(w / 2 - 5, 0, 10, h * 0.45);
    });
    asphalt.wrapS = THREE.ClampToEdgeWrapping;
    asphalt.wrapT = THREE.RepeatWrapping;
    asphalt.anisotropy = this.world.renderer.capabilities.getMaxAnisotropy();
    const mat = new THREE.MeshStandardMaterial({
      map: asphalt, roughness: 0.82, metalness: 0.0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const road = new THREE.Mesh(this.ribbon(-W / 2, W / 2, 0.035, null, W), mat);
    road.receiveShadow = true;
    this.scene.add(road);
  }

  buildKerbsAndBarriers() {
    const W = this.trackWidth;
    const kerbTex = canvasTexture(32, 64, (ctx, w, h) => {
      ctx.fillStyle = '#d42020'; ctx.fillRect(0, 0, w, h / 2);
      ctx.fillStyle = '#f4f4f4'; ctx.fillRect(0, h / 2, w, h / 2);
    });
    kerbTex.wrapT = THREE.RepeatWrapping;
    const kerbMat = new THREE.MeshStandardMaterial({
      map: kerbTex, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    });
    const isCorner = (i) => Math.abs(this.curvature[i]) > 0.05;
    for (const side of [-1, 1]) {
      const a = side * (W / 2 - 0.2), b = side * (W / 2 + 1.3);
      const m = new THREE.Mesh(this.ribbon(Math.min(a, b), Math.max(a, b), 0.05, isCorner, 3.0), kerbMat);
      m.receiveShadow = true;
      this.scene.add(m);
    }

    // Armco barriers on the outside of tight corners, tyre stacks on the apex
    const rail = new THREE.BoxGeometry(0.15, 0.32, 1);
    rail.translate(0, 0.75, 0);
    const post = new THREE.BoxGeometry(0.12, 0.8, 0.12);
    post.translate(0.1, 0.4, -0.45);
    const barrierGeo = mergeGeometries([rail, post]);
    const barrierMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.55, roughness: 0.45 });
    const list = [];
    const step = 3;
    for (let i = 0; i < this.N; i += step) {
      const cv = this.curvature[i];
      if (Math.abs(cv) < 0.09) continue;
      const outside = cv > 0 ? -1 : 1; // turning direction flips which side is outside
      const p = this.samples[i], r = this.rights[i], t = this.tangents[i];
      const off = outside * (W / 2 + 7);
      list.push({ x: p.x + r.x * off, z: p.z + r.z * off, yaw: Math.atan2(t.x, t.z), len: this.sampleSpacing * step + 0.15 });
    }
    const inst = new THREE.InstancedMesh(barrierGeo, barrierMat, list.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3();
    list.forEach((b, i) => {
      const y = this.heightAt(b.x, b.z);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.yaw);
      m4.compose(v.set(b.x, y, b.z), q, s.set(1, 1, b.len));
      inst.setMatrixAt(i, m4);
      this.pw.createCollider(
        RAPIER.ColliderDesc.cuboid(0.12, 0.6, b.len / 2).setTranslation(b.x, y + 0.6, b.z)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setFriction(0.2).setRestitution(0.2),
        this.staticBody);
    });
    inst.castShadow = true; inst.receiveShadow = true;
    this.scene.add(inst);
  }

  buildStartLine() {
    const W = this.trackWidth;
    const p = this.samples[0], t = this.tangents[0], r = this.rights[0];
    const yaw = Math.atan2(t.x, t.z);
    this.startPos = p.clone();
    this.startYaw = yaw;

    const checker = canvasTexture(256, 32, (ctx, w, h) => {
      const s = 16;
      for (let y = 0; y < h / s; y++) for (let x = 0; x < w / s; x++) {
        ctx.fillStyle = (x + y) % 2 ? '#111' : '#f5f5f5';
        ctx.fillRect(x * s, y * s, s, s);
      }
    });
    const line = new THREE.Mesh(new THREE.PlaneGeometry(W, 1.75),
      new THREE.MeshStandardMaterial({ map: checker, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    line.rotation.x = -Math.PI / 2;
    line.rotation.z = yaw + Math.PI / 2;
    line.position.set(p.x, 0.04, p.z);
    line.receiveShadow = true;
    this.scene.add(line);

    // Grid boxes
    const gridMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    for (let k = 1; k <= 4; k++) {
      const side = k % 2 ? -1 : 1;
      const back = -k * 7 - 2;
      const g = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.25), gridMat);
      g.rotation.x = -Math.PI / 2; g.rotation.z = yaw + Math.PI / 2;
      g.position.set(p.x + t.x * back + r.x * side * 3.2, 0.045, p.z + t.z * back + r.z * side * 3.2);
      this.scene.add(g);
    }

    const gantry = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0x2a2e35, metalness: 0.7, roughness: 0.35 });
    const pillarGeo = new THREE.BoxGeometry(0.8, 7.5, 0.8);
    for (const side of [-1, 1]) {
      const pl = new THREE.Mesh(pillarGeo, metal);
      pl.position.set(side * (W / 2 + 1.6), 3.75, 0);
      pl.castShadow = true;
      gantry.add(pl);
    }
    const banner = canvasTexture(1024, 128, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, '#ff3d00'); g.addColorStop(0.5, '#ff9100'); g.addColorStop(1, '#ff3d00');
      ctx.fillStyle = '#101218'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = g; ctx.fillRect(0, 8, w, 6); ctx.fillRect(0, h - 14, w, 6);
      ctx.font = 'italic 900 76px "Segoe UI", Arial, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';
      ctx.fillText('VELOCITY  RUSH', w / 2, h / 2 + 4);
    });
    const beam = new THREE.Mesh(new THREE.BoxGeometry(W + 4, 1.6, 0.6), [
      metal, metal, metal, metal,
      new THREE.MeshStandardMaterial({ map: banner, emissive: 0xffffff, emissiveMap: banner, emissiveIntensity: 0.4 }),
      new THREE.MeshStandardMaterial({ map: banner, emissive: 0xffffff, emissiveMap: banner, emissiveIntensity: 0.4 }),
    ]);
    beam.position.y = 7.2;
    beam.castShadow = true;
    gantry.add(beam);

    this.startLights = [];
    const lightGeo = new THREE.SphereGeometry(0.28, 16, 12);
    for (let i = 0; i < 5; i++) {
      const mat = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff0000, emissiveIntensity: 0 });
      const l = new THREE.Mesh(lightGeo, mat);
      l.position.set((i - 2) * 1.0, 6.0, -0.35);
      gantry.add(l);
      this.startLights.push(mat);
    }
    gantry.position.copy(p);
    gantry.rotation.y = yaw;
    this.scene.add(gantry);
    for (const side of [-1, 1]) {
      const x = p.x + r.x * side * (W / 2 + 1.6), z = p.z + r.z * side * (W / 2 + 1.6);
      this.pw.createCollider(RAPIER.ColliderDesc.cuboid(0.4, 3.75, 0.4).setTranslation(x, 3.75, z), this.staticBody);
    }
  }

  /** n = number of red lights lit (0..5); green = true lights all green. */
  setStartLights(n, green = false) {
    this.startLights.forEach((m, i) => {
      if (green) { m.emissive.setHex(0x00ff55); m.emissiveIntensity = 6; }
      else { m.emissive.setHex(0xff1500); m.emissiveIntensity = i < n ? 7 : 0; }
    });
  }

  buildGrandstand() {
    const W = this.trackWidth;
    const idx = 12;
    const p = this.samples[idx], r = this.rights[idx], t = this.tangents[idx];
    const off = -(W / 2 + 14);
    const base = new THREE.Vector3(p.x + r.x * off, 0, p.z + r.z * off);
    const group = new THREE.Group();
    const concrete = new THREE.MeshStandardMaterial({ color: 0x9a9ea6, roughness: 0.9 });
    const tiers = 6, length = 46;
    for (let i = 0; i < tiers; i++) {
      const tier = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.7 * (i + 1), length), concrete);
      tier.position.set(-i * 1.4, 0.35 * (i + 1), 0);
      tier.castShadow = true; tier.receiveShadow = true;
      group.add(tier);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(10, 0.3, length + 2),
      new THREE.MeshStandardMaterial({ color: 0xe8462e, roughness: 0.5, metalness: 0.2 }));
    roof.position.set(-3.5, 8.2, 0);
    roof.rotation.z = -0.08;
    roof.castShadow = true;
    group.add(roof);
    for (let k = -2; k <= 2; k++) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 8.2), concrete);
      col.position.set(-8, 4.1, k * (length / 4.2));
      group.add(col);
    }
    // Crowd
    const count = 520;
    const personGeo = mergeGeometries([
      new THREE.BoxGeometry(0.42, 0.62, 0.3).translate(0, 0.31, 0),
      new THREE.SphereGeometry(0.15, 8, 6).translate(0, 0.78, 0),
    ]);
    const crowd = new THREE.InstancedMesh(personGeo, new THREE.MeshStandardMaterial({ roughness: 0.8 }), count);
    const palette = [0xe53935, 0x1e88e5, 0xfdd835, 0x43a047, 0xffffff, 0xff7043, 0x8e24aa, 0x212121];
    this.crowdData = [];
    const color = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const tier = (this.rng() * tiers) | 0;
      const x = -tier * 1.4 + (this.rng() - 0.5) * 0.4;
      const y = 0.7 * (tier + 1);
      const z = (this.rng() - 0.5) * (length - 2);
      this.crowdData.push({ x, y, z, ph: this.rng() * 10, sp: 6 + this.rng() * 5 });
      crowd.setColorAt(i, color.setHex(palette[(this.rng() * palette.length) | 0]));
    }
    this.crowd = crowd;
    this.crowdExcite = 0.3;
    group.add(crowd);
    group.position.copy(base);
    // orient tiers so they face the track (local +x toward the road)
    group.rotation.y = Math.atan2(-r.z, r.x);
    this.scene.add(group);
    this.grandstand = group;
    this.updateCrowd(0);
    group.updateMatrixWorld(true);
    const q = new THREE.Quaternion().setFromEuler(group.rotation);
    const center = new THREE.Vector3(-3.5, 2.2, 0).applyQuaternion(q).add(base);
    this.pw.createCollider(RAPIER.ColliderDesc.cuboid(4.5, 2.2, length / 2).setTranslation(center.x, center.y, center.z)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }), this.staticBody);
  }

  updateCrowd(time) {
    if (!this.crowd) return;
    const m4 = new THREE.Matrix4();
    const ex = this.crowdExcite;
    for (let i = 0; i < this.crowdData.length; i++) {
      const c = this.crowdData[i];
      const jump = Math.max(0, Math.sin(time * c.sp + c.ph)) * 0.35 * ex;
      m4.makeTranslation(c.x, c.y + jump, c.z);
      this.crowd.setMatrixAt(i, m4);
    }
    this.crowd.instanceMatrix.needsUpdate = true;
  }

  // ---------------------------------------------------------------- NATURE
  randomSpot(minTrack, minPark, maxH = 40, range = 370) {
    for (let tries = 0; tries < 50; tries++) {
      const x = (this.rng() - 0.5) * 2 * range, z = (this.rng() - 0.5) * 2 * range;
      if (Math.hypot(x, z) < minPark) continue;
      const h = this.heightAt(x, z);
      if (h < WATER_LEVEL + 0.4 || h > maxH) continue;
      if (this.trackDistance(x, z) < minTrack) continue;
      return { x, z, h };
    }
    return null;
  }

  buildTrees() {
    const count = this.quality.trees;
    const pineFoliage = mergeGeometries([
      new THREE.ConeGeometry(1.9, 3.2, 9).translate(0, 2.9, 0),
      new THREE.ConeGeometry(1.5, 2.8, 9).translate(0, 4.4, 0),
      new THREE.ConeGeometry(1.0, 2.4, 9).translate(0, 5.8, 0),
    ]);
    const broad = new THREE.IcosahedronGeometry(2.2, 2);
    {
      const p = broad.attributes.position;
      const v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        const n = 1 + (Math.sin(v.x * 2.1) * Math.cos(v.y * 1.7) * Math.sin(v.z * 2.3)) * 0.18;
        v.multiplyScalar(n);
        v.y *= 0.85;
        p.setXYZ(i, v.x, v.y, v.z);
      }
      broad.computeVertexNormals();
      broad.translate(0, 4.0, 0);
    }
    const trunkGeo = new THREE.CylinderGeometry(0.18, 0.32, 3, 7).translate(0, 1.5, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5b4030, roughness: 1 });
    const pineMat = addWind(new THREE.MeshStandardMaterial({ color: 0x23683a, roughness: 0.9 }), this.wind, 0.025, 1.5);
    const broadMat = addWind(new THREE.MeshStandardMaterial({ color: 0x4f9a2a, roughness: 0.85 }), this.wind, 0.03, 2.0);

    const pines = [], broads = [];
    for (let i = 0; i < count; i++) {
      const s = this.randomSpot(this.trackWidth / 2 + 13, 80, 34);
      if (!s) continue;
      (this.rng() < 0.55 ? pines : broads).push({ ...s, scale: 0.75 + this.rng() * 0.8, rot: this.rng() * Math.PI * 2 });
    }
    const all = [...pines, ...broads];
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, all.length);
    const pineMesh = new THREE.InstancedMesh(pineFoliage, pineMat, pines.length);
    const broadMesh = new THREE.InstancedMesh(broad, broadMat, broads.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    const col = new THREE.Color();
    all.forEach((t, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.rot);
      m4.compose(v.set(t.x, t.h - 0.2, t.z), q, sc.setScalar(t.scale));
      trunks.setMatrixAt(i, m4);
      if (i < pines.length) {
        pineMesh.setMatrixAt(i, m4);
        pineMesh.setColorAt(i, col.setHSL(0.3 + this.rng() * 0.05, 0.45, 0.75 + this.rng() * 0.3));
      } else {
        broadMesh.setMatrixAt(i - pines.length, m4);
        broadMesh.setColorAt(i - pines.length, col.setHSL(0.2 + this.rng() * 0.12, 0.5, 0.75 + this.rng() * 0.35));
      }
      this.pw.createCollider(RAPIER.ColliderDesc.cylinder(1.5, 0.3 * t.scale).setTranslation(t.x, t.h + 1.3, t.z), this.staticBody);
    });
    for (const m of [trunks, pineMesh, broadMesh]) { m.castShadow = true; m.receiveShadow = true; this.scene.add(m); }
  }

  buildGrass() {
    const count = this.quality.grass;
    const blades = [];
    for (let k = 0; k < 5; k++) {
      const b = new THREE.PlaneGeometry(0.09, 0.6, 1, 3);
      const p = b.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i) + 0.3;
        p.setX(i, p.getX(i) * (1 - y / 0.6));
        p.setY(i, y);
        p.setZ(i, (y / 0.6) ** 2 * 0.12);
      }
      b.rotateY((k / 5) * Math.PI + Math.random() * 0.3);
      b.translate((Math.random() - 0.5) * 0.25, 0, (Math.random() - 0.5) * 0.25);
      blades.push(b);
    }
    const geo = mergeGeometries(blades);
    geo.computeVertexNormals();
    const mat = addWind(new THREE.MeshStandardMaterial({ color: 0x5fa833, roughness: 0.9, side: THREE.DoubleSide }), this.wind, 0.25, 0.05);
    const grass = new THREE.InstancedMesh(geo, mat, count);
    const flowerGeo = new THREE.IcosahedronGeometry(0.07, 0).translate(0, 0.45, 0);
    const flowers = new THREE.InstancedMesh(flowerGeo, new THREE.MeshStandardMaterial({ roughness: 0.6 }), Math.floor(count / 6));
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    const col = new THREE.Color();
    const flowerColors = [0xffffff, 0xffeb3b, 0xe040fb, 0xff5252, 0x40c4ff];
    let fi = 0, placed = 0;
    for (let i = 0; i < count * 3 && placed < count; i++) {
      // concentrate grass near the track where the camera spends its time
      const k = (this.rng() * this.N) | 0;
      const p = this.samples[k], r = this.rights[k];
      const side = this.rng() < 0.5 ? -1 : 1;
      const off = side * (this.trackWidth / 2 + 2.2 + this.rng() ** 1.5 * 45);
      const x = p.x + r.x * off + (this.rng() - 0.5) * 6, z = p.z + r.z * off + (this.rng() - 0.5) * 6;
      if (this.trackDistance(x, z) < this.trackWidth / 2 + 1.8) continue;
      const h = this.heightAt(x, z);
      if (h < WATER_LEVEL + 0.3) continue;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.rng() * 6.28);
      m4.compose(v.set(x, h, z), q, sc.setScalar(0.7 + this.rng() * 0.9));
      grass.setMatrixAt(placed, m4);
      grass.setColorAt(placed, col.setHSL(0.22 + this.rng() * 0.07, 0.45, 0.6 + this.rng() * 0.5));
      placed++;
      if (fi < flowers.count && this.rng() < 0.17) {
        flowers.setMatrixAt(fi, m4);
        flowers.setColorAt(fi, col.setHex(flowerColors[(this.rng() * flowerColors.length) | 0]));
        fi++;
      }
    }
    grass.count = placed;
    flowers.count = fi;
    grass.receiveShadow = true;
    this.scene.add(grass, flowers);
  }

  buildRocks() {
    const geo = new THREE.DodecahedronGeometry(1, 1);
    const p = geo.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      v.multiplyScalar(1 + (Math.sin(v.x * 4.1 + v.z * 2.3) * 0.12 + Math.cos(v.y * 5.3) * 0.08));
      p.setXYZ(i, v.x, v.y * 0.7, v.z);
    }
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0x8a867c, roughness: 0.95, flatShading: true });
    const count = 160;
    const rocks = new THREE.InstancedMesh(geo, mat, count);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), vv = new THREE.Vector3(), sc = new THREE.Vector3();
    let n = 0;
    for (let i = 0; i < count; i++) {
      const s = this.randomSpot(this.trackWidth / 2 + 9, 75, 60);
      if (!s) continue;
      const size = 0.4 + this.rng() ** 2 * 2.6;
      q.setFromEuler(new THREE.Euler(this.rng(), this.rng() * 6, this.rng()));
      m4.compose(vv.set(s.x, s.h + size * 0.2, s.z), q, sc.set(size, size, size));
      rocks.setMatrixAt(n++, m4);
      this.pw.createCollider(RAPIER.ColliderDesc.ball(size * 0.75).setTranslation(s.x, s.h + size * 0.1, s.z), this.staticBody);
    }
    rocks.count = n;
    rocks.castShadow = true; rocks.receiveShadow = true;
    this.scene.add(rocks);
  }

  // ---------------------------------------------------------------- STUNT PARK
  buildStuntPark() {
    const concrete = canvasTexture(256, 256, (ctx, w, h) => {
      ctx.fillStyle = '#8d8f91'; ctx.fillRect(0, 0, w, h);
      speckle(ctx, w, h, 9000, ['#7f8183', '#9a9c9e', '#86888a', '#a3a5a7'], 2);
      ctx.strokeStyle = 'rgba(40,40,40,0.35)'; ctx.lineWidth = 2;
      ctx.strokeRect(0, 0, w, h);
    }, { repeat: [24, 24] });
    const pad = new THREE.Mesh(new THREE.CircleGeometry(58, 64),
      new THREE.MeshStandardMaterial({ map: concrete, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = 0.03;
    pad.receiveShadow = true;
    this.scene.add(pad);
    // painted donut rings
    for (const [x, z] of [[-25, 20], [25, -20]]) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(7.6, 8, 48),
        new THREE.MeshBasicMaterial({ color: 0xffd600, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(x, 0.04, z);
      this.scene.add(ring);
    }

    const stripe = canvasTexture(128, 128, (ctx, w, h) => {
      ctx.fillStyle = '#ff6d00'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#fafafa';
      for (let i = -2; i < 6; i++) {
        ctx.beginPath();
        ctx.moveTo(i * 32, 0); ctx.lineTo(i * 32 + 16, 0); ctx.lineTo(i * 32 + 16 + h, h); ctx.lineTo(i * 32 + h, h);
        ctx.fill();
      }
    }, { repeat: [2, 2] });
    const rampMat = new THREE.MeshStandardMaterial({ map: stripe, roughness: 0.6, metalness: 0.1 });
    const ramps = [
      { x: 0, z: -30, yaw: 0, L: 12, H: 3.0, W: 7 },
      { x: 0, z: 18, yaw: Math.PI, L: 7, H: 1.4, W: 6, landing: true },
      { x: -32, z: -8, yaw: Math.PI / 2, L: 9, H: 2.0, W: 6 },
      { x: 36, z: 12, yaw: -Math.PI / 2, L: 14, H: 4.2, W: 8 },
      { x: 30, z: 38, yaw: Math.PI * 0.8, L: 6, H: 1.0, W: 10 },
    ];
    for (const r of ramps) this.addRamp(r, rampMat);
  }

  addRamp({ x, z, yaw, L, H, W }, mat) {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(L, 0);
    shape.lineTo(L, H);
    shape.lineTo(L - 0.6, H);
    shape.quadraticCurveTo(L * 0.45, H * 0.25, 0, 0);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: W, bevelEnabled: false, curveSegments: 10 });
    // shape x -> local z (forward), extrusion -> local x
    geo.rotateY(-Math.PI / 2);
    geo.translate(W / 2, 0, -L / 2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, 0, z);
    mesh.rotation.y = yaw;
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.scene.add(mesh);
    mesh.updateMatrixWorld(true);
    // physics: trimesh of the transformed geometry for an exact match
    const g = geo.clone().applyMatrix4(mesh.matrixWorld);
    const ng = g.index ? g : (() => { const idx = []; for (let i = 0; i < g.attributes.position.count; i++) idx.push(i); g.setIndex(idx); return g; })();
    const col = this.pw.createCollider(
      RAPIER.ColliderDesc.trimesh(new Float32Array(ng.attributes.position.array), new Uint32Array(ng.index.array)).setFriction(0.9),
      this.staticBody);
    this.groundHandles.add(col.handle);
  }

  // ---------------------------------------------------------------- DYNAMIC PROPS
  buildProps() {
    const coneTex = canvasTexture(32, 64, (ctx, w, h) => {
      ctx.fillStyle = '#ff5a00'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#f5f5f5'; ctx.fillRect(0, h * 0.3, w, h * 0.14); ctx.fillRect(0, h * 0.58, w, h * 0.12);
    });
    const crateTex = canvasTexture(128, 128, (ctx, w, h) => {
      ctx.fillStyle = '#a8773f'; ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 8; i++) { ctx.fillStyle = i % 2 ? '#9b6c37' : '#b28247'; ctx.fillRect(0, i * 16, w, 15); }
      ctx.strokeStyle = '#6d4a24'; ctx.lineWidth = 10; ctx.strokeRect(5, 5, w - 10, h - 10);
      ctx.beginPath(); ctx.moveTo(8, 8); ctx.lineTo(w - 8, h - 8); ctx.stroke();
    });
    const barrelTex = canvasTexture(64, 64, (ctx, w, h) => {
      ctx.fillStyle = '#1565c0'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#90a4ae'; ctx.fillRect(0, 6, w, 4); ctx.fillRect(0, h - 10, w, 4); ctx.fillRect(0, h / 2 - 2, w, 4);
    });

    const kinds = {
      cone: {
        geo: new THREE.CylinderGeometry(0.04, 0.24, 0.72, 16),
        mat: new THREE.MeshStandardMaterial({ map: coneTex, roughness: 0.5 }),
        collider: () => RAPIER.ColliderDesc.cone(0.36, 0.24).setDensity(30).setFriction(0.6).setRestitution(0.3),
        hy: 0.36,
      },
      crate: {
        geo: new THREE.BoxGeometry(1, 1, 1),
        mat: new THREE.MeshStandardMaterial({ map: crateTex, roughness: 0.85 }),
        collider: () => RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5).setDensity(25).setFriction(0.7),
        hy: 0.5,
      },
      barrel: {
        geo: new THREE.CylinderGeometry(0.32, 0.32, 0.95, 16),
        mat: new THREE.MeshStandardMaterial({ map: barrelTex, roughness: 0.4, metalness: 0.5 }),
        collider: () => RAPIER.ColliderDesc.cylinder(0.475, 0.32).setDensity(40).setFriction(0.5).setRestitution(0.2),
        hy: 0.475,
      },
    };
    const spots = { cone: [], crate: [], barrel: [] };
    // slalom in the park
    for (let i = 0; i < 10; i++) spots.cone.push([-40 + i * 8, 0, 42 - (i % 2) * 3]);
    // cone ring around donut circles
    for (const [cx, cz] of [[-25, 20], [25, -20]]) {
      for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; spots.cone.push([cx + Math.cos(a) * 9.5, 0, cz + Math.sin(a) * 9.5]); }
    }
    // cones at track apexes
    for (let i = 0; i < this.N; i += 24) {
      const cv = this.curvature[i];
      if (Math.abs(cv) < 0.12) continue;
      const inside = cv > 0 ? 1 : -1;
      const p = this.samples[i], r = this.rights[i];
      const off = inside * (this.trackWidth / 2 + 2.5);
      spots.cone.push([p.x + r.x * off, 0, p.z + r.z * off]);
    }
    // crate pyramids
    for (const [cx, cz] of [[10, -5], [-12, -40], [44, -32]]) {
      for (let l = 0; l < 3; l++) for (let k = 0; k < 3 - l; k++) spots.crate.push([cx + (k - (2 - l) / 2) * 1.05, l * 1.0, cz]);
    }
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; spots.barrel.push([Math.cos(a) * 52 * 0.35 - 5, 0, Math.sin(a) * 6 + 2]); }

    this.propMeshes = [];
    for (const [name, list] of Object.entries(spots)) {
      const k = kinds[name];
      const inst = new THREE.InstancedMesh(k.geo, k.mat, list.length);
      inst.castShadow = true; inst.receiveShadow = true;
      inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.scene.add(inst);
      const bodies = [];
      for (const [x, y, z] of list) {
        const h = this.heightAt(x, z);
        const body = this.pw.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, h + y + k.hy + 0.05, z)
          .setLinearDamping(0.3).setAngularDamping(0.4).setCanSleep(true));
        this.pw.createCollider(k.collider(), body);
        bodies.push({ body, home: { x, y: h + y + k.hy + 0.05, z } });
      }
      this.propMeshes.push({ inst, bodies });
    }
    this.syncProps();
  }

  syncProps() {
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    for (const { inst, bodies } of this.propMeshes) {
      let changed = false;
      bodies.forEach(({ body }, i) => {
        if (body.isSleeping() && inst.userData.init) return;
        const t = body.translation(), r = body.rotation();
        m4.compose(v.set(t.x, t.y, t.z), q.set(r.x, r.y, r.z, r.w), one);
        inst.setMatrixAt(i, m4);
        changed = true;
      });
      inst.userData.init = true;
      if (changed) { inst.instanceMatrix.needsUpdate = true; inst.computeBoundingSphere(); }
    }
  }

  resetProps() {
    for (const { bodies } of this.propMeshes) {
      for (const { body, home } of bodies) {
        body.setTranslation(home, true);
        body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
        body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
    }
  }

  buildBounds() {
    const L = SIZE / 2 - 8;
    for (const [x, z, hx, hz] of [[L, 0, 1, L], [-L, 0, 1, L], [0, L, L, 1], [0, -L, L, 1]]) {
      this.pw.createCollider(RAPIER.ColliderDesc.cuboid(hx, 120, hz).setTranslation(x, 60, z), this.staticBody);
    }
  }

  update(dt, time) {
    this.wind.uTime.value = time;
    if (this.waterNormal) this.waterNormal.offset.set(time * 0.01, time * 0.006);
    this.crowdExcite = Math.max(0.25, this.crowdExcite - dt * 0.3);
    this.updateCrowd(time);
    this.syncProps();
  }
}
