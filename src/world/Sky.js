// Sky dome: horizon-to-zenith gradient, sun disc + halo, layered clouds lit by the sun
// (fluffy cumulus + high cirrus, heavy overcast in the monsoon), moon and twinkling stars
// at night, lightning flashes.
import * as THREE from 'three'
import { U, noiseGLSL } from './Uniforms.js'

export function createSkyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uSkyTop: U.uSkyTop, uSkyHorizon: U.uSkyHorizon, uSunDir: U.uSunDir, uSunColor: U.uSunColor,
      uNight: U.uNight, uRain: U.uRain, uTime: U.uTime, uLightning: U.uLightning, uSpring: U.uSpring, uAutumn: U.uAutumn,
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
      uniform float uNight, uRain, uTime, uLightning, uSpring, uAutumn;
      varying vec3 vDir;
      ${noiseGLSL}
      float fbm5(vec2 p) {
        float a = 0.5, s = 0.0;
        for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 11.7; a *= 0.5; }
        return s;
      }
      void main() {
        vec3 d = normalize(vDir);
        vec3 sun = normalize(uSunDir);
        float h = clamp(d.y, -1.0, 1.0);
        // base gradient with a warm band near the horizon
        float t = pow(smoothstep(-0.05, 0.85, h), 0.6);
        vec3 col = mix(uSkyHorizon, uSkyTop, t);
        float sd = max(dot(d, sun), 0.0);
        float horizonGlow = exp(-abs(h) * 9.0);
        col += uSunColor * horizonGlow * pow(sd, 3.0) * 0.45 * (1.0 - uRain);
        col = mix(col, uSkyHorizon * 0.85, smoothstep(0.0, -0.25, h));
        // sun disc + halo
        col += uSunColor * (pow(sd, 8.0) * 0.3 + pow(sd, 90.0) * 0.9) * (1.0 - uRain * 0.85);
        col += uSunColor * smoothstep(0.99945, 0.99975, sd) * 5.0 * (1.0 - uRain) * step(-0.05, sun.y);
        // moon (opposite the sun) at night
        vec3 moon = normalize(vec3(-sun.x, abs(sun.y) * 0.8 + 0.25, -sun.z));
        float md = max(dot(d, moon), 0.0);
        col += vec3(0.85, 0.9, 1.0) * (smoothstep(0.9993, 0.9996, md) * 2.2 + pow(md, 60.0) * 0.25) * uNight * (1.0 - uRain);

        // clouds: project onto a dome layer
        float above = smoothstep(-0.02, 0.18, h);
        vec2 cp = d.xz / (h + 0.18) * 1.2;
        vec2 wind = vec2(uTime * 0.006, uTime * 0.002);
        float cover = 0.52 - uRain * 0.3 - uSpring * 0.04 + uAutumn * 0.02;
        float n = fbm5(cp * 0.9 + wind);
        float cum = smoothstep(cover, cover + 0.22, n) * above;
        // fake lighting: sample towards the sun, thinner = brighter edge
        float n2 = fbm5(cp * 0.9 + wind + sun.xz * 0.06);
        float lit = clamp((n - n2) * 6.0 + 0.55, 0.0, 1.0);
        vec3 cloudBright = mix(vec3(1.0, 0.98, 0.95), uSunColor * 1.1 + 0.15, 0.45 * (1.0 - uRain));
        vec3 cloudDark = mix(uSkyHorizon * 0.72, uSkyTop * 0.55 + 0.1, 0.4);
        vec3 cloudCol = mix(cloudDark, cloudBright, lit);
        cloudCol = mix(cloudCol, vec3(0.45, 0.5, 0.55), uRain * 0.6);
        cloudCol *= mix(1.0, 0.18, uNight);
        col = mix(col, cloudCol, cum * (0.9 - uNight * 0.3));
        // high cirrus streaks
        float ci = smoothstep(0.55, 0.85, fbm5(vec2(cp.x * 0.35, cp.y * 1.8) + wind * 2.0)) * above * (1.0 - uRain);
        col = mix(col, mix(vec3(1.0), uSunColor, 0.3) * mix(1.0, 0.2, uNight), ci * 0.35 * (1.0 - cum));
        // overcast sheet when raining
        col = mix(col, mix(uSkyHorizon * 0.8, vec3(0.42, 0.47, 0.52), 0.5) * mix(1.0, 0.25, uNight), uRain * 0.55 * above);

        // stars
        vec3 sp = d * 260.0;
        float star = step(0.9978, hash12(floor(sp.xz + sp.y * 13.0))) * smoothstep(0.05, 0.4, h);
        float tw = 0.55 + 0.45 * sin(uTime * 3.0 + hash12(floor(sp.xz)) * 40.0);
        col += vec3(0.9, 0.95, 1.0) * star * tw * uNight * (1.0 - uRain) * (1.0 - cum);
        // milky haze band
        float band = exp(-pow(dot(d, normalize(vec3(0.3, 0.5, 0.8))) * 3.2, 2.0)) * smoothstep(0.1, 0.5, h);
        col += vec3(0.5, 0.55, 0.75) * band * fbm5(d.xz * 6.0) * 0.12 * uNight * (1.0 - uRain);
        col += uLightning * vec3(0.55, 0.6, 0.75) * smoothstep(-0.1, 0.4, h);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  })
}

export class Sky {
  constructor(scene) {
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1100, 48, 24), createSkyMaterial())
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = -1
    scene.add(this.mesh)

    // Small scene used to bake an environment map for reflections (wet roads, car paint)
    this.envScene = new THREE.Scene()
    this.envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), createSkyMaterial()))
    const ground = new THREE.Mesh(new THREE.CircleGeometry(9.5, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x000000 }))
    ground.position.y = -0.6
    this.envGround = ground
    this.envScene.add(ground)
  }

  update(cameraPosition) {
    this.mesh.position.copy(cameraPosition)
  }
}
