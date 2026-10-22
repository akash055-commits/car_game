import { Howler } from 'howler';

export class UI {
  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'game-ui';
    this.container.style.position = 'absolute';
    this.container.style.top = '0';
    this.container.style.left = '0';
    this.container.style.width = '100%';
    this.container.style.height = '100%';
    this.container.style.pointerEvents = 'none';
    this.container.style.fontFamily = 'sans-serif';
    this.container.style.color = 'white';
    document.body.appendChild(this.container);

    this.overlay = document.createElement('div');
    this.overlay.style.position = 'absolute';
    this.overlay.style.top = '50%';
    this.overlay.style.left = '50%';
    this.overlay.style.transform = 'translate(-50%, -50%)';
    this.overlay.style.textAlign = 'center';
    this.overlay.style.background = 'rgba(0, 0, 0, 0.5)';
    this.overlay.style.padding = '2rem';
    this.overlay.style.borderRadius = '10px';
    this.overlay.style.pointerEvents = 'auto';
    this.overlay.innerHTML = `
      <h1 style="margin: 0 0 1rem 0;">3D TOY CAR DRIVE</h1>
      <p>Use WASD or Arrow Keys to Drive</p>
      <button id="start-button" style="padding: 0.5rem 2rem; font-size: 1.2rem; cursor: pointer; pointer-events: auto;">START GAME</button>
    `;
    this.container.appendChild(this.overlay);

    this.speedometer = document.createElement('div');
    this.speedometer.style.position = 'absolute';
    this.speedometer.style.bottom = '20px';
    this.speedometer.style.left = '20px';
    this.speedometer.style.fontSize = '1.5rem';
    this.speedometer.style.background = 'rgba(0, 0, 0, 0.3)';
    this.speedometer.style.padding = '0.5rem 1rem';
    this.speedometer.style.borderRadius = '5px';
    this.speedometer.innerHTML = 'Speed: 0 km/h';
    this.container.appendChild(this.speedometer);

    this.startButton = this.overlay.querySelector('#start-button');
  }

  showOverlay() {
    this.overlay.style.display = 'block';
  }

  hideOverlay() {
    this.overlay.style.display = 'none';
  }

  updateSpeed(speed) {
    // Convert m/s to km/h approx
    const kmh = Math.round(speed * 3.6);
    this.speedometer.innerHTML = `Speed: ${kmh} km/h`;
  }

  onStart(callback) {
    this.startButton.addEventListener('click', () => {
      this.hideOverlay();
      callback();
    });
  }
}
