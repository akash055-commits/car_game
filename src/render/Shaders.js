// Post-processing shaders: a NaN/Inf guard, separable tilt-shift blur and a final colour grade.

// Runs right after the scene render. Some GPUs turn edge-case shader maths (pow of a
// negative, 0/0, normalize(0), half-float overflow) into NaN or Inf pixels; bloom and the
// blur passes would smear one such pixel into a large black block. Clamp them here.
// (Range tests instead of isnan(): fast-math compilers may fold isnan() away.)
export const SanitizeShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 rgb = c.rgb;
      // NaN fails every comparison; +Inf fails the upper bound
      bool ok = all(lessThan(abs(rgb), vec3(60000.0)));
      rgb = ok ? clamp(rgb, 0.0, 2000.0) : vec3(0.0);
      gl_FragColor = vec4(rgb, 1.0);
    }
  `,
}

export const TiltShiftShader = {
  uniforms: {
    tDiffuse: { value: null },
    uDir: { value: [1, 0] },
    uFocus: { value: 0.52 },
    uRange: { value: 0.32 },
    uAmount: { value: 2.2 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uDir;
    uniform float uFocus, uRange, uAmount;
    varying vec2 vUv;
    void main() {
      float d = abs(vUv.y - uFocus);
      float b = smoothstep(uRange * 0.5, uRange * 0.5 + 0.38, d) * uAmount;
      vec4 sum = texture2D(tDiffuse, vUv) * 0.2270270270;
      vec2 o1 = uDir * b * 1.3846153846;
      vec2 o2 = uDir * b * 3.2307692308;
      sum += texture2D(tDiffuse, vUv + o1) * 0.3162162162;
      sum += texture2D(tDiffuse, vUv - o1) * 0.3162162162;
      sum += texture2D(tDiffuse, vUv + o2) * 0.0702702703;
      sum += texture2D(tDiffuse, vUv - o2) * 0.0702702703;
      gl_FragColor = sum;
    }
  `,
}

export const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uSaturation: { value: 1.08 },
    uContrast: { value: 1.04 },
    uLift: { value: [0.02, 0.01, 0.0] },
    uGain: { value: [1.0, 0.98, 0.95] },
    uVignette: { value: 0.35 },
    uGrain: { value: 0.025 },
    uFlash: { value: 0 },
    uResolution: { value: [1, 1] },
  },
  vertexShader: TiltShiftShader.vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uSaturation, uContrast, uVignette, uGrain, uFlash;
    uniform vec3 uLift, uGain;
    uniform vec2 uResolution;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      c = c * uGain + uLift * (1.0 - c);
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(vec3(l), c, uSaturation);
      c = (c - 0.5) * uContrast + 0.5;
      vec2 q = vUv - 0.5;
      q.x *= uResolution.x / uResolution.y * 0.75;
      float v = smoothstep(0.95, 0.2, length(q));
      c *= mix(1.0, v, uVignette);
      c += (hash(vUv * uResolution + fract(uTime) * 100.0) - 0.5) * uGrain;
      c += uFlash * vec3(0.8, 0.85, 1.0);
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }
  `,
}
