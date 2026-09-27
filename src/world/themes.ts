import type { WorldId } from '../store';

export interface WorldInfo {
  id: WorldId;
  name: string;
  eyebrow: string;
  tagline: string;
  swatch: string;
}

/** The five worlds from 04_五種寬闊場景概念圖.png. */
export const WORLDS: WorldInfo[] = [
  { id: 'grassland', name: '遼闊草原', eyebrow: 'WORLD 01 / GRASSLAND', tagline: '遼闊草原 · 每一分，都是團隊的進步', swatch: '#6cb43d' },
  { id: 'glacier', name: '極地冰河', eyebrow: 'WORLD 02 / GLACIER', tagline: '冰雪大地與極光 · 一起穿越冰原', swatch: '#8fd0f0' },
  { id: 'desert', name: '沙漠峽谷', eyebrow: 'WORLD 03 / CANYON', tagline: '紅岩峽谷 · 一步一步向前', swatch: '#d9743a' },
  { id: 'skyland', name: '漂浮島嶼', eyebrow: 'WORLD 04 / FLOATING ISLANDS', tagline: '雲海上的空中小島 · 跨過每一座橋', swatch: '#b9a6f0' },
  { id: 'islands', name: '寧靜海島', eyebrow: 'WORLD 05 / ISLANDS', tagline: '碧海藍天 · 跳過一座座小島', swatch: '#27b7c9' },
];
