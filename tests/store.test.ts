import { describe, expect, it } from 'vitest';
import { closesAtMs, dailyWorld, LocalStore, ranking, StorageLike, taipeiParts, WORLD_IDS } from '../src/store';

class MemoryStorage implements StorageLike {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
}

// 2026-09-27 10:00 Taipei = 02:00 UTC
const MORNING = Date.UTC(2026, 8, 27, 2, 0);
const clock = (start: number) => {
  let t = start;
  return { now: () => t, set: (v: number) => { t = v; } };
};

async function makeStore(start = MORNING, storage: StorageLike | null = null) {
  const c = clock(start);
  const store = new LocalStore(storage, 'test', c.now);
  await store.start();
  return { store, c };
}

describe('time helpers', () => {
  it('uses UTC+8', () => {
    expect(taipeiParts(Date.UTC(2026, 8, 27, 15, 59))).toEqual({ day: '2026-09-27', minute: 23 * 60 + 59 });
    expect(taipeiParts(Date.UTC(2026, 8, 27, 16, 0)).day).toBe('2026-09-28');
  });
  it('closes at 22:00 Taipei', () => {
    expect(closesAtMs('2026-09-27')).toBe(Date.UTC(2026, 8, 27, 14, 0));
  });
});

describe('dailyWorld', () => {
  it('is stable, valid and never repeats on consecutive days', () => {
    expect(dailyWorld('2026-09-27')).toBe(dailyWorld('2026-09-27'));
    const seen = new Set<string>();
    let prev = '';
    for (let d = 1; d <= 60; d++) {
      const day = new Date(Date.UTC(2026, 9, d)).toISOString().slice(0, 10);
      const w = dailyWorld(day);
      expect(WORLD_IDS).toContain(w);
      expect(w).not.toBe(prev);
      prev = w;
      seen.add(w);
    }
    expect(seen.size).toBe(WORLD_IDS.length);
  });
});

describe('ranking', () => {
  it('orders by score and shares ranks on ties', () => {
    const r = ranking({ zeus: 5, monster2: 9, monster: 5, rabbit: 0, fighter: 12, cat: 1 });
    expect(r.map((x) => x.id)).toEqual(['fighter', 'monster2', 'zeus', 'monster', 'cat', 'rabbit']);
    expect(r.map((x) => x.rank)).toEqual([1, 2, 3, 3, 5, 6]);
  });
});

describe('LocalStore', () => {
  it('adds and clamps at zero, recording the real delta', async () => {
    const { store } = await makeStore();
    expect(store.addScoreSync('zeus', 3)).toBe(true);
    expect(store.addScoreSync('zeus', -5)).toBe(true);
    expect(store.scores.zeus).toBe(0);
    expect(store.events[1].delta).toBe(-3);
    expect(store.addScoreSync('zeus', -1)).toBe(false);
  });

  it('rejects invalid deltas and teams', async () => {
    const { store } = await makeStore();
    expect(store.addScoreSync('zeus', 0)).toBe(false);
    expect(store.addScoreSync('zeus', 101)).toBe(false);
    expect(store.addScoreSync('zeus', 1.5)).toBe(false);
    expect(store.addScoreSync('nobody', 1)).toBe(false);
  });

  it('undoes in LIFO order across teams and never twice', async () => {
    const { store } = await makeStore();
    store.addScoreSync('zeus', 3);
    store.addScoreSync('cat', 2);
    store.addScoreSync('zeus', 5);
    expect(store.undoSync()).toBe(true);
    expect(store.scores.zeus).toBe(3);
    expect(store.undoSync()).toBe(true);
    expect(store.scores.cat).toBe(0);
    expect(store.undoSync()).toBe(true);
    expect(store.scores.zeus).toBe(0);
    expect(store.undoSync()).toBe(false);
    expect(store.canUndo()).toBe(false);
  });

  it('settles at 22:00 and blocks changes', async () => {
    const { store, c } = await makeStore();
    store.addScoreSync('rabbit', 4);
    c.set(Date.UTC(2026, 8, 27, 13, 59));
    store.checkClock();
    expect(store.closed).toBe(false);
    c.set(Date.UTC(2026, 8, 27, 14, 0));
    store.checkClock();
    expect(store.closed).toBe(true);
    expect(store.addScoreSync('rabbit', 1)).toBe(false);
    expect(store.undoSync()).toBe(false);
    expect(store.past).toHaveLength(1);
    expect(store.past[0].scores.rabbit).toBe(4);
    store.checkClock();
    expect(store.past).toHaveLength(1);
  });

  it('starts a new day from zero with that day’s world and archives the old one once', async () => {
    const { store, c } = await makeStore();
    store.addScoreSync('cat', 7);
    store.setWorld('desert');
    c.set(Date.UTC(2026, 8, 28, 1, 0));
    const kinds: string[] = [];
    store.onChange((e) => kinds.push(e.kind));
    store.checkClock();
    expect(kinds).toEqual(['new_day']);
    expect(store.day).toBe('2026-09-28');
    expect(store.world).toBe(dailyWorld('2026-09-28'));
    expect(store.scores.cat).toBe(0);
    expect(store.events).toHaveLength(0);
    expect(store.past.map((r) => [r.day, r.world])).toEqual([['2026-09-27', 'desert']]);
    const h = await store.history();
    expect(h.map((r) => r.day)).toEqual(['2026-09-28', '2026-09-27']);
  });

  it('persists and reloads, compatible with the Godot save shape', async () => {
    const storage = new MemoryStorage();
    const { store } = await makeStore(MORNING, storage);
    store.addScoreSync('fighter', 9, '合作互助');
    store.renameTeam('fighter', '閃電隊');
    store.setGoal(40);
    store.setWorld('islands');
    const again = (await makeStore(MORNING, storage)).store;
    expect(again.scores.fighter).toBe(9);
    expect(again.teamNames.fighter).toBe('閃電隊');
    expect(again.goal).toBe(40);
    expect(again.world).toBe('islands');
    expect(again.events[0].reason).toBe('合作互助');
    const saved = JSON.parse(storage.getItem('test')!);
    expect(saved.version).toBe(1);
    expect(saved.team_names.fighter).toBe('閃電隊');
  });

  it('refuses a corrupt save without overwriting it', async () => {
    const storage = new MemoryStorage();
    storage.setItem('test', '{broken');
    const errors: string[] = [];
    const store = new LocalStore(storage, 'test', () => MORNING);
    store.onError((m) => errors.push(m));
    await store.start();
    store.addScoreSync('zeus', 1);
    expect(errors).toHaveLength(1);
    expect(storage.getItem('test')).toBe('{broken');
  });
});
