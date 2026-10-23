/**
 * Final post-processing pass: cyan desaturation while time is slow,
 * chromatic aberration, vignette, red edge glow on damage / low health and
 * faint scanlines.
 */
export const ChronoShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSlow: { value: 0 },
    uDamage: { value: 0 },
    uLowHp: { value: 0 },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uSlow, uDamage, uLowHp, uTime;
    varying vec2 vUv;
    void main() {
      vec2 c = vUv - 0.5;
      float d = length(c);
      float ca = 0.0012 + uDamage * 0.008 + uSlow * 0.0018;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + c * ca).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - c * ca).b;
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, vec3(lum) * vec3(0.7, 1.05, 1.25), uSlow * 0.4);
      float vig = smoothstep(0.9, 0.25, d);
      col *= mix(1.0, vig, 0.45 + uSlow * 0.3);
      float pulse = 0.5 + 0.5 * sin(uTime * 6.0);
      col += vec3(1.0, 0.0, 0.3) * (uDamage * 0.55 + uLowHp * 0.22 * pulse) * smoothstep(0.25, 0.75, d);
      col *= 0.975 + 0.025 * sin(vUv.y * 1100.0);
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
};
