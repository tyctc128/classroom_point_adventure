// Score data layer. The game only talks to the GameStore interface; LocalStore keeps scores in this
// browser, CloudStore (cloud-store.ts) keeps them in Firestore so every browser sees the same thing.
// The local save format stays compatible with the Godot version (version 1).
import { TEAMS } from './teams';

export interface ScoreEvent {
  id: number | string;
  kind: 'score' | 'undo';
  team_id: string;
  delta: number;
  before: number;
  after: number;
  reason: string;
  time: number; // unix seconds
  undone?: boolean;
  source_id?: number | string;
}
export type ChangeEvent =
  | ScoreEvent
  | { kind: 'new_day' }
  | { kind: 'closed' }
  | { kind: 'settings' }
  | { kind: 'world' }
  | { kind: 'auth' };

export interface DayRecord {
  day: string;
  scores: Record<string, number>;
  events?: ScoreEvent[];
  goal: number;
  world?: string;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Daily results are settled at 22:00 Taipei time. */
export const CLOSE_MINUTE = 22 * 60;
const TAIPEI_OFFSET_MS = 8 * 3600 * 1000;

export const WORLD_IDS = ['grassland', 'glacier', 'desert', 'skyland', 'islands'] as const;
export type WorldId = (typeof WORLD_IDS)[number];

export function taipeiParts(ms: number): { day: string; minute: number } {
  const d = new Date(ms + TAIPEI_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    day: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    minute: d.getUTCHours() * 60 + d.getUTCMinutes(),
  };
}

/** Unix ms of 22:00 Taipei on the given day key. */
export function closesAtMs(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d, 22, 0) - TAIPEI_OFFSET_MS;
}

/** The world for a day: pseudo-random but identical on every device, never the same two days running. */
const worldCache = new Map<string, WorldId>();
export function dailyWorld(day: string): WorldId {
  const cached = worldCache.get(day);
  if (cached) return cached;
  const pick = (key: string) => {
    let h = 2166136261;
    for (const ch of key) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995);
    h ^= h >>> 15;
    return (h >>> 0) % WORLD_IDS.length;
  };
  // Walk forward from a fixed epoch so each day knows what the previous day actually showed.
  const epoch = Date.UTC(2026, 0, 1);
  const [y, m, d] = day.split('-').map(Number);
  const target = Date.UTC(y, m - 1, d);
  let prev = -1;
  let result = pick(day);
  for (let t = Math.min(epoch, target); t <= target; t += 86400000) {
    const key = new Date(t).toISOString().slice(0, 10);
    let i = pick(key);
    if (i === prev) i = (i + 1 + (pick(key + '#') % (WORLD_IDS.length - 1))) % WORLD_IDS.length;
    prev = i;
    result = i;
  }
  const world = WORLD_IDS[result];
  worldCache.set(day, world);
  return world;
}

/** Teams ordered by score (ties share a rank). */
export function ranking(scores: Record<string, number>): { id: string; score: number; rank: number }[] {
  const rows = TEAMS.map((t) => ({ id: t.id, score: scores[t.id] ?? 0, rank: 0 })).sort((a, b) => b.score - a.score);
  rows.forEach((r, i) => { r.rank = i > 0 && r.score === rows[i - 1].score ? rows[i - 1].rank : i + 1; });
  return rows;
}

export interface GameStore {
  readonly mode: 'local' | 'cloud';
  scores: Record<string, number>;
  teamNames: Record<string, string>;
  events: ScoreEvent[];
  goal: number;
  day: string;
  closed: boolean;
  world: WorldId;
  /** Whether this browser may change scores (always true locally; signed-in teacher in the cloud). */
  readonly canEdit: boolean;
  onChange(cb: (e: ChangeEvent) => void): void;
  onError(cb: (message: string) => void): void;
  start(): Promise<void>;
  checkClock(ms?: number): void;
  addScore(teamId: string, delta: number, reason?: string): Promise<boolean>;
  undo(): Promise<boolean>;
  canUndo(): boolean;
  setGoal(value: number): void;
  renameTeam(id: string, name: string): void;
  setWorld(id: WorldId): void;
  /** Past days plus today, newest first. */
  history(): Promise<DayRecord[]>;
}

