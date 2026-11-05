import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const CAR_DIMS = {
  wheelBase: 1.36,   // half distance between axles
  track: 0.8,        // half distance between left/right wheels
  wheelRadius: 0.36,
  wheelWidth: 0.27,
  connY: -0.2,      // suspension mount height relative to chassis origin
};

function sideProfile() {
  // Low, wide mid-engine supercar silhouette: long nose, cab-forward cabin, engine deck + ducktail
  const s = new THREE.Shape();
  const wb = CAR_DIMS.wheelBase, ar = 0.47, ay = -0.47;
  s.moveTo(-2.25, -0.5);
  s.lineTo(-wb - ar, -0.5);
  s.absarc(-wb, ay, ar, Math.PI, 0, true);
  s.lineTo(wb - ar, -0.5);
  s.absarc(wb, ay, ar, Math.PI, 0, true);
  s.lineTo(2.15, -0.5);
  s.quadraticCurveTo(2.4, -0.48, 2.38, -0.3);
  s.quadraticCurveTo(2.36, -0.08, 2.12, -0.03);
  s.quadraticCurveTo(1.55, 0.06, 0.95, 0.17);
  s.quadraticCurveTo(-0.2, 0.24, -1.0, 0.25);
  s.quadraticCurveTo(-1.9, 0.27, -2.28, 0.33);
  s.quadraticCurveTo(-2.4, 0.3, -2.37, 0.05);
  s.quadraticCurveTo(-2.33, -0.45, -2.25, -0.5);
  return s;
}

function cabinProfile() {
  const s = new THREE.Shape();
  s.moveTo(1.02, 0.15);
  s.quadraticCurveTo(0.5, 0.36, 0.0, 0.54);
  s.quadraticCurveTo(-0.42, 0.6, -0.85, 0.53);
  s.quadraticCurveTo(-1.35, 0.4, -1.8, 0.27);
  s.lineTo(1.02, 0.15);
  return s;
}

function extrudeAlongX(shape, width, bevel) {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width - bevel * 2, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.8,
    bevelSegments: 5, curveSegments: 24,
  });
  geo.rotateY(-Math.PI / 2);
  geo.translate((width - bevel * 2) / 2, 0, 0);
  geo.computeVertexNormals();
  return geo;
}

function buildWheel(materials) {
  const { radius: R, width: Wd } = { radius: CAR_DIMS.wheelRadius, width: CAR_DIMS.wheelWidth };
  const spin = new THREE.Group();
  // tyre: lathe profile for a rounded sidewall
  const pts = [];
  const steps = 12;
  for (let i = 0; i <= steps; i++) {
    const a = -Math.PI / 2 + (i / steps) * Math.PI;
    pts.push(new THREE.Vector2(R - 0.06 + Math.cos(a) * 0.06, Math.sin(a) * (Wd / 2)));
  }
  pts.unshift(new THREE.Vector2(R * 0.66, -Wd / 2));
  pts.push(new THREE.Vector2(R * 0.66, Wd / 2));
  const tyreGeo = new THREE.LatheGeometry(pts, 40);
  tyreGeo.rotateZ(Math.PI / 2);
  const tyre = new THREE.Mesh(tyreGeo, materials.tyre);
  tyre.castShadow = true;
  spin.add(tyre);

  const rimFace = new THREE.CylinderGeometry(R * 0.68, R * 0.68, Wd * 0.7, 32, 1, true);
  rimFace.rotateZ(Math.PI / 2);
  spin.add(new THREE.Mesh(rimFace, materials.rimDark));

  const spokes = [];
  for (let i = 0; i < 5; i++) {
    const sp = new THREE.BoxGeometry(0.035, R * 1.22, 0.07);
    sp.rotateX((i / 5) * Math.PI * 2);
    spokes.push(sp);
  }
  const hub = new THREE.CylinderGeometry(0.07, 0.07, 0.05, 16).rotateZ(Math.PI / 2);
  const spokeGeo = mergeGeometries([...spokes, hub]);
  const outer = new THREE.Mesh(spokeGeo, materials.rim);
  outer.position.x = Wd * 0.3;
  spin.add(outer);
  const lip = new THREE.Mesh(new THREE.TorusGeometry(R * 0.67, 0.018, 8, 40).rotateY(Math.PI / 2), materials.rim);
  lip.position.x = Wd * 0.33;
  spin.add(lip);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.55, R * 0.55, 0.03, 28).rotateZ(Math.PI / 2), materials.disc);
  spin.add(disc);
  return spin;
}

