// Stylised water for the lake, stream and pond: depth-tinted, animated foam line,
// drifting ripples, sun glints and rain rings.
import * as THREE from 'three'
import { WORLD, terrainGLSL } from './Layout.js'
import { U, noiseGLSL } from './Uniforms.js'

export class Water {
  constructor(scene) {
    const minX = -25, maxX = 92, minZ = -84, maxZ = 24
    const geo = new THREE.PlaneGeometry(maxX - minX, maxZ - minZ, 1, 1).rotateX(-Math.PI / 2)
    geo.translate((minX + maxX) / 2, WORLD.waterLevel, (minZ + maxZ) / 2)

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]),
      vertexShader: /* glsl */ `
        #include <fog_pars_vertex>
        varying vec3 vWorld;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        #include <fog_pars_fragment>
        varying vec3 vWorld;
        uniform float uTime, uRain, uNight, uWaterLevel, uLightning;
        uniform vec3 uWaterShallow, uWaterDeep, uFoam, uSunDir, uSunColor, uSkyHorizon;
        ${terrainGLSL}
        ${noiseGLSL}
        void main() {
          vec2 xz = vWorld.xz;
          float depth = uWaterLevel - terrainHeight(xz);
          if (depth < -0.02) discard;
          float n = fbm2(xz * 0.18 + uTime * vec2(0.03, 0.02));
          float n2 = vnoise(xz * 1.1 - uTime * vec2(0.25, 0.1));
          vec3 col = mix(uWaterShallow, uWaterDeep, smoothstep(0.05, 1.9, depth + (n - 0.5) * 0.4));
          // Caustic-like light streaks in shallow water
          float streak = smoothstep(0.62, 0.8, vnoise(xz * 0.9 + vec2(uTime * 0.15, -uTime * 0.1)) * n2 * 1.6);
          col += streak * 0.12 * (1.0 - smoothstep(0.2, 1.4, depth)) * (1.0 - uNight);
          // Ripple lines drifting across the surface
          float lines = smoothstep(0.97, 1.0, sin((xz.x * 0.35 + xz.y * 0.6) + n * 9.0 - uTime * 0.6) * 0.5 + 0.5);
          col = mix(col, uFoam, lines * 0.07 * smoothstep(0.3, 1.2, depth));
          // Shore foam band
          float wave = sin(uTime * 1.3 + n * 8.0) * 0.05;
          float foam = smoothstep(0.17, 0.04, depth + wave) * (0.6 + 0.4 * n2);
          foam = max(foam, smoothstep(0.34, 0.3, depth + wave * 2.0) * step(0.55, n2) * 0.45);
          col = mix(col, uFoam, foam);
          // Sun glint
          vec3 V = normalize(cameraPosition - vWorld);
          vec3 N = normalize(vec3((n - 0.5) * 0.35, 1.0, (n2 - 0.5) * 0.35));
          vec3 H = normalize(V + normalize(uSunDir));
          float spec = pow(max(dot(N, H), 0.0), 120.0) * (1.0 - uRain) * step(0.0, uSunDir.y);
          col += uSunColor * spec * 1.6;
          float fres = pow(1.0 - max(V.y, 0.0), 4.0);
          col = mix(col, uSkyHorizon, fres * 0.35);
          // Rain rings
          if (uRain > 0.01) {
            vec2 rp = xz * 1.6;
            vec2 cell = floor(rp);
            float ph = fract(uTime * 0.8 + hash12(cell));
            vec2 c = cell + 0.5 + (vec2(hash12(cell + 3.1), hash12(cell + 7.7)) - 0.5) * 0.6;
            float r = length(rp - c);
            float ring = smoothstep(0.05, 0.0, abs(r - ph * 0.55)) * (1.0 - ph);
            col = mix(col, uFoam, ring * uRain * 0.7);
          }
          col *= mix(1.0, 0.22, uNight);
          col += uLightning * 0.25;
          float alpha = clamp(smoothstep(-0.02, 0.35, depth) * 0.82 + foam * 0.5 + 0.1, 0.0, 0.96);
          gl_FragColor = vec4(col, alpha);
          #include <fog_fragment>
        }
      `,
    })
    Object.assign(this.material.uniforms, {
      uTime: U.uTime, uRain: U.uRain, uNight: U.uNight, uLightning: U.uLightning,
      uWaterLevel: { value: WORLD.waterLevel },
      uWaterShallow: U.uWaterShallow, uWaterDeep: U.uWaterDeep, uFoam: U.uFoam,
      uSunDir: U.uSunDir, uSunColor: U.uSunColor, uSkyHorizon: U.uSkyHorizon,
      uHeightTex: U.uHeightTex, uGroundTex: U.uGroundTex,
    })
    this.mesh = new THREE.Mesh(geo, this.material)
    this.mesh.renderOrder = 2
    scene.add(this.mesh)
  }
}
