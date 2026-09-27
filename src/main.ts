import * as THREE from 'three';
import './style.css';
import { CameraRig, OVERVIEW } from './camera';
import { Roster } from './characters';
import { cloudConfig, emulatorConfig } from './firebase-config';
import { LocalStore, type ChangeEvent, type GameStore, type WorldId } from './store';
import { TEAMS } from './teams';
import { UI } from './ui';
import { buildWorld, type World } from './world';
import { WORLDS } from './world/themes';
import { PostProcessing } from './post';

const params = new URLSearchParams(location.search);
// ?demo=1 shows sample scores without touching saved data (used for screenshots and previews).
const demo = params.get('demo');
// ?world=desert previews one world regardless of the day's pick (local preview only).
const worldParam = params.get('world') as WorldId | null;

function safeStorage(): Storage | null {
  try {
    const probe = '__probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}

/** Cloud store when configured and reachable, otherwise this browser only. Returns an already-started store. */
async function createStore(): Promise<{ store: GameStore; notice?: string }> {
  const config = params.has('emulator') ? emulatorConfig : cloudConfig;
  if (config && !demo) {
    try {
      const { CloudStore } = await import('./cloud-store');
      const cloud = new CloudStore(config);
      await cloud.start();
      return { store: cloud };
    } catch (err) {
      console.warn('[cloud] falling back to local mode', err);
      const local = new LocalStore(null);
      await local.start();
      return { store: local, notice: '無法連線雲端或統一登入頁，暫時使用本機模式（不會存檔）' };
    }
  }
  const local = new LocalStore(demo ? null : safeStorage());
  await local.start();
  return { store: local };
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 30)));

