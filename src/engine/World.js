import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

export const QUALITY = {
  low:    { pixelRatio: 0.85, shadowSize: 1024, msaa: 0, fxaa: true,  bloom: false, trees: 350, grass: 2500 },
  medium: { pixelRatio: 1.0,  shadowSize: 2048, msaa: 4, fxaa: false, bloom: true,  trees: 600, grass: 6000 },
  high:   { pixelRatio: 1.5,  shadowSize: 4096, msaa: 4, fxaa: false, bloom: true,  trees: 850, grass: 11000 },
};

export const TIME_PRESETS = {
  day: {
    elevation: 42, azimuth: 150, turbidity: 4, rayleigh: 1.2, mie: 0.004, mieG: 0.8, clouds: 0.45,
    sun: 3.0, sunColor: 0xfff0dd, hemi: 0.9, hemiSky: 0xbfd8ff, hemiGround: 0x4b5a35,
    fog: 0xc4d7ea, fogDensity: 0.0016, exposure: 0.55, env: 0.75, lights: false, stars: false,
  },
  sunset: {
    elevation: 5, azimuth: 255, turbidity: 9, rayleigh: 2.6, mie: 0.006, mieG: 0.88, clouds: 0.55,
    sun: 2.6, sunColor: 0xffa565, hemi: 0.55, hemiSky: 0xffb48e, hemiGround: 0x3b2a2c,
    fog: 0xdc9c7e, fogDensity: 0.0021, exposure: 0.5, env: 0.65, lights: true, stars: false,
  },
  night: {
    elevation: -8, azimuth: 200, turbidity: 2, rayleigh: 0.4, mie: 0.002, mieG: 0.7, clouds: 0.25,
    sun: 0.55, sunColor: 0x8fa8ff, hemi: 0.22, hemiSky: 0x3a4f80, hemiGround: 0x0b0d14,
    fog: 0x0b1222, fogDensity: 0.0028, exposure: 0.85, env: 0.25, lights: true, stars: true,
  },
};

