import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { DepthTexture, HalfFloatType, LinearFilter, PerspectiveCamera, ShaderMaterial, UnsignedIntType, Vector2, WebGLRenderTarget } from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

export function povBlurSettings(range: number, strength: number) {
  const distance = Math.max(1, range);
  return { start: Math.min(2.5, distance * 0.25), end: distance, radius: Math.max(0, Math.min(1, strength)) * 6 };
}

const fragmentShader = /* glsl */`
  varying vec2 vUv;
  uniform sampler2D colorMap;
  uniform sampler2D depthMap;
  uniform vec2 texel;
  uniform float nearClip;
  uniform float farClip;
  uniform float blurStart;
  uniform float blurEnd;
  uniform float maxRadius;
  #include <packing>

  float distanceAt(vec2 uv) {
    return -perspectiveDepthToViewZ(texture2D(depthMap, uv).x, nearClip, farClip);
  }
  void main() {
    float distance = distanceAt(vUv);
    float radius = smoothstep(blurStart, blurEnd, distance) * maxRadius;
    vec4 sum = texture2D(colorMap, vUv);
    float total = 1.0;
    if (radius > 0.1) {
      for (int i = 0; i < 8; i++) {
        float angle = float(i) * 0.785398163;
        vec2 uv = clamp(vUv + vec2(cos(angle), sin(angle)) * texel * radius, vec2(0.0), vec2(1.0));
        float sampleDistance = distanceAt(uv);
        // Keep foreground silhouettes from bleeding into the distant image.
        float weight = step(distance - max(0.3, distance * 0.04), sampleDistance);
        sum += texture2D(colorMap, uv) * weight;
        total += weight;
      }
    }
    gl_FragColor = sum / total;
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** One scene render and a bounded nine-tap depth-aware pass, active only in POV. */
export function PovDistanceBlur({ range, strength }: { range: number; strength: number }) {
  const { gl, size, viewport, invalidate } = useThree();
  const pipeline = useRef<{ target: WebGLRenderTarget; material: ShaderMaterial; quad: FullScreenQuad } | null>(null);
  useEffect(() => {
    // Preserve the normal HDR/tone-mapping path when float targets are unavailable.
    if (!gl.extensions.has('EXT_color_buffer_float')) return;
    const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: true });
    target.depthTexture = new DepthTexture(1, 1, UnsignedIntType);
    const material = new ShaderMaterial({
      depthTest: false, depthWrite: false,
      uniforms: {
        colorMap: { value: target.texture }, depthMap: { value: target.depthTexture }, texel: { value: new Vector2() },
        nearClip: { value: 0.03 }, farClip: { value: 100 }, blurStart: { value: 2 }, blurEnd: { value: 10 }, maxRadius: { value: 4 }
      },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader
    });
    const quad = new FullScreenQuad(material);
    pipeline.current = { target, material, quad };
    invalidate();
    return () => { pipeline.current = null; target.dispose(); material.dispose(); quad.dispose(); invalidate(); };
  }, [gl, invalidate]);

  useEffect(() => {
    const current = pipeline.current;
    if (!current) return;
    const buffer = gl.getDrawingBufferSize(new Vector2());
    const scale = Math.min(1, 1600 / Math.max(buffer.x, buffer.y));
    const width = Math.max(1, Math.round(buffer.x * scale)), height = Math.max(1, Math.round(buffer.y * scale));
    current.target.setSize(width, height);
    current.material.uniforms.texel.value.set(1 / width, 1 / height);
    invalidate();
  }, [gl, size.width, size.height, viewport.dpr, invalidate]);
  useEffect(() => { invalidate(); }, [range, strength, invalidate]);

  useFrame(({ scene, camera }) => {
    const current = pipeline.current;
    if (!current) { gl.render(scene, camera); return; }
    const settings = povBlurSettings(range, strength), lens = camera as PerspectiveCamera;
    const uniforms = current.material.uniforms;
    uniforms.nearClip.value = lens.near; uniforms.farClip.value = lens.far;
    uniforms.blurStart.value = settings.start; uniforms.blurEnd.value = settings.end; uniforms.maxRadius.value = settings.radius;
    const previous = gl.getRenderTarget();
    try {
      gl.setRenderTarget(current.target); gl.clear(); gl.render(scene, camera);
      gl.setRenderTarget(previous); current.quad.render(gl);
    } finally { gl.setRenderTarget(previous); }
  }, 1);
  return null;
}
