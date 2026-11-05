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
  const s = new THREE.Shape();
  const wb = CAR_DIMS.wheelBase, ar = 0.47, ay = -0.47;
  s.moveTo(-2.2, -0.5);
  s.lineTo(-wb - ar, -0.5);
  s.absarc(-wb, ay, ar, Math.PI, 0, true);
  s.lineTo(wb - ar, -0.5);
  s.absarc(wb, ay, ar, Math.PI, 0, true);
  s.lineTo(2.12, -0.5);
  s.quadraticCurveTo(2.32, -0.46, 2.3, -0.2);
  s.quadraticCurveTo(2.28, 0.02, 2.12, 0.08);
  s.quadraticCurveTo(1.5, 0.22, 0.85, 0.27);
  s.lineTo(-1.55, 0.31);
  s.quadraticCurveTo(-2.12, 0.32, -2.22, 0.24);
  s.quadraticCurveTo(-2.32, 0.05, -2.28, -0.25);
  s.quadraticCurveTo(-2.27, -0.48, -2.2, -0.5);
  return s;
}

function cabinProfile() {
  const s = new THREE.Shape();
  s.moveTo(0.95, 0.24);
  s.quadraticCurveTo(0.5, 0.5, 0.05, 0.69);
  s.quadraticCurveTo(-0.45, 0.75, -0.95, 0.68);
  s.quadraticCurveTo(-1.45, 0.52, -1.75, 0.3);
  s.lineTo(0.95, 0.24);
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
    color: colorHex, metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.04,
  });
  const materials = {
    paint,
    glass: new THREE.MeshPhysicalMaterial({ color: 0x0b1118, metalness: 0.9, roughness: 0.04, clearcoat: 1 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.55, metalness: 0.3 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.12, metalness: 1 }),
    tyre: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.88 }),
    rim: new THREE.MeshStandardMaterial({ color: 0xc8ccd2, roughness: 0.22, metalness: 1 }),
    rimDark: new THREE.MeshStandardMaterial({ color: 0x222428, roughness: 0.4, metalness: 0.8, side: THREE.DoubleSide }),
    disc: new THREE.MeshStandardMaterial({ color: 0x5a5a5a, roughness: 0.4, metalness: 0.9 }),
    caliper: new THREE.MeshStandardMaterial({ color: 0xffb300, roughness: 0.4, metalness: 0.4 }),
    headlight: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4e0, emissiveIntensity: 0.4, roughness: 0.1 }),
    taillight: new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff0a0a, emissiveIntensity: 0.6, roughness: 0.2 }),
    reverse: new THREE.MeshStandardMaterial({ color: 0x777777, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.2 }),
    flame: new THREE.MeshBasicMaterial({ color: 0x66aaff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
  };

  const shell = new THREE.Mesh(extrudeAlongX(sideProfile(), 1.86, 0.1), paint);
  shell.castShadow = true; shell.receiveShadow = true;
  body.add(shell);

  const cabin = new THREE.Mesh(extrudeAlongX(cabinProfile(), 1.56, 0.12), materials.glass);
  cabin.castShadow = true;
  body.add(cabin);
  // roof panel + pillars in body colour
  const roof = new THREE.Mesh(extrudeAlongX((() => {
    const s = new THREE.Shape();
    s.moveTo(0.1, 0.69); s.quadraticCurveTo(-0.45, 0.78, -0.92, 0.7);
    s.lineTo(-0.9, 0.64); s.quadraticCurveTo(-0.45, 0.72, 0.08, 0.64); s.lineTo(0.1, 0.69);
    return s;
  })(), 1.38, 0.05), paint);
  roof.position.y = 0.02;
  body.add(roof);

  // Hood vents & bonnet stripes
  const stripeMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.3, metalness: 0.1 });
  materials.stripe = stripeMat;
  for (const sx of [-0.18, 0.18]) {
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.012, 1.25), stripeMat);
    st.position.set(sx, 0.255, 1.5);
    st.rotation.x = 0.105;
    body.add(st);
  }

  // Front: grille, splitter, headlights
  const grille = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.22, 0.08), materials.trim);
  grille.position.set(0, -0.22, 2.29);
  body.add(grille);
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.05, 0.3), materials.trim);
  splitter.position.set(0, -0.48, 2.2);
  body.add(splitter);
  const headGeo = new THREE.BoxGeometry(0.42, 0.09, 0.22);
  const headlights = [];
  for (const sx of [-0.62, 0.62]) {
    const h = new THREE.Mesh(headGeo, materials.headlight);
    h.position.set(sx, 0.02, 2.17);
    h.rotation.x = -0.35;
    h.rotation.y = sx > 0 ? 0.25 : -0.25;
    body.add(h);
    headlights.push(h);
  }

  // Rear: taillight bar, diffuser, exhausts, wing
  const tail = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.07, 0.06), materials.taillight);
  tail.position.set(0, 0.12, -2.28);
  body.add(tail);
  for (const sx of [-0.72, 0.72]) {
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.14, 0.06), materials.taillight);
    tl.position.set(sx, 0.1, -2.285);
    body.add(tl);
  }
  const rev = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.05), materials.reverse);
  rev.position.set(0, -0.05, -2.29);
  body.add(rev);
  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.16, 0.25), materials.trim);
  diffuser.position.set(0, -0.42, -2.2);
  body.add(diffuser);
  const exhausts = [];
  const flames = [];
  for (const sx of [-0.35, 0.35]) {
    const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.075, 0.3, 16, 1, true).rotateX(Math.PI / 2), materials.chrome);
    ex.position.set(sx, -0.38, -2.3);
    body.add(ex);
    exhausts.push(ex);
    const fl = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.8, 12, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -0.4), materials.flame);
    fl.position.set(sx, -0.38, -2.42);
    fl.visible = false;
    body.add(fl);
    flames.push(fl);
  }
  const wing = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.04, 0.34), paint);
  wing.position.set(0, 0.62, -1.98);
  wing.rotation.x = 0.08;
  wing.castShadow = true;
  body.add(wing);
  for (const sx of [-0.55, 0.55]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.32, 0.14), materials.trim);
    post.position.set(sx, 0.45, -1.98);
    body.add(post);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.18, 0.4), materials.trim);
    plate.position.set(sx > 0 ? 0.88 : -0.88, 0.6, -1.98);
    body.add(plate);
  }
  // Side skirts & mirrors & door lines
  for (const sx of [-0.93, 0.93]) {
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 1.7), materials.trim);
    skirt.position.set(sx, -0.46, 0);
    body.add(skirt);
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.09, 0.14), paint);
    mirror.position.set(sx * 1.02, 0.33, 0.72);
    body.add(mirror);
    const intake = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.14, 0.5), materials.trim);
    intake.position.set(sx * 1.0, -0.05, -0.95);
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
