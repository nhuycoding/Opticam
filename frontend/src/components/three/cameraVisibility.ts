import { Matrix4, PerspectiveCamera, Vector4 } from 'three';
import type { Camera, Layout } from '../../types';
import { cameraProjection } from '../../core/camera';
import { cameraBasis, cameraPose } from './sceneGeometry';
import { pixelsPerMeterAtDistance } from '../../core/optics';

export const MAX_OBSERVATION_CAMERAS = 20;

/** PPM = ppmScale / distance, using the same optical model as the analysis. */
export function cameraImageSettings(camera: Camera) {
  return {
    range: camera.range,
    ppmScale: pixelsPerMeterAtDistance(camera.res, camera.fov, 1)
  };
}

export function observationCamera(camera: Camera, layout: Layout) {
  const projection = cameraProjection(camera), pose = cameraPose(camera, layout);
  const lens = new PerspectiveCamera(projection.vfov, projection.aspect, 0.03, Math.max(0.04, camera.range));
  lens.up.copy(cameraBasis(camera).up);
  lens.position.copy(pose.position);
  lens.lookAt(pose.position.clone().add(pose.direction));
  lens.updateMatrixWorld(true);
  return lens;
}

/** Keep atlas memory bounded as the camera count increases. */
export function visibilityAtlasSize(count: number, maxTextureSize: number) {
  const columns = Math.max(1, Math.ceil(Math.sqrt(count)));
  const rows = Math.max(1, Math.ceil(count / columns));
  const preferred = count === 0 ? 1 : count <= 4 ? 512 : count <= 8 ? 384 : 256;
  const tile = Math.max(1, Math.min(preferred, Math.floor(maxTextureSize / Math.max(columns, rows))));
  return { columns, rows, tile, width: columns * tile, height: rows * tile };
}

export function observationUniforms(camera: Camera, layout: Layout) {
  const lens = observationCamera(camera, layout), settings = cameraImageSettings(camera);
  return {
    lens,
    matrix: new Matrix4().multiplyMatrices(lens.projectionMatrix, lens.matrixWorldInverse),
    positionRange: new Vector4(lens.position.x, lens.position.y, lens.position.z, settings.range),
    image: new Vector4(lens.near, lens.far, settings.ppmScale, 0)
  };
}
