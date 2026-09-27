import * as THREE from 'three';
import type { WorldId } from '../store';
import type { CameraPose } from '../camera';
import { buildIslandWorld } from './islands';
import { configureTerrain, setSurfaceOverrides } from './layout';
import { GRASSLAND, TERRAIN_THEMES, type TerrainTheme } from './palette';
import { buildBridge, buildCastle, buildMountains, buildSigns } from './props';
import { buildSkyDome, loadPanorama } from './sky';
import { buildSnowfall } from './snow';
import { buildTerrain } from './terrain';
import { buildVegetation } from './vegetation';
import { buildWater, waterUniforms } from './water';

export interface World {
  id: WorldId;
  /** Optional overview framing for this world (default is the shared one). */
  camera?: CameraPose;
  group: THREE.Group;
  update(dt: number, elapsed: number): void;
  dispose(): void;
}

interface Lighting {
  fog: { color: string; near: number; far: number };
  sun: { color: string; intensity: number };
  hemi: { sky: string; ground: string; intensity: number };
  exposure: number;
  /** Sun position (default: upper left). */
  sunFrom?: [number, number, number];
}

const SKYLAND_LIGHT: Lighting = {
  fog: { color: '#e8e4fb', near: 520, far: 3200 },
  sun: { color: '#fff1e0', intensity: 3.4 },
  hemi: { sky: '#e4dcff', ground: '#b9c8a8', intensity: 1.0 },
  exposure: 1.05,
};
const ISLANDS_LIGHT: Lighting = {
  fog: { color: '#bfe6ff', near: 1100, far: 5200 },
  sun: { color: '#fff0d0', intensity: 3.6 },
  hemi: { sky: '#a9dcff', ground: '#e8c89a', intensity: 1.05 },
  exposure: 1.12,
  sunFrom: [220, 170, 90],
};

function addLights(group: THREE.Group, light: Lighting): void {
  group.add(new THREE.HemisphereLight(light.hemi.sky, light.hemi.ground, light.hemi.intensity));
  const sun = new THREE.DirectionalLight(light.sun.color, light.sun.intensity);
  sun.position.set(...(light.sunFrom ?? [-210, 125, 70]));
  sun.target.position.set(10, 0, -30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const sc = sun.shadow.camera;
  sc.left = -230;
  sc.right = 230;
  sc.top = 230;
  sc.bottom = -230;
  sc.near = 10;
  sc.far = 760;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  sun.shadow.radius = 3;
  group.add(sun, sun.target);
}

function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const m of mats) {
      for (const value of Object.values(m)) if (value instanceof THREE.Texture) value.dispose();
      m.dispose();
    }
  });
}

let token = 0;

/** Build one of the five worlds into the scene. Dispose the previous world first. */
export function buildWorld(id: WorldId, scene: THREE.Scene, renderer: THREE.WebGLRenderer, cameraHint: THREE.Vector3): World {
  const myToken = ++token;
  const group = new THREE.Group();
  group.name = `World:${id}`;
  let light: Lighting;
  let islandUpdate: ((elapsed: number) => void) | null = null;
  let cameraPose: CameraPose | undefined;
  const theme: TerrainTheme | undefined = TERRAIN_THEMES[id];

  if (theme) {
    setSurfaceOverrides({});
    configureTerrain({ terraceStep: theme.terrace.step, terraceAmount: theme.terrace.amount, coast: theme.coast });
    light = theme;
    group.add(buildTerrain(theme), buildWater(theme), buildVegetation(theme), buildCastle(theme.castle), buildBridge(), buildSigns(cameraHint), buildMountains(theme.mountains));
  } else {
    configureTerrain({ terraceStep: GRASSLAND.terrace.step, terraceAmount: GRASSLAND.terrace.amount, coast: true });
    const kind = id === 'skyland' ? 'skyland' : 'islands';
    light = kind === 'skyland' ? SKYLAND_LIGHT : ISLANDS_LIGHT;
    const islandWorld = buildIslandWorld(kind, cameraHint);
    islandUpdate = islandWorld.update;
    cameraPose = islandWorld.camera;
    group.add(islandWorld.group);
  }
  addLights(group, light);

  // Sky: the photo panorama for daylight worlds, painted domes for the aurora night and the dreamy sky world.
  scene.background = new THREE.Color(light.fog.color);
  if (id === 'glacier') {
    group.add(buildSkyDome({ top: '#0b1a44', horizon: '#6f9fd6', bottom: '#b8d0e8', aurora: 0.85, stars: 0.9 }, waterUniforms.uTime));
    group.add(buildSnowfall(waterUniforms.uTime));
  } else if (id === 'islands') {
    group.add(buildSkyDome({ top: '#2f86e0', horizon: '#c4ecff', bottom: '#8fd4f2' }, waterUniforms.uTime));
  } else if (id === 'skyland') {
    group.add(buildSkyDome({ top: '#7fa6ff', horizon: '#ffe3f1', bottom: '#fff6fb' }, waterUniforms.uTime));
  } else {
    loadPanorama(scene, 1.9, () => myToken === token);
  }
  scene.fog = new THREE.Fog(light.fog.color, light.fog.near, light.fog.far);
  renderer.toneMappingExposure = light.exposure;
  scene.add(group);
  renderer.shadowMap.needsUpdate = true;

  const flags: THREE.Object3D[] = [];
  group.traverse((o) => { if (o.name === 'Flag') flags.push(o); });

  return {
    id,
    camera: cameraPose,
    group,
    update(_dt, elapsed) {
      waterUniforms.uTime.value = elapsed;
      islandUpdate?.(elapsed);
      flags.forEach((f, i) => { f.rotation.y = Math.sin(elapsed * 2.2 + i) * 0.35; });
    },
    dispose() {
      scene.remove(group);
      disposeTree(group);
      if (scene.background instanceof THREE.Texture) scene.background.dispose();
      scene.background = null;
      setSurfaceOverrides({});
    },
  };
}
