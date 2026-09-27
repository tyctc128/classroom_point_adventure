export interface Team {
  id: string;
  name: string;
  title: string;
  color: string;
  model: string;
  /** Model height in its own units (from the Godot catalog). */
  height: number;
  visualScale?: number;
  move: string;
  celebrate: string;
}

export const TEAMS: Team[] = [
  { id: 'zeus', name: '第一組', title: '宙斯', color: '#e2b43c', model: 'zeus', height: 2.362, move: 'Walk', celebrate: 'Victory' },
  { id: 'monster2', name: '第二組', title: '捲毛怪獸', color: '#a585d6', model: 'monster2', height: 1.829, visualScale: 0.85, move: 'Walk', celebrate: 'Cheer' },
  { id: 'monster', name: '第三組', title: '牛角怪獸', color: '#7fb33f', model: 'monster', height: 2.768, move: 'Walk', celebrate: 'Roar' },
  { id: 'rabbit', name: '第四組', title: '垂耳兔', color: '#f08a54', model: 'rabbit', height: 1.5, move: 'Hop', celebrate: 'Cheer' },
  { id: 'fighter', name: '第五組', title: '戰士', color: '#e0668c', model: 'fighter', height: 3.681, visualScale: 1.1, move: 'Walk', celebrate: 'Guard' },
  { id: 'cat', name: '第六組', title: '小貓', color: '#3fb2d4', model: 'cat', height: 1.72, move: 'Walk', celebrate: 'Wave' },
];

/** Procedural score reactions layered over the supplied clips (ported from the Godot version). */
export const REACTIONS: Record<string, { hops: number; jump: number; turns: number; sway: number; slump: number }> = {
  rabbit: { hops: 3, jump: 0.65, turns: 0, sway: 0.05, slump: 0.1 },
  cat: { hops: 1, jump: 0.55, turns: 1, sway: 0.04, slump: 0.12 },
  zeus: { hops: 1, jump: 0.35, turns: 1, sway: 0.02, slump: 0.08 },
  fighter: { hops: 2, jump: 0.5, turns: 0, sway: 0.1, slump: 0.13 },
  monster: { hops: 2, jump: 0.23, turns: 0, sway: 0.06, slump: 0.06 },
  monster2: { hops: 3, jump: 0.45, turns: 0, sway: 0.18, slump: 0.14 },
};

export const IDLE: Record<string, { period: number; sway: number }> = {
  zeus: { period: 4.0, sway: 0.03 },
  monster2: { period: 2.9, sway: 0.065 },
  monster: { period: 4.3, sway: 0.028 },
  rabbit: { period: 3.1, sway: 0.04 },
  fighter: { period: 3.6, sway: 0.04 },
  cat: { period: 3.3, sway: 0.045 },
};

export const REASONS = ['課堂表現', '合作互助', '主動發言', '完成任務', '秩序與整潔', '分數調整'];
