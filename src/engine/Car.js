import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

export class Car {
  constructor(world, physics) {
    this.world = world;
    this.physics = physics;
    this.scene = world.scene;
    this.physicsWorld = physics.world;

    this.group = new THREE.Group();
    this.mesh = this.group;
    this.rigidBody = null;

    this.controls = {
      forward: false,
      backward: false,
      left: false,
      right: false,
    };

    this.suspensionFactor = 1.0;
    this.targetSuspension = 1.0;

    this.setupInput();
    this.createCar();
  }

  setupInput() {
    window.addEventListener('keydown', (e) => this.handleKey(e.code, true));
    window.addEventListener('keyup', (e) => this.handleKey(e.code, false));
  }

  handleKey(code, isDown) {
    switch (code) {
      case 'KeyW':
      case 'ArrowUp':
        this.controls.forward = isDown;
        break;
      case 'KeyS':
      case 'ArrowDown':
        this.controls.backward = isDown;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        this.controls.left = isDown;
        break;
      case 'KeyD':
      case 'ArrowRight':
        this.controls.right = isDown;
        break;
    }
  }

  createCar() {
    // --- TOY JEEP MODEL ---
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 0.4, metalness: 0.2 }); // Forest Green
    const accentMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.8 }); // Dark Gray/Black
    const windowMat = new THREE.MeshStandardMaterial({ color: 0x88ccff, transparent: true, opacity: 0.5, roughness: 0 });
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });

    // 1. Chassis (Main Body)
    this.bodyPart = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.6, 2.8), bodyMat);
    this.bodyPart.position.y = 0.5;
    this.bodyPart.castShadow = true;
    this.group.add(this.bodyPart);

    // 2. Cabin
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.7, 1.4), bodyMat);
    cabin.position.set(0, 1.1, -0.2);
    cabin.castShadow = true;
    this.group.add(cabin);

    // 3. Windows
    const windshield = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.1), windowMat);
    windshield.position.set(0, 1.1, 0.5);
    this.group.add(windshield);

    const rearWindow = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.1), windowMat);
    rearWindow.position.set(0, 1.1, -0.9);
    this.group.add(rearWindow);

    // 4. Headlights (The "Glow")
    const headlightGeom = new THREE.SphereGeometry(0.15, 16, 16);
    const headlightMat = new THREE.MeshBasicMaterial({ color: 0xffffaa });

    const leftLight = new THREE.Mesh(headlightGeom, headlightMat);
    leftLight.position.set(0.4, 0.5, 1.4);
    this.group.add(leftLight);

    const rightLight = new THREE.Mesh(headlightGeom, headlightMat);
    rightLight.position.set(-0.4, 0.5, 1.4);
    this.group.add(rightLight);

    // Spotlights for the beams
    this.leftSpot = new THREE.SpotLight(0xffffaa, 15, 15, Math.PI/6, 0.5, 1);
    this.leftSpot.position.set(0.4, 0.5, 1.4);
    this.leftSpot.target.position.set(0.4, 0, 10);
    this.group.add(this.leftSpot);
    this.group.add(this.leftSpot.target);

    this.rightSpot = new THREE.SpotLight(0xffffaa, 15, 15, Math.PI/6, 0.5, 1);
    this.rightSpot.position.set(-0.4, 0.5, 1.4);
    this.rightSpot.target.position.set(-0.4, 0, 10);
    this.group.add(this.rightSpot);
    this.group.add(this.rightSpot.target);

    // 5. Wheels (4 detailed wheels)
    const wheelGeom = new THREE.CylinderGeometry(0.4, 0.4, 0.4, 24);
    wheelGeom.rotateZ(Math.PI / 2);

    const wheelPositions = [
      { x: 0.8, y: 0.4, z: 0.9 },
      { x: -0.8, y: 0.4, z: 0.9 },
      { x: 0.8, y: 0.4, z: -0.9 },
      { x: -0.8, y: 0.4, z: -0.9 }
    ];

    wheelPositions.forEach(pos => {
      const wheelGroup = new THREE.Group();
      const wheel = new THREE.Mesh(wheelGeom, wheelMat);
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.42, 12), new THREE.MeshStandardMaterial({color: 0xcccccc}));
      rim.rotateZ(Math.PI / 2);
      wheelGroup.add(wheel);
      wheelGroup.add(rim);
      wheelGroup.position.set(pos.x, pos.y, pos.z);
      wheelGroup.castShadow = true;
      this.group.add(wheelGroup);
    });

    this.scene.add(this.group);

    // --- PHYSICS BODY ---
    let rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, 2, 0)
      .setCanSleep(false)
      .setLinearDamping(0.7)
      .setAngularDamping(1.5);

    this.rigidBody = this.physicsWorld.createRigidBody(rigidBodyDesc);

    let colliderDesc = RAPIER.ColliderDesc.cuboid(0.7, 0.4, 1.4)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    this.physicsWorld.createCollider(colliderDesc, this.rigidBody);
  }

  update() {
    if (!this.rigidBody || !this.mesh) return;

    const accelForce = 65.0;
    const steerTorque = 18.0;

    const rotation = this.rigidBody.rotation();
    const quat = new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
    const forwardDir = new THREE.Vector3(0, 0, 1).applyQuaternion(quat);

    if (this.controls.forward) {
      this.rigidBody.applyImpulse(forwardDir.clone().multiplyScalar(accelForce * 0.05), true);
    }
    if (this.controls.backward) {
      this.rigidBody.applyImpulse(forwardDir.clone().multiplyScalar(-accelForce * 0.05), true);
    }

    if (this.controls.left) {
      this.rigidBody.applyTorqueImpulse({ x: 0, y: steerTorque, z: 0 }, true);
    }
    if (this.controls.right) {
      this.rigidBody.applyTorqueImpulse({ x: 0, y: -steerTorque, z: 0 }, true);
    }

    // Suspension Animation
    const vel = this.rigidBody.linvel();
    if (Math.abs(vel.y) > 0.5) {
      this.targetSuspension = 0.85;
    } else {
      this.targetSuspension = 1.0;
    }
    this.suspensionFactor += (this.targetSuspension - this.suspensionFactor) * 0.1;
    this.bodyPart.scale.set(1, this.suspensionFactor, 1);

    // Sync Visuals
    const pos = this.rigidBody.translation();
    const rot = this.rigidBody.rotation();
    this.mesh.position.set(pos.x, pos.y, pos.z);
    this.mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);

    // Sync Headlights target to face forward
    this.leftSpot.target.position.copy(this.mesh.position).add(forwardDir.clone().multiplyScalar(10));
    this.rightSpot.target.position.copy(this.mesh.position).add(forwardDir.clone().multiplyScalar(10));
  }
}
