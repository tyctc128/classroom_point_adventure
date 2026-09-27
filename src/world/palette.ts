// Visual parameters for the height-field worlds (grassland, glacier, desert). The shape of the race
// route is shared, so characters behave identically; everything you see is restyled per world.
import type { WorldId } from '../store';

export interface TerrainTheme {
  id: WorldId;
  terrace: { step: number; amount: number };
  /** Land falls to the sea on the horizon. */
  coast: boolean;
  ground: { sun: string; mid: string; deep: string; dry: string };
  rock: { light: string; mid: string; dark: string };
  path: { core: string; edge: string };
  trail: string;
  sand: string;
  wetSand: string;
  bed: string;
  pebble: string;
  water: { lakeDeep: string; lakeShallow: string; riverDeep: string; riverShallow: string; seaDeep: string; seaShallow: string; sky: string };
  /** Show rivers, creek and waterfall (false = dry canyons). */
  flowingWater: boolean;
  fog: { color: string; near: number; far: number };
  sun: { color: string; intensity: number };
  hemi: { sky: string; ground: string; intensity: number };
  exposure: number;
  mountains: string[];
  castle: { wall: string; shade: string; roof: string; dark: string; stone: string; flag: string; emissive?: string };
  flowers: string[];
}

export const GRASSLAND: TerrainTheme = {
  id: 'grassland',
  terrace: { step: 4.2, amount: 0.78 },
  coast: true,
  ground: { sun: '#9fd34f', mid: '#6cb43d', deep: '#3f8c34', dry: '#b9cf5a' },
  rock: { light: '#d6c6a6', mid: '#a08d74', dark: '#6f6353' },
  path: { core: '#e3c083', edge: '#c99f62' },
  trail: '#d6b073',
  sand: '#d8c38e',
  wetSand: '#b7a57a',
  bed: '#8a8f6a',
  pebble: '#b9b09a',
  water: { lakeDeep: '#1560b8', lakeShallow: '#3fa9d6', riverDeep: '#1f86b8', riverShallow: '#63d0dc', seaDeep: '#1765c4', seaShallow: '#4fc0e0', sky: '#bfe3ff' },
  flowingWater: true,
  fog: { color: '#d3e8f6', near: 420, far: 2400 },
  sun: { color: '#ffecc8', intensity: 3.7 },
  hemi: { sky: '#d4e9ff', ground: '#5d8a3c', intensity: 0.8 },
  exposure: 1.05,
  mountains: ['#7f9fc0', '#8eabc9', '#7393b6'],
  castle: { wall: '#f4efe4', shade: '#ddd4c3', roof: '#e0663c', dark: '#4a4e63', stone: '#b3a58f', flag: '#ffd35a' },
  flowers: ['#ffffff', '#ffe46b', '#ffb3c7', '#ffffff', '#fff3a8'],
};

export const GLACIER: TerrainTheme = {
  id: 'glacier',
  terrace: { step: 5.2, amount: 0.9 },
  coast: true,
  ground: { sun: '#f7fbff', mid: '#e3eef7', deep: '#c6d9ea', dry: '#ffffff' },
  rock: { light: '#d9f1ff', mid: '#9fd2f0', dark: '#5f9fcf' },
  path: { core: '#cfe0ec', edge: '#a9c3d8' },
  trail: '#d7e6f1',
  sand: '#e8f4fb',
  wetSand: '#b9d6ea',
  bed: '#7eaed0',
  pebble: '#c9dcea',
  water: { lakeDeep: '#0f3f7a', lakeShallow: '#3d8fc4', riverDeep: '#164f8e', riverShallow: '#5aa9d8', seaDeep: '#0b2f63', seaShallow: '#3a7fb8', sky: '#9fc8ea' },
  flowingWater: true,
  fog: { color: '#b8d0e8', near: 380, far: 2200 },
  sun: { color: '#e6f1ff', intensity: 2.9 },
  hemi: { sky: '#bcd8ff', ground: '#8aa6c8', intensity: 1.1 },
  exposure: 0.95,
  mountains: ['#dcecf8', '#c7dff2', '#e9f3fb'],
  castle: { wall: '#d8f1ff', shade: '#a9dcf5', roof: '#6cc6ef', dark: '#3a6fa6', stone: '#bcd8ea', flag: '#9ff0ff', emissive: '#3aa8e0' },
  flowers: ['#e8fbff', '#bfefff', '#ffffff', '#d8f4ff'],
};

export const DESERT: TerrainTheme = {
  id: 'desert',
  terrace: { step: 6.5, amount: 0.93 },
  coast: false,
  ground: { sun: '#eea463', mid: '#dc874a', deep: '#bf6636', dry: '#f3be80' },
  rock: { light: '#ec8f5a', mid: '#c65a31', dark: '#8f3a1f' },
  path: { core: '#f7d9a4', edge: '#e8b877' },
  trail: '#f1cc92',
  sand: '#f3cf94',
  wetSand: '#c9965f',
  bed: '#b77443',
  pebble: '#d9a877',
  water: { lakeDeep: '#138a9a', lakeShallow: '#4fd0c8', riverDeep: '#1b8fa0', riverShallow: '#66d6cf', seaDeep: '#138a9a', seaShallow: '#4fd0c8', sky: '#cfe7ff' },
  flowingWater: false,
  fog: { color: '#f4dcc0', near: 380, far: 2300 },
  sun: { color: '#fff0d0', intensity: 3.9 },
  hemi: { sky: '#cfe4ff', ground: '#b8703d', intensity: 0.85 },
  exposure: 1.05,
  mountains: ['#d98a5a', '#c7774c', '#e4a077'],
  castle: { wall: '#ecc08a', shade: '#d49c61', roof: '#b4532c', dark: '#5e3420', stone: '#c98552', flag: '#ffda6b' },
  flowers: ['#ffe07a', '#ff9f6b', '#fff0b0'],
};

export const TERRAIN_THEMES: Partial<Record<WorldId, TerrainTheme>> = { grassland: GRASSLAND, glacier: GLACIER, desert: DESERT };
