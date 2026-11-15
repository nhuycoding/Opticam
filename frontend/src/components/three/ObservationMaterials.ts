import { CustomBlending, MeshStandardMaterial, NormalBlending, OneFactor, ZeroFactor, type IUniform, type Material, type Mesh, type Scene } from 'three';

const observationShader = /* glsl */`
  varying vec3 observationWorld;
  uniform sampler2D observationDepth;
  uniform vec2 atlasTexel;
  uniform mat4 observationMatrix[20];
  uniform vec4 observationPositionRange[20];
  uniform vec4 observationImage[20];
  uniform vec4 observationRect[20];
  uniform int observationCount;
  uniform bool observationOpaque;
  uniform float ppmReference;

  float observationQuality(vec3 world, vec3 normal) {
    float best = -1.0;
    for (int i = 0; i < 20; i++) {
      if (i >= observationCount) break;
      vec4 pose = observationPositionRange[i];
      vec3 toCamera = pose.xyz - world;
      float distance = length(toCamera);
      if (distance > pose.w || dot(normal, toCamera) <= 0.0) continue;
      mat4 sensor = observationMatrix[i];
      vec4 projected = sensor * vec4(world, 1.0);
      if (projected.w <= 0.0) continue;
      vec3 ndc = projected.xyz / projected.w;
      if (any(greaterThan(abs(ndc), vec3(1.0)))) continue;
      vec4 rect = observationRect[i];
      vec2 uv = rect.xy + (ndc.xy * 0.5 + 0.5) * rect.zw;
      uv = clamp(uv, rect.xy + atlasTexel * 0.5, rect.xy + rect.zw - atlasTexel * 0.5);
      float storedDepth = texture2D(observationDepth, uv).r;
      vec4 image = observationImage[i];
      float capturedDistance = image.x * image.y / (image.y - storedDepth * (image.y - image.x));

      // Evaluate at the fixed CCTV texel centre using the actual surface plane.
      // The observer's orbit camera never participates in this calculation.
      vec2 texelUv = (floor(uv / atlasTexel) + 0.5) * atlasTexel;
      vec2 sensorNdc = ((texelUv - rect.xy) / rect.zw) * 2.0 - 1.0;
      vec3 rowX = vec3(sensor[0][0], sensor[1][0], sensor[2][0]);
      vec3 rowY = vec3(sensor[0][1], sensor[1][1], sensor[2][1]);
      vec3 forward = vec3(sensor[0][3], sensor[1][3], sensor[2][3]);
      vec3 ray = forward + rowX * (sensorNdc.x / dot(rowX, rowX))
        + rowY * (sensorNdc.y / dot(rowY, rowY));
      float denominator = dot(normal, ray);
      if (denominator >= -0.00001) continue;
      float expectedDistance = dot(world - pose.xyz, normal) / denominator;
      float tolerance = max(0.006, min(0.015, projected.w * 0.0008));
      if (expectedDistance > capturedDistance + tolerance) continue;
      float ppm = image.z / max(distance, 0.001);
      best = max(best, ppm);
    }
    return best;
  }
`;

/** Attach the observation mask directly to the physical model's materials. */
export function createObservationMaterials(uniforms: Record<string, IUniform>) {
  const originals = new Map<Material, { compile: Material['onBeforeCompile']; cacheKey: Material['customProgramCacheKey']; blending: Material['blending']; srcAlpha: Material['blendSrcAlpha']; dstAlpha: Material['blendDstAlpha'] }>();
  const restore = (material: Material) => {
    const original = originals.get(material)!;
    material.onBeforeCompile = original.compile;
    material.customProgramCacheKey = original.cacheKey;
    material.blending = original.blending;
    material.blendSrcAlpha = original.srcAlpha;
    material.blendDstAlpha = original.dstAlpha;
    material.needsUpdate = true;
    originals.delete(material);
  };
  return {
    sync(scene: Scene) {
      const current = new Set<Material>();
      scene.traverse(object => {
        const mesh = object as Mesh;
        if (!mesh.isMesh) return;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        materials.forEach(material => { if (material instanceof MeshStandardMaterial) current.add(material); });
      });
      for (const material of originals.keys()) if (!current.has(material)) restore(material);
      current.forEach(material => {
        if (originals.has(material)) return;
        const compile = material.onBeforeCompile, cacheKey = material.customProgramCacheKey;
        const key = cacheKey.call(material);
        originals.set(material, { compile, cacheKey, blending: material.blending, srcAlpha: material.blendSrcAlpha, dstAlpha: material.blendDstAlpha });
        if (material.transparent && material.blending === NormalBlending) {
          // Keep RGB highlight blending while retaining the opaque surface's
          // encoded PPM in alpha, instead of mixing it with highlight opacity.
          material.blending = CustomBlending;
          material.blendSrcAlpha = ZeroFactor;
          material.blendDstAlpha = OneFactor;
        }
        material.onBeforeCompile = (shader, renderer) => {
          compile.call(material, shader, renderer);
          Object.assign(shader.uniforms, uniforms, { observationOpaque: { value: !material.transparent } });
          shader.vertexShader = 'varying vec3 observationWorld;\n' + shader.vertexShader.replace(
            '#include <worldpos_vertex>', /* glsl */`
              #include <worldpos_vertex>
              vec4 observationPosition = vec4(transformed, 1.0);
              #ifdef USE_BATCHING
                observationPosition = batchingMatrix * observationPosition;
              #endif
              #ifdef USE_INSTANCING
                observationPosition = instanceMatrix * observationPosition;
              #endif
              observationWorld = (modelMatrix * observationPosition).xyz;
            `
          );
          shader.fragmentShader = observationShader + shader.fragmentShader.replace(
            '#include <normal_fragment_begin>', /* glsl */`
              #include <normal_fragment_begin>
              vec3 observationNormal = inverseTransformDirection(normal, viewMatrix);
              float surfacePpm = observationQuality(observationWorld, observationNormal);
              if (surfacePpm < 0.0) {
                gl_FragColor = vec4(0.0);
                return;
              }
            `
          ).replace('#include <opaque_fragment>', /* glsl */`
            #include <opaque_fragment>
            // Store positive PPM in the HDR alpha channel without a density cap.
            // Transparent highlights retain their original blending opacity.
            if (observationOpaque) gl_FragColor.a = 0.5 + 0.5 * surfacePpm / (surfacePpm + ppmReference);
          `);
        };
        material.customProgramCacheKey = () => `${key}|opticam-world-observation-ppm`;
        material.needsUpdate = true;
      });
    },
    dispose() { for (const material of originals.keys()) restore(material); }
  };
}
