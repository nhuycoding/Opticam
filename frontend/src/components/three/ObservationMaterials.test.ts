import { describe, expect, it, vi } from 'vitest';
import { BoxGeometry, InstancedMesh, Mesh, MeshBasicMaterial, MeshStandardMaterial, Scene, ShaderLib, UniformsUtils } from 'three';
import { createObservationMaterials } from './ObservationMaterials';

type MaterialShader = Parameters<MeshStandardMaterial['onBeforeCompile']>[0];

describe('world-space observation material lifecycle', () => {
  it('keeps camera uniforms live and restores existing shader hooks when leaving observation mode', () => {
    const surface = new MeshStandardMaterial();
    const originalCompile = vi.fn(); surface.onBeforeCompile = originalCompile;
    const originalKey = () => 'existing-material'; surface.customProgramCacheKey = originalKey;
    const geometry = new BoxGeometry(), scene = new Scene(); scene.add(new Mesh(geometry, surface));
    const uniforms = { observationCount: { value: 3 } };
    const mask = createObservationMaterials(uniforms);
    mask.sync(scene);
    const compile = surface.onBeforeCompile, version = surface.version;
    const shader = { uniforms: UniformsUtils.clone(ShaderLib.standard.uniforms), vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader } as MaterialShader;
    surface.onBeforeCompile(shader, {} as any);
    expect(originalCompile).toHaveBeenCalledOnce();
    expect(shader.uniforms.observationCount).toBe(uniforms.observationCount);
    expect(shader.uniforms.observationOpaque.value).toBe(true);
    expect(surface.customProgramCacheKey()).toContain('existing-material');
    uniforms.observationCount.value = 1;
    mask.sync(scene);
    expect(shader.uniforms.observationCount.value).toBe(1);
    expect(surface.onBeforeCompile).toBe(compile); expect(surface.version).toBe(version);
    mask.dispose();
    expect(surface.onBeforeCompile).toBe(originalCompile); expect(surface.customProgramCacheKey).toBe(originalKey);
    const restoredVersion = surface.version;
    mask.dispose(); expect(surface.version).toBe(restoredVersion);
    surface.dispose(); geometry.dispose();
  });

  it('patches instanced stock, preserves transparent highlights and detaches removed furniture', () => {
    const scene = new Scene(), geometry = new BoxGeometry();
    const surface = new MeshStandardMaterial({ transparent: true, opacity: 0.28 });
    const basic = new MeshBasicMaterial(), originalBasic = basic.onBeforeCompile, originalSurface = surface.onBeforeCompile;
    const stock = new InstancedMesh(geometry, surface, 2); scene.add(stock, new Mesh(geometry, basic));
    const mask = createObservationMaterials({}); mask.sync(scene);
    expect(surface.onBeforeCompile).not.toBe(originalSurface);
    expect(basic.onBeforeCompile).toBe(originalBasic);
    const shader = { uniforms: UniformsUtils.clone(ShaderLib.standard.uniforms), vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader } as MaterialShader;
    surface.onBeforeCompile(shader, {} as any);
    expect(shader.uniforms.observationOpaque.value).toBe(false);
    expect(surface.opacity).toBe(0.28); expect(surface.transparent).toBe(true);
    scene.remove(stock); mask.sync(scene);
    expect(surface.onBeforeCompile).toBe(originalSurface);
    mask.dispose(); geometry.dispose(); surface.dispose(); basic.dispose();
  });
});