async function main(): Promise<void> {
  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: params.has('capture') });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const rig = new CameraRig(canvas);
  const post = new PostProcessing(renderer, scene, rig.camera);
  const { store, notice } = await createStore();
  const roster = new Roster();
  scene.add(roster.group);

  const timer = new THREE.Timer();
  timer.connect(document);
  const now = () => timer.getElapsed();

  const failMessage = () => (store.closed ? '今日已結算，明日再一起出發' : '分數未變更（最低為 0 分）');
  const award = async (index: number, delta: number) => {
    if (!store.canEdit) { ui.toast(store.mode === 'cloud' ? '請先以教師帳號登入，才能加扣分' : '無法加扣分'); return; }
    const ok = await store.addScore(TEAMS[index].id, delta, ui.reason);
    if (!ok && store.mode === 'local') ui.toast(failMessage());
  };
  const undo = async () => {
    if (!(await store.undo()) && store.mode === 'local') ui.toast('目前沒有可以撤銷的加扣分');
  };

  const ui = new UI(store, roster, {
    award: (delta) => void award(ui.selected, delta),
    awardTeam: (index, delta) => void award(index, delta),
    undo: () => void undo(),
    focus: (c) => rig.focus(c),
    zoom: (f) => rig.zoom(f),
    bird: () => rig.birdView(),
    reset: () => rig.resetView(),
    follow: () => { rig.setAutoFocus(!rig.followEnabled); return rig.followEnabled; },
    layout: () => applyLayout(),
    chooseWorld: (id) => store.setWorld(id),
  });

  store.onError((m) => ui.toast(m));
  if (notice) ui.toast(notice);
  const debug: Record<string, unknown> = { store, roster, rig, scene, renderer, ui };
  (window as unknown as Record<string, unknown>).__game = debug;
  if (demo && demo !== 'start') {
    [12, 18, 25, 9, 15, 21].forEach((v, i) => { store.scores[TEAMS[i].id] = v; });
    ui.selected = 2;
  }
  if (worldParam && WORLDS.some((w) => w.id === worldParam) && store.mode === 'local') store.world = worldParam;

  // ---- Worlds ----
  let world: World | null = null;
  let worldId: WorldId | null = null;
  let switching: Promise<void> = Promise.resolve();
  const loadWorld = (id: WorldId) => {
    switching = switching.then(async () => {
      if (id === worldId) return;
      const info = WORLDS.find((w) => w.id === id)!;
      ui.showLoading(`正在前往「${info.name}」…`);
      await nextFrame();
      const t0 = performance.now();
      world?.dispose();
      world = buildWorld(id, scene, renderer, OVERVIEW.position);
      worldId = id;
      console.info(`[world] ${id} built in ${Math.round(performance.now() - t0)} ms`);
      ui.setWorld(id);
      rig.setOverview(world.camera);
      roster.characters.forEach((c) => c.setScore(store.scores[c.team.id], store.goal, 0, false, now()));
      roster.update(0, now(), rig.camera);
      rig.resetView();
      ui.finishLoading();
    });
    return switching;
  };

  debug.loadWorld = loadWorld;

  store.onChange((e: ChangeEvent) => {
    if (e.kind === 'score' || e.kind === 'undo') {
      const character = roster.byId(e.team_id);
      character.setScore(store.scores[e.team_id], store.goal, e.delta, true, now());
      ui.popScore(character, e.delta, now());
      ui.bump(e.team_id);
      ui.selected = character.lane;
      ui.toast(`${store.teamNames[e.team_id]}  ${e.delta > 0 ? '+' : ''}${e.delta} · ${e.reason}`);
      if (rig.followEnabled) rig.focus(character);
    } else if (e.kind === 'world') {
      void loadWorld(store.world);
    } else if (e.kind !== 'auth') {
      roster.characters.forEach((c) => c.setScore(store.scores[c.team.id], store.goal, 0, e.kind === 'settings', now()));
      if (e.kind === 'new_day') {
        rig.resetView();
        void loadWorld(store.world);
        ui.toast('新的一天，所有小組從起點出發！');
      } else if (e.kind === 'closed') {
        ui.toast('今日成績已結算，可在「排名」查看，明日 00:00 重新出發');
      }
    }
    ui.render();
  });

  function applyLayout(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    post.setSize(w, h, renderer.getPixelRatio());
    const inset = ui.insets();
    rig.setInsets(inset.right, inset.bottom);
  }
  window.addEventListener('resize', applyLayout);
  applyLayout();
  ui.render();

  // Click a character on the island to open its quick-score bubble; a drag (camera move) does not count.
  let down: { x: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
    const hit = ui.pickCharacter(e.clientX, e.clientY, rig.camera);
    if (hit >= 0) ui.openQuick(hit);
    else ui.closeQuick();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.buttons) return;
    canvas.style.cursor = ui.pickCharacter(e.clientX, e.clientY, rig.camera) >= 0 ? 'pointer' : '';
  });

  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).closest('input, select')) return;
    if (e.key === 'r' || e.key === 'R') rig.resetView();
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !ui.projector) {
      e.preventDefault();
      void undo();
    }
  });

  const t1 = performance.now();
  await Promise.all([roster.load(), loadWorld(store.world)]);
  console.info(`[characters] loaded in ${Math.round(performance.now() - t1)} ms`);
  roster.characters.forEach((c) => c.setScore(store.scores[c.team.id], store.goal, 0, false, 0));
  roster.update(0, 0);
  roster.update(1, 0); // settle formation offsets before first frame
  roster.characters.forEach((c) => c.setRestYaw(OVERVIEW.position));
  ui.render();

  let clockTimer = 0;
  renderer.setAnimationLoop((timestamp) => {
    timer.update(timestamp);
    const dt = Math.min(0.05, timer.getDelta());
    const t = timer.getElapsed();
    clockTimer += dt;
    if (clockTimer > 10) {
      clockTimer = 0;
      store.checkClock();
    }
    roster.characters.forEach((c) => { if (!c.isMoving()) c.setRestYaw(OVERVIEW.position); });
    roster.update(dt, t, rig.camera);
    world?.update(dt, t);
    rig.update(dt);
    post.render();
    ui.updateOverlay(rig.camera, t);
  });
}

main().catch((err) => {
  console.error(err);
  const loading = document.getElementById('loading');
  if (loading) loading.innerHTML = `<p>載入失敗：${String(err?.message ?? err)}</p>`;
});
