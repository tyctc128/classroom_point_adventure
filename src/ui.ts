import * as THREE from 'three';
import type { Roster, TeamCharacter } from './characters';
import { dailyWorld, ranking, type DayRecord, type GameStore, type WorldId } from './store';
import { WORLDS } from './world/themes';
import { REASONS, TEAMS } from './teams';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function darken(hex: string, k: number): string {
  const c = new THREE.Color(hex).multiplyScalar(k);
  return `#${c.getHexString()}`;
}

interface Pop { el: HTMLElement; character: TeamCharacter; start: number }

export class UI {
  selected = 0;
  projector = false;
  private cards: HTMLElement[] = [];
  private tags: HTMLElement[] = [];
  private pops: Pop[] = [];
  private tagPos: ({ x: number; y: number } | null)[] = TEAMS.map(() => null);
  private tagSlot: number[] = TEAMS.map(() => 0);
  private toastTimer = 0;
  /** Team whose quick-score bubble is open (-1 = closed). */
  private quickTeam = -1;
  private quickTimer = 0;
  private readonly quick: HTMLElement;
  private readonly tmp = new THREE.Vector3();

  constructor(
    private readonly store: GameStore,
    private readonly roster: Roster,
    private readonly handlers: {
      award(delta: number): void;
      awardTeam(index: number, delta: number): void;
      undo(): void;
      focus(c: TeamCharacter): void;
      zoom(f: number): void;
      bird(): void;
      reset(): void;
      follow(): boolean;
      layout(): void;
      chooseWorld(id: WorldId): void;
    },
  ) {
    this.buildCards();
    this.buildTags();
    this.quick = this.buildQuick();
    const reason = $<HTMLSelectElement>('reason');
    REASONS.forEach((r) => reason.add(new Option(r, r)));
    document.querySelectorAll<HTMLButtonElement>('[data-delta]').forEach((b) =>
      b.addEventListener('click', () => handlers.award(Number(b.dataset.delta))),
    );
    $('apply').addEventListener('click', () => {
      const input = $<HTMLInputElement>('custom');
      const v = Math.round(Number(input.value));
      if (!Number.isFinite(v) || v === 0 || Math.abs(v) > 100) {
        this.toast('自訂分數範圍為 −100 到 100，且不能為 0');
        return;
      }
      handlers.award(v);
    });
    $('undo').addEventListener('click', () => handlers.undo());
    $('zoom-in').addEventListener('click', () => handlers.zoom(0.72));
    $('zoom-out').addEventListener('click', () => handlers.zoom(1.38));
    $('bird').addEventListener('click', () => handlers.bird());
    $('reset').addEventListener('click', () => handlers.reset());
    $('follow').addEventListener('click', (e) => {
      (e.currentTarget as HTMLElement).textContent = handlers.follow() ? '自動聚焦：開' : '自動聚焦：關';
    });
    $('fullscreen').addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen?.();
    });
    $('projector').addEventListener('click', () => this.toggleProjector());
    this.buildWorldMenu();
    $('rank-btn').addEventListener('click', () => void this.openRanking());
    $('rank-close').addEventListener('click', () => { $('rank-dialog').hidden = true; });
    $('rank-dialog').addEventListener('click', (e) => { if (e.target === e.currentTarget) $('rank-dialog').hidden = true; });
  }

  // ---- Worlds ----
  private buildWorldMenu(): void {
    const menu = $('world-menu');
    $('world-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this.renderWorldMenu();
      menu.classList.toggle('open');
    });
    document.addEventListener('click', () => menu.classList.remove('open'));
  }

  private renderWorldMenu(): void {
    const menu = $('world-menu');
    const today = dailyWorld(this.store.day);
    menu.innerHTML = '';
    for (const w of WORLDS) {
      const b = document.createElement('button');
      b.className = w.id === this.store.world ? 'active' : '';
      b.innerHTML = `<span class="sw" style="background:${w.swatch}"></span>${w.name}${w.id === today ? '<span class="today">今日抽選</span>' : ''}`;
      b.addEventListener('click', () => {
        menu.classList.remove('open');
        if (this.store.mode === 'cloud' && !this.store.canEdit) this.toast('只在這台電腦預覽；教師登入後切換才會同步到所有畫面');
        this.handlers.chooseWorld(w.id);
      });
      menu.appendChild(b);
    }
  }

  setWorld(id: WorldId): void {
    const w = WORLDS.find((x) => x.id === id)!;
    $('world-name').textContent = w.name;
    $('world-eyebrow').textContent = w.eyebrow;
    $('world-tagline').textContent = w.tagline;
  }

  // ---- Daily ranking ----
  private days: DayRecord[] = [];

  async openRanking(): Promise<void> {
    const dialog = $('rank-dialog');
    const select = $<HTMLSelectElement>('rank-day');
    dialog.hidden = false;
    $('rank-list').innerHTML = '<li style="--team:#ccc">讀取中…</li>';
    try {
      this.days = await this.store.history();
    } catch (err) {
      $('rank-list').innerHTML = `<li style="--team:#c55">無法讀取排名：${(err as Error).message}</li>`;
      return;
    }
    select.innerHTML = '';
    this.days.forEach((d, i) => {
      const label = d.day === this.store.day ? `${d.day}（今天${this.store.closed ? '・已結算' : '・進行中'}）` : d.day;
      select.add(new Option(label, String(i)));
    });
    select.onchange = () => this.renderRanking(Number(select.value));
    this.renderRanking(0);
  }

  private renderRanking(index: number): void {
    const record = this.days[index];
    if (!record) return;
    const live = record.day === this.store.day;
    const scores = live ? this.store.scores : record.scores;
    const world = WORLDS.find((w) => w.id === record.world);
    $('rank-note').textContent = `${world ? `世界：${world.name} · ` : ''}目標 ${record.goal} 分 · ${live && !this.store.closed ? '22:00 結算，目前為即時名次' : '22:00 結算結果'}`;
    const medals = ['🥇', '🥈', '🥉'];
    $('rank-list').innerHTML = '';
    for (const row of ranking(scores)) {
      const team = TEAMS.find((t) => t.id === row.id)!;
      const li = document.createElement('li');
      li.style.setProperty('--team', team.color);
      li.innerHTML = `<span class="medal">${row.score > 0 ? medals[row.rank - 1] ?? row.rank : row.rank}</span><span class="nm">${this.store.teamNames[team.id]}<small>${team.title}${row.score >= record.goal ? ' · 已抵達終點' : ''}</small></span><span class="pts">${row.score}</span>`;
      $('rank-list').appendChild(li);
    }
  }

  // ---- Teacher sign-in (cloud mode) ----
  private renderAuth(): void {
    const box = $('auth');
    const hint = $('mode-hint');
    if (this.store.mode === 'local') {
      box.innerHTML = '';
      hint.innerHTML = '本機模式 · 成績只存在這台裝置';
      document.body.classList.remove('viewer');
      return;
    }
    type Cloud = GameStore & { user: { uid: string } | null; signIn(): Promise<void>; signOut(): Promise<void>; displayName(): Promise<string> };
    const cloud = this.store as Cloud;
    const signedIn = !!cloud.user;
    // Only teachers see the scoring desk; everyone else just watches the island.
    const viewer = !this.store.canEdit;
    if (document.body.classList.contains('viewer') !== viewer) {
      document.body.classList.toggle('viewer', viewer);
      if (viewer) this.closeQuick();
      this.handlers.layout();
    }
    const key = `${cloud.user?.uid ?? ''}|${this.store.canEdit}`;
    if (box.dataset.key !== key) {
      box.dataset.key = key;
      box.innerHTML = signedIn
        ? `<span class="who"></span><button class="btn soft" id="auth-btn">登出</button>`
        : '<button class="btn dark" id="auth-btn">教師登入</button>';
      if (signedIn) {
        void cloud.displayName().then((name) => {
          const who = box.querySelector('.who');
          if (who) who.textContent = this.store.canEdit ? `${name} 老師` : `${name}（無教師權限）`;
        });
      }
      $('auth-btn').addEventListener('click', () => {
        const action = signedIn ? cloud.signOut() : cloud.signIn();
        action.catch((err: Error) => this.toast(`登入失敗：${err.message}`));
      });
    }
    hint.innerHTML = '雲端同步 · 所有畫面即時看到相同結果<br />每天 22:00 自動結算';
  }

  get reason(): string {
    return $<HTMLSelectElement>('reason').value;
  }

  toggleProjector(): void {
    this.projector = !this.projector;
    document.body.classList.toggle('projector', this.projector);
    $('projector').textContent = this.projector ? '顯示教師操作' : '投影模式';
    this.handlers.layout();
  }

  private buildCards(): void {
    const host = $('cards');
    TEAMS.forEach((team, i) => {
      const card = document.createElement('div');
      card.className = 'card';
      card.style.setProperty('--team', team.color);
      card.innerHTML = `<div class="name"></div><div class="score">0</div><div class="bar"><i></i></div><div class="sub"></div>`;
      card.addEventListener('click', () => this.select(i));
      card.addEventListener('dblclick', () => this.handlers.focus(this.roster.characters[i]));
      host.appendChild(card);
      this.cards.push(card);
    });
  }

  private buildTags(): void {
    const host = $('labels');
    TEAMS.forEach((team, i) => {
      const tag = document.createElement('div');
      tag.className = 'tag';
      tag.style.setProperty('--team', team.color);
      tag.style.setProperty('--team-ink', darken(team.color, 0.62));
      tag.innerHTML = `<span class="dot">${i + 1}</span><span class="nm"></span><span class="pts"></span>`;
      tag.title = '點一下為這組加扣分';
      tag.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openQuick(i);
      });
      host.appendChild(tag);
      this.tags.push(tag);
    });
  }

  /** Floating bubble with quick score buttons that follows the chosen character. */
  private buildQuick(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'quick-pop';
    el.innerHTML = `<div class="qp-head"><span class="qp-dot"></span><span class="qp-name"></span><button class="qp-close" aria-label="關閉">×</button></div>
<div class="qp-btns">${[1, 2, 3, 5].map((d) => `<button class="btn dark" data-q="${d}">＋${d}</button>`).join('')}<button class="btn soft" data-q="-1">－1</button></div>`;
    el.querySelectorAll<HTMLButtonElement>('[data-q]').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.quickTeam < 0) return;
        this.handlers.awardTeam(this.quickTeam, Number(b.dataset.q));
        this.armQuickTimer();
      }),
    );
    el.querySelector('.qp-close')!.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeQuick();
    });
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    document.body.appendChild(el);
    return el;
  }

  openQuick(i: number): void {
    if (!this.store.canEdit) { this.select(i); return; }
    this.quickTeam = i;
    this.select(i);
    const team = TEAMS[i];
    this.quick.style.setProperty('--team', team.color);
    (this.quick.querySelector('.qp-name') as HTMLElement).textContent = `${this.store.teamNames[team.id]} · ${team.title}`;
    this.quick.classList.add('show');
    this.armQuickTimer();
  }

  closeQuick(): void {
    this.quickTeam = -1;
    this.quick.classList.remove('show');
  }

  private armQuickTimer(): void {
    clearTimeout(this.quickTimer);
    this.quickTimer = window.setTimeout(() => this.closeQuick(), 8000);
  }

  /** Which character (if any) is under a screen point: tests a box from its feet to its head. */
  pickCharacter(clientX: number, clientY: number, camera: THREE.Camera): number {
    const w = window.innerWidth;
    const h = window.innerHeight;
    // Among figures whose body box contains the point, take the one whose body centre is closest.
    let best = -1;
    let bestScore = Infinity;
    this.roster.characters.forEach((c, i) => {
      const foot = c.root.position.clone().project(camera);
      const head = c.labelAnchor(new THREE.Vector3()).project(camera);
      if (foot.z > 1) return;
      const fx = (foot.x * 0.5 + 0.5) * w;
      const fy = (-foot.y * 0.5 + 0.5) * h;
      const hy = (-head.y * 0.5 + 0.5) * h;
      const half = Math.max(22, (fy - hy) * 0.38);
      if (clientX < fx - half || clientX > fx + half || clientY < hy - 6 || clientY > fy + 10) return;
      const score = Math.abs(clientX - fx) / half + Math.abs(clientY - (fy + hy) / 2) / Math.max(20, (fy - hy) / 2) + foot.z * 0.01;
      if (score < bestScore) {
        best = i;
        bestScore = score;
      }
    });
    return best;
  }

  select(i: number): void {
    this.selected = i;
    this.render();
  }

  render(): void {
    const s = this.store;
    $('date').textContent = s.day.replaceAll('-', ' / ');
    $('goal').textContent = `目標 ${s.goal} 分 · ${s.closed ? '今日已結算' : '6 組同行'}`;
    const team = TEAMS[this.selected];
    const score = s.scores[team.id];
    $('sel-swatch').style.background = team.color;
    $('sel-name').textContent = `${s.teamNames[team.id]} / ${team.title}`;
    $('sel-score').textContent = String(score);
    const remaining = Math.max(0, s.goal - score);
    $('sel-sub').textContent = remaining === 0 ? `已抵達終點！額外 ${score - s.goal} 分` : `再 ${remaining} 分，就能抵達終點`;
    TEAMS.forEach((t, i) => {
      const card = this.cards[i];
      const v = s.scores[t.id];
      card.classList.toggle('selected', i === this.selected);
      (card.querySelector('.name') as HTMLElement).textContent = s.teamNames[t.id];
      (card.querySelector('.score') as HTMLElement).textContent = String(v);
      (card.querySelector('.bar i') as HTMLElement).style.width = `${Math.min(100, (v / s.goal) * 100)}%`;
      (card.querySelector('.sub') as HTMLElement).textContent = v >= s.goal ? `已達標 +${v - s.goal}` : t.title;
      (this.tags[i].querySelector('.nm') as HTMLElement).textContent = s.teamNames[t.id];
      (this.tags[i].querySelector('.pts') as HTMLElement).textContent = String(v);
    });
    $<HTMLButtonElement>('undo').disabled = !s.canUndo();
    const locked = s.closed || !s.canEdit;
    document.querySelectorAll<HTMLButtonElement>('[data-delta], #apply, .quick-pop [data-q]').forEach((b) => { b.disabled = locked; });
    this.renderAuth();
  }

  bump(teamId: string): void {
    const i = TEAMS.findIndex((t) => t.id === teamId);
    const card = this.cards[i];
    card.classList.remove('bump');
    void card.offsetWidth;
    card.classList.add('bump');
  }

  toast(message: string): void {
    const el = $('toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => el.classList.remove('show'), 3200);
  }

  popScore(character: TeamCharacter, delta: number, now: number): void {
    const el = document.createElement('div');
    el.className = `pop${delta < 0 ? ' neg' : ''}`;
    el.textContent = `${delta > 0 ? '+' : ''}${delta}`;
    $('labels').appendChild(el);
    this.pops.push({ el, character, start: now });
  }

  /** Project name tags every frame; nudge overlapping tags upward so every team stays readable. */
  updateOverlay(camera: THREE.Camera, now: number): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    const items = this.roster.characters.map((c, i) => {
      c.labelAnchor(this.tmp);
      const p = this.tmp.clone().project(camera);
      return { c, i, p, depth: p.z };
    });
    // Fixed order (group number) keeps placement stable from frame to frame.
    items.sort((a, b) => a.i - b.i);
    for (const { i, p } of items) {
      const tag = this.tags[i];
      const visible = p.z < 1 && p.x > -1.1 && p.x < 1.1 && p.y > -1.1 && p.y < 1.1;
      tag.style.display = visible ? 'flex' : 'none';
      if (!visible) { this.tagPos[i] = null; continue; }
      const tw = tag.offsetWidth;
      const th = tag.offsetHeight;
      const x0 = (p.x * 0.5 + 0.5) * w - tw / 2;
      const y0 = (-p.y * 0.5 + 0.5) * h - th - 6;
      // Try the natural spot, then small sideways shifts, then stack upward.
      const dx = tw * 0.55 + 2;
      const dy = th + 4;
      const candidates = [[0, 0], [-dx, 0], [dx, 0], [0, -dy], [-dx, -dy], [dx, -dy], [0, -2 * dy], [-dx, -2 * dy], [dx, -2 * dy], [0, -3 * dy]];
      const hits = (x: number, y: number) => placed.some((r) => x < r.x + r.w + 4 && x + tw + 4 > r.x && y < r.y + r.h + 3 && y + th + 3 > r.y);
      // Keep last frame's slot while it is still free, so tags do not flicker between spots.
      let slot = this.tagSlot[i];
      if (hits(x0 + candidates[slot][0], y0 + candidates[slot][1]) || (slot > 0 && !hits(x0, y0))) {
        const free = candidates.findIndex(([cx, cy]) => !hits(x0 + cx, y0 + cy));
        slot = free < 0 ? candidates.length - 1 : free;
      }
      this.tagSlot[i] = slot;
      const [ox, oy] = candidates[slot];
      const x = x0 + ox;
      const y = y0 + oy;
      placed.push({ x, y, w: tw, h: th });
      // Glide to the new spot instead of jumping when tags rearrange.
      const prev = this.tagPos[i];
      const gx = prev ? prev.x + (x - prev.x) * 0.35 : x;
      const gy = prev ? prev.y + (y - prev.y) * 0.35 : y;
      this.tagPos[i] = { x: gx, y: gy };
      tag.style.transform = `translate(${gx.toFixed(1)}px, ${gy.toFixed(1)}px)`;
      tag.style.zIndex = String(100 - Math.round(p.z * 50));
    }
    if (this.quickTeam >= 0) {
      const pos = this.tagPos[this.quickTeam];
      if (pos) {
        const tag = this.tags[this.quickTeam];
        const qx = pos.x + tag.offsetWidth / 2 - this.quick.offsetWidth / 2;
        const qy = pos.y - this.quick.offsetHeight - 10;
        const cx = Math.min(w - this.quick.offsetWidth - 12, Math.max(12, qx));
        const cy = Math.max(96, qy);
        this.quick.style.transform = `translate(${cx.toFixed(1)}px, ${cy.toFixed(1)}px)`;
      }
    }
    this.pops = this.pops.filter((pop) => {
      const t = (now - pop.start) / 1.6;
      if (t >= 1) {
        pop.el.remove();
        return false;
      }
      pop.character.labelAnchor(this.tmp);
      this.tmp.y += 1.2 + t * 2.4;
      const p = this.tmp.project(camera);
      const x = (p.x * 0.5 + 0.5) * w;
      const y = (-p.y * 0.5 + 0.5) * h;
      pop.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${0.8 + Math.min(1, t * 5) * 0.4})`;
      pop.el.style.opacity = String(t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4);
      return true;
    });
  }

  finishLoading(): void {
    $('loading').classList.add('done');
  }

  showLoading(text: string): void {
    const el = $('loading');
    (el.querySelector('p') as HTMLElement).textContent = text;
    el.classList.remove('done');
  }

  /** Right/bottom pixels covered by UI, so the camera can centre the island in the open area. */
  insets(): { right: number; bottom: number } {
    const panel = $('panel');
    const hidden = this.projector || document.body.classList.contains('viewer');
    const right = hidden ? 0 : window.innerWidth - panel.getBoundingClientRect().left;
    const cards = $('cards').getBoundingClientRect();
    return { right, bottom: Math.max(0, (window.innerHeight - cards.top) * 0.55) };
  }
}