const clampInt = (v: unknown, lo: number, hi: number, fallback: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

export class LocalStore implements GameStore {
  readonly mode = 'local' as const;
  readonly canEdit = true;
  scores: Record<string, number> = {};
  teamNames: Record<string, string> = {};
  events: ScoreEvent[] = [];
  past: DayRecord[] = [];
  goal = 30;
  day = '';
  closed = false;
  world: WorldId = 'grassland';
  serial = 0;
  persistent: boolean;
  private listeners: ((e: ChangeEvent) => void)[] = [];
  private errorListeners: ((message: string) => void)[] = [];

  constructor(
    private readonly storage: StorageLike | null,
    private readonly key = 'classroom-v1',
    private readonly now: () => number = () => Date.now(),
  ) {
    this.persistent = storage !== null;
  }

  onChange(cb: (e: ChangeEvent) => void): void { this.listeners.push(cb); }
  onError(cb: (message: string) => void): void { this.errorListeners.push(cb); }
  private emit(e: ChangeEvent): void { this.listeners.forEach((cb) => cb(e)); }
  private fail(message: string): void { this.errorListeners.forEach((cb) => cb(message)); }

  async start(): Promise<void> {
    for (const team of TEAMS) {
      this.scores[team.id] = 0;
      this.teamNames[team.id] = team.name;
    }
    this.day = taipeiParts(this.now()).day;
    this.world = dailyWorld(this.day);
    if (this.persistent) {
      let raw: string | null = null;
      try { raw = this.storage!.getItem(this.key); } catch { raw = null; }
      if (raw) {
        try {
          this.load(JSON.parse(raw));
        } catch {
          this.fail('無法讀取存檔。已保留原資料，請先備份再重新開始。');
          this.persistent = false;
        }
      }
    }
    this.checkClock();
  }

  private load(data: Record<string, unknown>): void {
    if (!data || data.version !== 1) throw new Error('unsupported save');
    this.day = String(data.day ?? this.day);
    this.goal = clampInt(data.goal, 1, 999, 30);
    this.closed = Boolean(data.closed);
    const scores = (data.scores ?? {}) as Record<string, unknown>;
    const names = (data.team_names ?? {}) as Record<string, unknown>;
    for (const team of TEAMS) {
      this.scores[team.id] = clampInt(scores[team.id], 0, 99999, 0);
      if (typeof names[team.id] === 'string' && (names[team.id] as string).trim()) {
        this.teamNames[team.id] = (names[team.id] as string).slice(0, 12);
      }
    }
    this.events = Array.isArray(data.events) ? (data.events as ScoreEvent[]) : [];
    this.past = Array.isArray(data.history) ? (data.history as DayRecord[]) : [];
    this.serial = clampInt(data.serial, 0, Number.MAX_SAFE_INTEGER, 0);
    this.world = WORLD_IDS.includes(data.world as WorldId) ? (data.world as WorldId) : dailyWorld(this.day);
  }

  checkClock(ms = this.now()): void {
    const { day, minute } = taipeiParts(ms);
    if (day !== this.day) {
      this.archive();
      this.day = day;
      this.events = [];
      this.closed = false;
      this.world = dailyWorld(day);
      for (const id in this.scores) this.scores[id] = 0;
      this.save();
      this.emit({ kind: 'new_day' });
    }
    if (minute >= CLOSE_MINUTE && !this.closed) {
      this.closed = true;
      this.archive();
      this.save();
      this.emit({ kind: 'closed' });
    }
  }

  archive(): void {
    if (this.past.some((r) => r.day === this.day)) return;
    this.past.push({ day: this.day, scores: { ...this.scores }, events: structuredClone(this.events), goal: this.goal, world: this.world });
  }

  async addScore(teamId: string, delta: number, reason = '課堂表現'): Promise<boolean> {
    return this.addScoreSync(teamId, delta, reason);
  }

  addScoreSync(teamId: string, delta: number, reason = '課堂表現'): boolean {
    this.checkClock();
    if (this.closed || !(teamId in this.scores) || !Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 100) return false;
    const before = this.scores[teamId];
    const after = Math.min(99999, Math.max(0, before + delta));
    if (after === before) return false;
    this.serial += 1;
    const event: ScoreEvent = {
      id: this.serial, kind: 'score', team_id: teamId, delta: after - before, before, after,
      reason: reason.trim().slice(0, 80), time: this.now() / 1000, undone: false,
    };
    this.scores[teamId] = after;
    this.events.push(event);
    this.save();
    this.emit(event);
    return true;
  }

  async undo(): Promise<boolean> {
    return this.undoSync();
  }

  /** Undo the most recent score event that has not been undone (across all teams). */
  undoSync(): boolean {
    this.checkClock();
    if (this.closed) return false;
    for (let i = this.events.length - 1; i >= 0; i--) {
      const source = this.events[i];
      if (source.kind !== 'score' || source.undone) continue;
      const id = source.team_id;
      const before = this.scores[id];
      const after = source.before;
      source.undone = true;
      this.scores[id] = after;
      this.serial += 1;
      const event: ScoreEvent = {
        id: this.serial, kind: 'undo', team_id: id, delta: after - before, before, after,
        reason: `撤銷：${source.reason}`, source_id: source.id, time: this.now() / 1000,
      };
      this.events.push(event);
      this.save();
      this.emit(event);
      return true;
    }
    return false;
  }

  canUndo(): boolean {
    return !this.closed && this.events.some((e) => e.kind === 'score' && !e.undone);
  }

  setGoal(value: number): void {
    this.goal = clampInt(value, 1, 999, this.goal);
    this.save();
    this.emit({ kind: 'settings' });
  }

  renameTeam(id: string, name: string): void {
    const trimmed = name.trim();
    if (!(id in this.teamNames) || !trimmed) return;
    this.teamNames[id] = trimmed.slice(0, 12);
    this.save();
    this.emit({ kind: 'settings' });
  }

  setWorld(id: WorldId): void {
    if (id === this.world) return;
    this.world = id;
    this.save();
    this.emit({ kind: 'world' });
  }

  async history(): Promise<DayRecord[]> {
    const today: DayRecord = { day: this.day, scores: { ...this.scores }, goal: this.goal, world: this.world };
    return [today, ...this.past.filter((r) => r.day !== this.day).reverse()];
  }

  snapshot(): Record<string, unknown> {
    return {
      version: 1, roster_revision: 2, day: this.day, goal: this.goal, closed: this.closed, scores: this.scores,
      team_names: this.teamNames, events: this.events, history: this.past, serial: this.serial, world: this.world,
    };
  }

  save(): void {
    if (!this.persistent) return;
    try {
      this.storage!.setItem(this.key, JSON.stringify(this.snapshot()));
    } catch {
      this.fail('分數已更新，但存檔失敗；請先匯出備份。');
    }
  }
}