const SpeedFXShader = {
  uniforms: { tDiffuse: { value: null }, amount: { value: 0 }, vignette: { value: 0.35 } },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float amount; uniform float vignette;
    varying vec2 vUv;
    void main(){
      vec2 c = vUv - 0.5;
      float d = length(c);
      float strength = amount * 0.045 * smoothstep(0.12, 0.75, d);
      vec3 col = vec3(0.0);
      for (int i = 0; i < 8; i++) {
        float s = 1.0 - strength * float(i) / 7.0;
        col += texture2D(tDiffuse, 0.5 + c * s).rgb;
      }
      col /= 8.0;
      // subtle chromatic fringe at speed
      float ca = amount * 0.006 * d;
      col.r = mix(col.r, texture2D(tDiffuse, vUv + c * ca).r, 0.6);
      col.b = mix(col.b, texture2D(tDiffuse, vUv - c * ca).b, 0.6);
      float v = smoothstep(0.95, 0.3, d * (1.0 + amount * 0.25));
      col *= mix(1.0 - vignette, 1.0, v);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class World {
  constructor(settings) {
    this.settings = settings;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0xc4d7ea, 0.0016);

    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.55;
    this.renderer.domElement.id = 'game-canvas';
    document.body.prepend(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 6000);
    this.camera.position.set(0, 8, 20);

    this.sunDir = new THREE.Vector3();
    this.setupLights();
    this.setupSky();
    this.setupStars();

    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envRT = null;

    this.setQuality(settings.quality);
    this.setTimeOfDay(settings.time);

    this.time = 0;
    window.addEventListener('resize', () => this.onResize());
  }

  setupLights() {
    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x4b5a35, 0.9);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff0dd, 3);
    this.sun.castShadow = true;
    const s = this.sun.shadow;
    s.camera.near = 1;
    s.camera.far = 400;
    s.camera.left = -55; s.camera.right = 55;
    s.camera.top = 55; s.camera.bottom = -55;
    s.bias = -0.0004;
    s.normalBias = 0.03;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
  }

  setupSky() {
    this.sky = new Sky();
    this.sky.scale.setScalar(4500);
    this.scene.add(this.sky);
    this.skyScene = new THREE.Scene();
  }

  setupStars() {
    const n = 2500;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random(), v = Math.random() * 0.48 + 0.02;
      const th = u * Math.PI * 2, ph = Math.acos(1 - v * 2) ;
      const r = 3000;
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = Math.abs(r * Math.cos(ph)) + 80;
      pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({
      color: 0xffffff, size: 2.2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.9, depthWrite: false,
    }));
    this.stars.visible = false;
    this.scene.add(this.stars);
  }

  setTimeOfDay(name) {
    const p = TIME_PRESETS[name] || TIME_PRESETS.day;
    this.preset = p;
    this.presetName = name;
    const u = this.sky.material.uniforms;
    u.turbidity.value = p.turbidity;
    u.rayleigh.value = p.rayleigh;
    u.mieCoefficient.value = p.mie;
    u.mieDirectionalG.value = p.mieG;
    if (u.cloudCoverage) u.cloudCoverage.value = p.clouds;
    const phi = THREE.MathUtils.degToRad(90 - p.elevation);
    const theta = THREE.MathUtils.degToRad(p.azimuth);
    this.sunDir.setFromSphericalCoords(1, phi, theta);
    u.sunPosition.value.copy(this.sunDir);
    if (u.showSunDisc) u.showSunDisc.value = p.elevation > -2 ? 1 : 0;

    this.sun.color.setHex(p.sunColor);
    this.sun.intensity = p.sun;
    // Night: light comes from the "moon" (opposite side, above horizon)
    this.lightDir = this.sunDir.clone();
    if (p.elevation < 3) this.lightDir.set(-this.sunDir.x, Math.max(0.35, -this.sunDir.y + 0.4), -this.sunDir.z).normalize();
    this.hemi.color.setHex(p.hemiSky);
    this.hemi.groundColor.setHex(p.hemiGround);
    this.hemi.intensity = p.hemi;
    this.scene.fog.color.setHex(p.fog);
    this.scene.fog.density = p.fogDensity;
    this.renderer.toneMappingExposure = p.exposure;
    this.stars.visible = p.stars;

    // Bake sky into an environment map for reflections on the car paint.
    this.scene.remove(this.sky);
    this.skyScene.add(this.sky);
    if (this.envRT) this.envRT.dispose();
    this.envRT = this.pmrem.fromScene(this.skyScene, 0, 1, 10000);
    this.skyScene.remove(this.sky);
    this.scene.add(this.sky);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = p.env;
  }

  setQuality(name) {
    const q = QUALITY[name] || QUALITY.high;
    this.quality = q;
    this.qualityName = name;
    const pr = Math.min(window.devicePixelRatio || 1, q.pixelRatio);
    this.renderer.setPixelRatio(pr);
    this.sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    this.buildComposer();
  }

  buildComposer() {
    const w = window.innerWidth, h = window.innerHeight;
    const pr = this.renderer.getPixelRatio();
    if (this.composer) this.composer.dispose();
    const rt = new THREE.WebGLRenderTarget(w * pr, h * pr, { type: THREE.HalfFloatType, samples: this.quality.msaa });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    if (this.quality.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.45, 0.4, 1.5);
      this.composer.addPass(this.bloom);
    } else this.bloom = null;
    this.speedPass = new ShaderPass(SpeedFXShader);
    this.composer.addPass(this.speedPass);
    this.composer.addPass(new OutputPass());
    if (this.quality.fxaa) {
      this.fxaa = new ShaderPass(FXAAShader);
      this.fxaa.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
      this.composer.addPass(this.fxaa);
    } else this.fxaa = null;
  }

  /** Keep the sun's shadow frustum centered on the player for crisp shadows. */
  followFocus(pos) {
    const d = this.lightDir || this.sunDir;
    this.sun.position.set(pos.x + d.x * 150, pos.y + Math.max(d.y, 0.25) * 150, pos.z + d.z * 150);
    this.sun.target.position.copy(pos);
    this.stars.position.copy(this.camera.position);
    this.sky.position.copy(this.camera.position);
  }

  onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.buildComposer();
    if (this.onResized) this.onResized(w, h);
  }

  render(speedAmount = 0) {
    this.speedPass.uniforms.amount.value = speedAmount;
    this.composer.render();
  }
}
