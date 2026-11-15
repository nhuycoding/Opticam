import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  DepthTexture, DoubleSide, HalfFloatType, LinearFilter, Matrix4, MeshDepthMaterial, NearestFilter,
  ShaderMaterial, UnsignedIntType, Vector2, Vector4, WebGLRenderTarget,
  type Object3D, type PerspectiveCamera, type Scene, type WebGLRenderer
} from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import type { Camera, Layout, Person } from '../../types';
import { cameraImageSettings, MAX_OBSERVATION_CAMERAS, observationUniforms, visibilityAtlasSize } from './cameraVisibility';
import { createObservationMaterials } from './ObservationMaterials';
import { DORI_MIN } from '../../core/optics';

const fragmentShader = /* glsl */`
  varying vec2 vUv;
  uniform sampler2D colorMap;
  uniform sampler2D depthMap;
  uniform vec2 resolution;
  uniform mat4 inverseProjection;
  uniform mat4 cameraWorld;
  uniform bool combinedView;
  uniform float povPpmScale;
  uniform float ppmReference;

  vec3 worldAt(vec2 uv, float depth) {
    vec4 position = inverseProjection * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    return (cameraWorld * vec4(position.xyz / position.w, 1.0)).xyz;
  }
  void main() {
    vec4 current = texture2D(colorMap, vUv);
    float depth = texture2D(depthMap, vUv).r;
    // The visibility mask was already evaluated on the physical geometry.
    // Pixel blocks must never extend or move its black boundaries.
    if (combinedView && (current.a <= 0.001 || depth >= 0.999999)) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }
    vec3 world = worldAt(vUv, depth);
    float distance = length(world - cameraWorld[3].xyz);
    float encodedPpm = clamp((current.a - 0.5) * 2.0, 0.0, 0.9999);
    float ppm = combinedView ? ppmReference * encodedPpm / max(0.0001, 1.0 - encodedPpm)
      : povPpmScale / max(0.001, distance);
    // One source-camera pixel spans 1/PPM metres. Convert that physical pitch
    // to the overview/POV display scale, including viewport size and zoom.
    float viewDepth = abs(dot(world - cameraWorld[3].xyz, cameraWorld[2].xyz));
    float metresPerDisplayPixel = 2.0 * viewDepth * inverseProjection[1][1] / resolution.y;
    float block = clamp(floor(1.0 / max(0.000001, ppm * metresPerDisplayPixel) + 0.5), 1.0, max(resolution.x, resolution.y));
    vec2 pixelUv = clamp((floor(vUv * resolution / block) + 0.5) * block / resolution,
      0.5 / resolution, vec2(1.0) - 0.5 / resolution);
    vec4 sampleColor = texture2D(colorMap, pixelUv);
    float sampleDepth = texture2D(depthMap, pixelUv).r;
    vec3 sampleWorld = worldAt(pixelUv, sampleDepth);
    vec3 normal = normalize(cross(dFdx(world), dFdy(world)));
    float planeDistance = abs(dot(sampleWorld - world, normal));
    float tolerance = max(0.012, distance * 0.001);
    if (planeDistance > tolerance || (depth < 0.999999 && sampleDepth >= 0.999999)
      || (combinedView && sampleColor.a <= 0.001)) sampleColor = current;
    gl_FragColor = vec4(sampleColor.rgb, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createCameraImagePipeline(gl: WebGLRenderer, count: number) {
  const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter });
  target.depthTexture = new DepthTexture(1, 1, UnsignedIntType);
  const atlasSize = visibilityAtlasSize(count, gl.capabilities.maxTextureSize);
  const atlas = new WebGLRenderTarget(atlasSize.width, atlasSize.height, { minFilter: NearestFilter, magFilter: NearestFilter });
  atlas.depthTexture = new DepthTexture(atlasSize.width, atlasSize.height, UnsignedIntType);
  const depthMaterial = new MeshDepthMaterial({ side: DoubleSide, colorWrite: false });
  const material = new ShaderMaterial({
    depthTest: false, depthWrite: false,
    uniforms: {
      colorMap: { value: target.texture }, depthMap: { value: target.depthTexture }, observationDepth: { value: atlas.depthTexture },
      resolution: { value: new Vector2(1, 1) }, atlasTexel: { value: new Vector2(1 / atlasSize.width, 1 / atlasSize.height) },
      inverseProjection: { value: new Matrix4() }, cameraWorld: { value: new Matrix4() },
      observationMatrix: { value: Array.from({ length: MAX_OBSERVATION_CAMERAS }, () => new Matrix4()) },
      observationPositionRange: { value: Array.from({ length: MAX_OBSERVATION_CAMERAS }, () => new Vector4()) },
      observationImage: { value: Array.from({ length: MAX_OBSERVATION_CAMERAS }, () => new Vector4()) },
      observationRect: { value: Array.from({ length: MAX_OBSERVATION_CAMERAS }, () => new Vector4()) },
      observationCount: { value: count }, combinedView: { value: false }, povPpmScale: { value: 1 }, ppmReference: { value: DORI_MIN.identification }
    },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader
  });
  const quad = new FullScreenQuad(material);
  const observationMaterials = createObservationMaterials(material.uniforms);
  return {
    target, atlas, atlasSize, depthMaterial, material, quad, observationMaterials, dirty: true,
    dispose() { observationMaterials.dispose(); target.dispose(); atlas.dispose(); depthMaterial.dispose(); material.dispose(); quad.dispose(); }
  };
}

type Pipeline = ReturnType<typeof createCameraImagePipeline>;

/** Capture every physical wall, including walls hidden by the overview cutaway. */
function updateVisibilityAtlas(gl: WebGLRenderer, scene: Scene, layout: Layout, pipeline: Pipeline) {
  const { atlas, atlasSize, material } = pipeline;
  const walls: { object: Object3D; visible: boolean }[] = [];
  scene.traverse(object => {
    if (object.userData.observationWall) {
      walls.push({ object, visible: object.visible }); object.visible = true;
    }
  });
  const override = scene.overrideMaterial, background = scene.background;
  const shadowUpdate = gl.shadowMap.autoUpdate, shadowNeedsUpdate = gl.shadowMap.needsUpdate;
  try {
    scene.overrideMaterial = pipeline.depthMaterial; scene.background = null;
    gl.shadowMap.autoUpdate = false; gl.shadowMap.needsUpdate = false;
    layout.cameras.slice(0, MAX_OBSERVATION_CAMERAS).forEach((camera, index) => {
      const observation = observationUniforms(camera, layout);
      const x = index % atlasSize.columns * atlasSize.tile;
      const y = Math.floor(index / atlasSize.columns) * atlasSize.tile;
      material.uniforms.observationMatrix.value[index].copy(observation.matrix);
      material.uniforms.observationPositionRange.value[index].copy(observation.positionRange);
      material.uniforms.observationImage.value[index].copy(observation.image);
      material.uniforms.observationRect.value[index].set(x / atlas.width, y / atlas.height, atlasSize.tile / atlas.width, atlasSize.tile / atlas.height);
      atlas.viewport.set(x, y, atlasSize.tile, atlasSize.tile);
      atlas.scissor.copy(atlas.viewport); atlas.scissorTest = true;
      gl.setRenderTarget(atlas); gl.clear(); gl.render(scene, observation.lens);
    });
    pipeline.dirty = false;
  } finally {
    scene.overrideMaterial = override; scene.background = background;
    gl.shadowMap.autoUpdate = shadowUpdate; gl.shadowMap.needsUpdate = shadowNeedsUpdate;
    walls.forEach(({ object, visible }) => { object.visible = visible; });
  }
}

export function renderCameraImage(gl: WebGLRenderer, scene: Scene, camera: PerspectiveCamera, pipeline: Pipeline, layout: Layout, cameraView: Camera | null) {
  const previous = gl.getRenderTarget();
  try {
    if (cameraView) pipeline.observationMaterials.dispose();
    else if (pipeline.dirty) {
      pipeline.observationMaterials.sync(scene);
      updateVisibilityAtlas(gl, scene, layout, pipeline);
    }
    camera.updateMatrixWorld();
    const uniforms = pipeline.material.uniforms;
    uniforms.combinedView.value = !cameraView;
    uniforms.inverseProjection.value.copy(camera.projectionMatrixInverse);
    uniforms.cameraWorld.value.copy(camera.matrixWorld);
    if (cameraView) {
      const settings = cameraImageSettings(cameraView);
      uniforms.povPpmScale.value = settings.ppmScale;
    }
    gl.setRenderTarget(pipeline.target); gl.clear(); gl.render(scene, camera);
    gl.setRenderTarget(previous); pipeline.quad.render(gl);
  } finally { gl.setRenderTarget(previous); }
}

/** Depth-tested visible surfaces and fixed distance pixelation, rendered on demand. */
export function CameraImageEffect({ layout, people, cameraView }: { layout: Layout; people: Person[]; cameraView: Camera | null }) {
  const { gl, size, viewport, invalidate } = useThree();
  const pipeline = useRef<Pipeline | null>(null);
  const count = cameraView ? 0 : Math.min(MAX_OBSERVATION_CAMERAS, layout.cameras.length);
  useEffect(() => {
    if (!gl.extensions.has('EXT_color_buffer_float')) return;
    const current = createCameraImagePipeline(gl, count);
    pipeline.current = current; invalidate();
    return () => { pipeline.current = null; current.dispose(); invalidate(); };
  }, [gl, count, invalidate]);
  useEffect(() => {
    const current = pipeline.current;
    if (!current) return;
    const buffer = gl.getDrawingBufferSize(new Vector2());
    const scale = Math.min(1, 1600 / Math.max(buffer.x, buffer.y));
    const width = Math.max(1, Math.round(buffer.x * scale)), height = Math.max(1, Math.round(buffer.y * scale));
    current.target.setSize(width, height);
    current.material.uniforms.resolution.value.set(width, height);
    invalidate();
  }, [gl, size.width, size.height, viewport.dpr, count, invalidate]);
  useEffect(() => {
    if (pipeline.current) pipeline.current.dirty = true;
    invalidate();
  }, [layout.cameras, layout.obstacles, layout.widthM, layout.heightM, layout.floorPolygon, people, cameraView, count, invalidate]);
  useFrame(({ scene, camera }) => {
    if (!pipeline.current) { gl.render(scene, camera); return; }
    renderCameraImage(gl, scene, camera as PerspectiveCamera, pipeline.current, layout, cameraView);
  }, 1);
  return null;
}