/**
 * Builds a detailed procedural sports car. Origin = chassis center.
 * Forward is +Z, right is -X (three.js right-handed, camera behind the car).
 */
export function buildCarModel(colorHex = 0xd01818, { ghost = false } = {}) {
  const root = new THREE.Group();
  const body = new THREE.Group();   // tilts for roll/pitch animation
  root.add(body);

  const paint = new THREE.MeshPhysicalMaterial({
    color: colorHex, metalness: 0.2, roughness: 0.26, clearcoat: 0.8, clearcoatRoughness: 0.05, envMapIntensity: 0.55,
  });
  const materials = {
    paint,
    glass: new THREE.MeshPhysicalMaterial({ color: 0x05080d, metalness: 0.6, roughness: 0.05, clearcoat: 1 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x0c0d0f, roughness: 0.5, metalness: 0.2 }),
    carbon: new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.35, metalness: 0.5 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.12, metalness: 1 }),
    tyre: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.88 }),
    rim: new THREE.MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.25, metalness: 0.9 }),
    rimDark: new THREE.MeshStandardMaterial({ color: 0x1b1c1f, roughness: 0.4, metalness: 0.8, side: THREE.DoubleSide }),
    disc: new THREE.MeshStandardMaterial({ color: 0x5a5a5a, roughness: 0.4, metalness: 0.9 }),
    caliper: new THREE.MeshStandardMaterial({ color: 0xffc400, roughness: 0.35, metalness: 0.3 }),
    headlight: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4e0, emissiveIntensity: 0.6, roughness: 0.1 }),
    taillight: new THREE.MeshStandardMaterial({ color: 0x500000, emissive: 0xff1010, emissiveIntensity: 0.6, roughness: 0.2 }),
    reverse: new THREE.MeshStandardMaterial({ color: 0x777777, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.2 }),
    flame: new THREE.MeshBasicMaterial({ color: 0x66aaff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
  };

  const shell = new THREE.Mesh(extrudeAlongX(sideProfile(), 1.94, 0.12), paint);
  shell.castShadow = true; shell.receiveShadow = true;
  body.add(shell);

  const cabin = new THREE.Mesh(extrudeAlongX(cabinProfile(), 1.5, 0.13), materials.glass);
  cabin.castShadow = true;
  body.add(cabin);
  // body-coloured roof panel
  const roof = new THREE.Mesh(extrudeAlongX((() => {
    const r = new THREE.Shape();
    r.moveTo(0.05, 0.545); r.quadraticCurveTo(-0.42, 0.62, -0.86, 0.545);
    r.lineTo(-0.84, 0.5); r.quadraticCurveTo(-0.42, 0.575, 0.03, 0.5); r.lineTo(0.05, 0.545);
    return r;
  })(), 1.32, 0.05), paint);
  roof.position.y = 0.02;
  body.add(roof);

  // Optional twin racing stripes over nose, roof and deck
  const stripeMat = new THREE.MeshStandardMaterial({ color: 0xf8f8f8, roughness: 0.25, metalness: 0.05 });
  materials.stripe = stripeMat;
  for (const sx of [-0.16, 0.16]) {
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.012, 1.15), stripeMat);
    st.position.set(sx, 0.2, 1.6);
    st.rotation.x = 0.17;
    body.add(st);
  }

  // Front: aero splitter, intakes, slim swept headlights
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.04, 0.34), materials.carbon);
  splitter.position.set(0, -0.5, 2.36);
  body.add(splitter);
  const grille = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.16, 0.08), materials.trim);
  grille.position.set(0, -0.3, 2.47);
  body.add(grille);
  for (const sx of [-0.66, 0.66]) {
    const duct = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.08), materials.trim);
    duct.position.set(sx, -0.3, 2.44);
    body.add(duct);
  }
  const headGeo = new THREE.BoxGeometry(0.46, 0.06, 0.3);
  const headlights = [];
  for (const sx of [-0.6, 0.6]) {
    const h = new THREE.Mesh(headGeo, materials.headlight);
    h.position.set(sx, 0.07, 2.12);
    h.rotation.x = -0.18;
    h.rotation.y = sx > 0 ? 0.32 : -0.32;
    body.add(h);
    headlights.push(h);
  }
  // Hood vents
  for (const sx of [-0.32, 0.32]) {
    const v = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.02, 0.32), materials.trim);
    v.position.set(sx, 0.21, 1.15);
    v.rotation.x = 0.17;
    body.add(v);
  }

  // Rear: quad round tail lights, engine cover louvres, diffuser, centre exhausts
  const tlGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.05, 24).rotateX(Math.PI / 2);
  for (const sx of [-0.78, -0.5, 0.5, 0.78]) {
    const tl = new THREE.Mesh(tlGeo, materials.taillight);
    tl.position.set(sx, 0.16, -2.47);
    body.add(tl);
  }
  const rev = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 0.04), materials.reverse);
  rev.position.set(0, 0.17, -2.48);
  body.add(rev);
  for (let i = 0; i < 5; i++) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.015, 0.05), materials.trim);
    l.position.set(0, 0.36, -1.25 - i * 0.16);
    body.add(l);
  }
  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.18, 0.28), materials.carbon);
  diffuser.position.set(0, -0.42, -2.36);
  body.add(diffuser);
  for (let k = -2; k <= 2; k++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.18, 0.3), materials.carbon);
    fin.position.set(k * 0.3, -0.42, -2.42);
    body.add(fin);
  }
  const exhausts = [];
  const flames = [];
  for (const sx of [-0.13, 0.13]) {
    const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.3, 18, 1, true).rotateX(Math.PI / 2), materials.chrome);
    ex.position.set(sx, -0.22, -2.47);
    body.add(ex);
    exhausts.push(ex);
    const fl = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.8, 12, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -0.4), materials.flame);
    fl.position.set(sx, -0.22, -2.6);
    fl.visible = false;
    body.add(fl);
    flames.push(fl);
  }
  // Ducktail lip
  const lip = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.03, 0.18), materials.carbon);
  lip.position.set(0, 0.44, -2.33);
  lip.rotation.x = 0.25;
  body.add(lip);

  // Sides: big mid-engine intakes, skirts, mirrors
  for (const sx of [-1, 1]) {
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 1.8), materials.carbon);
    skirt.position.set(sx * 1.04, -0.46, 0);
    body.add(skirt);
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.15), paint);
    mirror.position.set(sx * 1.08, 0.3, 0.82);
    body.add(mirror);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, 0.04), materials.trim);
    arm.position.set(sx * 1.0, 0.27, 0.82);
    body.add(arm);
    const intake = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.24, 0.62), materials.trim);
    intake.position.set(sx * 1.05, -0.02, -0.62);
    intake.rotation.y = sx * 0.12;
    body.add(intake);
  }

  // Wheels
  const wheels = [];
  const { wheelBase, track, connY } = CAR_DIMS;
  const positions = [
    [track, wheelBase], [-track, wheelBase], [track, -wheelBase], [-track, -wheelBase],
  ];
  positions.forEach(([x, z], i) => {
    const pivot = new THREE.Group();   // steering
    pivot.position.set(x, connY - 0.3, z);
    const spin = buildWheel(materials);
    if (x < 0) spin.scale.x = -1;       // mirror so the face points outward
    pivot.add(spin);
    const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.18, 0.12), materials.caliper);
    caliper.position.set(x > 0 ? 0.05 : -0.05, 0.12, -0.1);
    pivot.add(caliper);
    root.add(pivot);
    wheels.push({ pivot, spin, front: i < 2 });
  });

  // Soft contact shadow under the car (ambient occlusion fake)
  const shadowTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(64, 64, 10, 64, 64, 64);
    g.addColorStop(0, 'rgba(0,0,0,0.75)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 5.2),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.8 }));
  blob.rotation.x = -Math.PI / 2;
  blob.renderOrder = 1;

  if (ghost) {
    root.traverse((o) => {
      if (o.isMesh) {
        o.material = new THREE.MeshBasicMaterial({ color: 0x66ddff, transparent: true, opacity: 0.22, depthWrite: false });
        o.castShadow = false;
      }
    });
  }

  return { root, body, wheels, materials, headlights, flames, exhausts, blob };
}
