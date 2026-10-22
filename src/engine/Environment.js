import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

export class Environment {
  constructor(world, physics) {
    this.world = world;
    this.physics = physics;
    this.scene = world.scene;
    this.physicsWorld = physics.world;

    this.setupTerrain();
    this.setupBoundaries();
    this.setupDecorations();
  }

  setupTerrain() {
    // 1. Visual Ground (Base layer)
    const floorGeometry = new THREE.PlaneGeometry(200, 200);
    const floorMaterial = new THREE.MeshStandardMaterial({
      color: 0x567d46,
      roughness: 0.9,
      metalness: 0.0
    });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // 2. Add a "Circuit" or Path to give the game structure
    this.createPath();

    // 3. Ground Detail: Procedural Grass/Dirt Patches
    const patchGeom = new THREE.CircleGeometry(2, 12);
    const patchMat = new THREE.MeshStandardMaterial({
        color: 0x4d6d3e,
        transparent: true,
        opacity: 0.5,
        roughness: 1.0
    });

    for (let i = 0; i < 50; i++) {
      const patch = new THREE.Mesh(patchGeom, patchMat);
      patch.position.set((Math.random() - 0.5) * 150, 0.02, (Math.random() - 0.5) * 150);
      patch.rotation.x = -Math.PI / 2;
      patch.scale.setScalar(Math.random() * 3 + 1);
      this.scene.add(patch);
    }

    // 4. Physics Ground
    const groundBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0);
    const groundBody = this.physicsWorld.createRigidBody(groundBodyDesc);
    const groundColliderDesc = RAPIER.ColliderDesc.cuboid(100, 0.1, 100);
    this.physicsWorld.createCollider(groundColliderDesc, groundBody);
  }

  createPath() {
    // A simple loop path to give the player something to drive on
    const pathPoints = [
        new THREE.Vector3(0, 0.05, 0),
        new THREE.Vector3(30, 0.05, 0),
        new THREE.Vector3(40, 0.05, 30),
        new THREE.Vector3(0, 0.05, 40),
        new THREE.Vector3(-40, 0.05, 30),
        new THREE.Vector3(-30, 0.05, 0),
        new THREE.Vector3(0, 0.05, -30),
        new THREE.Vector3(30, 0.05, -30),
        new THREE.Vector3(0, 0.05, 0),
    ];

    const curve = new THREE.CatmullRomCurve3(pathPoints);
    const pathGeometry = new THREE.TubeGeometry(curve, 64, 4, 8, true);
    const pathMaterial = new THREE.MeshStandardMaterial({
        color: 0x333333,
        roughness: 0.7,
        metalness: 0.2
    });
    const pathMesh = new THREE.Mesh(pathGeometry, pathMaterial);
    pathMesh.scale.set(1, 0.05, 1); // Flatten it into a road
    pathMesh.position.y = 0.01; // Slightly above ground to avoid z-fighting
    pathMesh.receiveShadow = true;
    this.scene.add(pathMesh);

    // Physics Path (A series of thin boxes or a single large collider)
    // For simplicity and performance, we'll just use a large flat collider for the ground
    // and focus on visual path-following.
  }

  setupBoundaries() {
    const wallThickness = 1.5;
    const wallHeight = 6;
    const territorySize = 50;

    const wallPositions = [
      { x: territorySize, z: 0 },
      { x: -territorySize, z: 0 },
      { x: 0, z: territorySize },
      { x: 0, z: -territorySize },
    ];

    wallPositions.forEach((pos) => {
      const wallBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(pos.x, wallHeight / 2, pos.z);
      const wallBody = this.physicsWorld.createRigidBody(wallBodyDesc);
      const wallColliderDesc = RAPIER.ColliderDesc.cuboid(territorySize, wallHeight / 2, wallThickness);
      this.physicsWorld.createCollider(wallColliderDesc, wallBody);

      const pillarGeom = new THREE.BoxGeometry(wallThickness, wallHeight, wallThickness);
      const pillarMat = new THREE.MeshStandardMaterial({ color: 0x34495e, transparent: true, opacity: 0.15 });
      const pillar = new THREE.Mesh(pillarGeom, pillarMat);
      pillar.position.set(pos.x, wallHeight/2, pos.z);
      this.scene.add(pillar);
    });
  }

  setupDecorations() {
    // --- STYLIZED DIORAMA ASSETS ---

    // 1. Trees (Cylinders + Spheres)
    const treeCount = 40;
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5d4037, roughness: 1 });
    const leavesMat = new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 0.8 });

    for (let i = 0; i < treeCount; i++) {
      const x = (Math.random() - 0.5) * 95;
      const z = (Math.random() - 0.5) * 95;
      // Avoid placing trees on the main path (approximate)
      if (Math.abs(x) < 10 && Math.abs(z) < 10) continue;

      const treeGroup = new THREE.Group();

      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 1.8), trunkMat);
      trunk.position.y = 0.9;
      trunk.castShadow = true;
      treeGroup.add(trunk);

      const leaves = new THREE.Mesh(new THREE.SphereGeometry(1.4, 8, 8), leavesMat);
      leaves.position.y = 2.2;
      leaves.castShadow = true;
      treeGroup.add(leaves);

      treeGroup.position.set(x, 0, z);
      this.scene.add(treeGroup);

      const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(x, 0.9, z);
      const body = this.physicsWorld.createRigidBody(bodyDesc);
      const colliderDesc = RAPIER.ColliderDesc.cylinder(0.9, 0.3);
      this.physicsWorld.createCollider(colliderDesc, body);
    }

    // 2. Colorful Obstacle Cubes
    const cubeCount = 30;
    const colors = [0xe74c3c, 0xf1c40f, 0x3498db, 0x9b59b6, 0x1abc9c];
    for (let i = 0; i < cubeCount; i++) {
      const x = (Math.random() - 0.5) * 85;
      const z = (Math.random() - 0.5) * 85;
      if (Math.abs(x) < 10 && Math.abs(z) < 10) continue;

      const size = 0.8 + Math.random() * 1.5;
      const color = colors[Math.floor(Math.random() * colors.length)];
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size, size, size),
        new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.1 })
      );
      mesh.position.set(x, size / 2, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);

      const bodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(x, size / 2, z);
      const body = this.physicsWorld.createRigidBody(bodyDesc);
      const colliderDesc = RAPIER.ColliderDesc.cuboid(size/2, size/2, size/2)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
      this.physicsWorld.createCollider(colliderDesc, body);
    }
  }
}
