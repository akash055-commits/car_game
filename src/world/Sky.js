// Gradient sky dome with sun glow, overcast clouds for rain and stars at night.
import * as THREE from 'three'
import { U, noiseGLSL } from './Uniforms.js'

export function createSkyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uSkyTop: U.uSkyTop, uSkyHorizon: U.uSkyHorizon, uSunDir: U.uSunDir, uSunColor: U.uSunColor,
      uNight: U.uNight, uRain: U.uRain, uTime: U.uTime, uLightning: U.uLightning,
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSkyTop, uSkyHorizon, uSunDir, uSunColor;
      uniform float uNight, uRain, uTime, uLightning;
      varying vec3 vDir;
      ${noiseGLSL}
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, -1.0, 1.0);
        float t = pow(smoothstep(-0.05, 0.75, h), 0.7);
        vec3 col = mix(uSkyHorizon, uSkyTop, t);
        float sd = max(dot(d, normalize(uSunDir)), 0.0);
        col += uSunColor * (pow(sd, 6.0) * 0.35 + pow(sd, 64.0) * 0.8) * (1.0 - uRain * 0.8);
        col += uSunColor * smoothstep(0.9994, 0.9998, sd) * 4.0 * (1.0 - uRain);
        // Clouds (soft bands, heavy when raining)
        vec2 cp = d.xz / max(d.y + 0.25, 0.08) * 1.4 + uTime * vec2(0.012, 0.004);
        float cl = smoothstep(0.45 - uRain * 0.35, 0.85, fbm2(cp * 1.1)) * smoothstep(-0.02, 0.25, h);
        vec3 cloudCol = mix(uSkyHorizon * 1.08 + 0.05, uSkyHorizon * 0.75, uRain);
        col = mix(col, cloudCol, cl * (0.45 + uRain * 0.5));
        // Stars
        vec3 sp = d * 220.0;
        float star = step(0.9975, hash12(floor(sp.xz + sp.y * 13.0))) * smoothstep(0.05, 0.35, h);
        col += vec3(0.9, 0.95, 1.0) * star * uNight * (1.0 - uRain) * (0.6 + 0.4 * sin(uTime * 3.0 + sp.x));
        col += uLightning * vec3(0.55, 0.6, 0.75) * smoothstep(-0.1, 0.4, h);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  })
}

export class Sky {
  constructor(scene) {
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(800, 32, 16), createSkyMaterial())
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = -1
    scene.add(this.mesh)

    // Small scene used to bake an environment map for reflections (wet roads, car paint)
    this.envScene = new THREE.Scene()
    this.envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), createSkyMaterial()))
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(9.5, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x000000 }),
    )
    ground.position.y = -0.6
    this.envGround = ground
    this.envScene.add(ground)
  }

  update(cameraPosition) {
    this.mesh.position.copy(cameraPosition)
  }
}
