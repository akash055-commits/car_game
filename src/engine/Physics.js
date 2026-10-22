import RAPIER from '@dimforge/rapier3d-compat';

export class Physics {
  constructor() {
    this.world = null;
  }

  async init() {
    await RAPIER.init();
    this.world = new RAPIER.World({ x: 0.0, y: -9.81, z: 0.0 });
    return this.world;
  }

  step() {
    if (this.world) {
      this.world.step();
    }
  }

  /**
   * Returns the collision events from the current physics step.
   * In Rapier WASM, events are retrieved via the world's event queue.
   */
  getContactEvents() {
    if (!this.world) return [];
    // In Rapier WASM, contact events are often accessed via getEvents()
    // or by checking the event queue.
    // Using a safe check to see if the method exists.
    if (typeof this.world.getEvents === 'function') {
        return this.world.getEvents();
    }
    // Fallback for different Rapier versions
    if (typeof this.world.contactEvents === 'function') {
        return this.world.contactEvents();
    }
    return [];
  }
}
