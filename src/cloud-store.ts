// Firestore-backed store: every browser subscribes to the same class and day documents, so the
// island looks the same everywhere. Only teachers (firestore.rules) can change scores.
//
//   {root}/{classId}                          goal, teamNames
//   {root}/{classId}/days/{YYYY-MM-DD}        scores, goal, world, closesAt (22:00 Taipei), serial
//   {root}/{classId}/days/{day}/events/{seq}  one score or undo event per document
//
// With the school login (hspssso) the data lives in the hspssso Firestore and teachers are accounts
// whose role is admin. The Firebase SDK is loaded from the same CDN version as sso-client.js so both
// share one app and one login.
/* eslint-disable @typescript-eslint/no-explicit-any */
type User = { uid: string; email: string | null; getIdTokenResult(): Promise<{ claims: Record<string, unknown> }> };
type DocumentReference = any;
type DocumentData = Record<string, any>;
type Unsubscribe = () => void;

const SDK = 'https://www.gstatic.com/firebasejs/12.0.0';
let doc: any, collection: any, getDocs: any, limit: any, onSnapshot: any, orderBy: any, query: any;
let runTransaction: any, serverTimestamp: any, setDoc: any, Timestamp: any, updateDoc: any;
const cdn = (name: string) => import(/* @vite-ignore */ `${SDK}/firebase-${name}.js`);

import type { CloudConfig } from './firebase-config';
import {
  closesAtMs, dailyWorld, taipeiParts, WORLD_IDS,
  type ChangeEvent, type DayRecord, type GameStore, type ScoreEvent, type WorldId,
} from './store';
import { TEAMS } from './teams';

const eventId = (seq: number) => `e${String(seq).padStart(6, '0')}`;

export class CloudStore implements GameStore {
  readonly mode = 'cloud' as const;
  scores: Record<string, number> = {};
  teamNames: Record<string, string> = {};
  events: ScoreEvent[] = [];
  goal = 30;
  day = '';
  closed = false;
  world: WorldId = 'grassland';
  user: User | null = null;
  /** Signed-in account has teacher rights (school login: role admin). */
  private teacher = false;
  private sso: any = null;
  private authApi: any = null;
  private auth: any = null;
  /** True once the day document exists in Firestore. */
  dayReady = false;
  private closesAt = 0;
  private db: any = null;
  private listeners: ((e: ChangeEvent) => void)[] = [];
  private errorListeners: ((message: string) => void)[] = [];
  private unsubDay: Unsubscribe[] = [];
  private seen = new Set<string>();
  private firstEvents = true;

  constructor(private readonly config: CloudConfig, private readonly now: () => number = () => Date.now()) {
    for (const t of TEAMS) {
      this.scores[t.id] = 0;
      this.teamNames[t.id] = t.name;
    }
  }

  get canEdit(): boolean {
    return this.teacher;
  }

  /** Load the Firebase SDK and connect to the school login (or the local emulators). */
  private async connect(): Promise<void> {
    const fs: any = await cdn('firestore');
    ({ doc, collection, getDocs, limit, onSnapshot, orderBy, query, runTransaction, serverTimestamp, setDoc, Timestamp, updateDoc } = fs);
    if (this.config.sso) {
      const local = ['localhost', '127.0.0.1'].includes(location.hostname);
      const portal = local ? 'http://localhost:3000' : this.config.sso.portal;
      this.sso = await import(/* @vite-ignore */ `${portal}/sso-client.js`);
      this.auth = this.sso.auth;
      this.db = fs.getFirestore(this.sso.app);
      this.authApi = { onAuthStateChanged: this.sso.onAuthStateChanged };
      await this.sso.ready; // finishes a sign-in that is coming back from the portal
    } else {
      const appApi: any = await cdn('app');
      this.authApi = await cdn('auth');
      const app = appApi.initializeApp(this.config.firebase);
      this.db = fs.getFirestore(app);
      this.auth = this.authApi.getAuth(app);
      if (this.config.useEmulator) {
        fs.connectFirestoreEmulator(this.db, '127.0.0.1', 8080);
        this.authApi.connectAuthEmulator(this.auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      }
    }
  }

  private async checkTeacher(user: User | null): Promise<boolean> {
    if (!user) return false;
    if (this.config.sso) {
      const claims = (await user.getIdTokenResult()).claims;
      return claims.admin === true || claims.role === 'admin';
    }
    const email = user.email?.toLowerCase();
    return !!email && (this.config.teacherEmails ?? []).map((e) => e.toLowerCase()).includes(email);
  }

  /** Name to show for the signed-in account. */
  async displayName(): Promise<string> {
    if (!this.user) return '';
    if (this.sso) {
      const p = await this.sso.getProfile();
      return p?.name || p?.account || this.user.uid;
    }
    return this.user.email ?? this.user.uid;
  }

  onChange(cb: (e: ChangeEvent) => void): void { this.listeners.push(cb); }
  onError(cb: (message: string) => void): void { this.errorListeners.push(cb); }
  private emit(e: ChangeEvent): void { this.listeners.forEach((cb) => cb(e)); }
  private fail(message: string): void { this.errorListeners.forEach((cb) => cb(message)); }

  private get classRef(): DocumentReference { return doc(this.db, this.config.root ?? 'classes', this.config.classId); }
  private dayRef(day = this.day): DocumentReference { return doc(this.classRef, 'days', day); }

  async start(): Promise<void> {
    await this.connect();
    this.authApi.onAuthStateChanged(this.auth, async (user: User | null) => {
      this.user = user;
      this.teacher = await this.checkTeacher(user);
      this.emit({ kind: 'auth' });
      if (this.canEdit) void this.ensureDay();
    });
    onSnapshot(this.classRef, (snap: any) => {
      const data: DocumentData | undefined = snap.data();
      if (!data) return;
      this.goal = Number(data.goal) || 30;
      const names = (data.teamNames ?? {}) as Record<string, string>;
      for (const t of TEAMS) this.teamNames[t.id] = names[t.id] || t.name;
      this.emit({ kind: 'settings' });
    }, (err: any) => this.fail(`雲端連線失敗：${err.message}`));
    this.openDay(taipeiParts(this.now()).day, true);
  }

  private openDay(day: string, initial = false): void {
    this.unsubDay.forEach((u) => u());
    this.day = day;
    this.closesAt = closesAtMs(day);
    this.closed = this.now() >= this.closesAt;
    this.world = dailyWorld(day);
    this.dayReady = false;
    this.events = [];
    this.seen.clear();
    this.firstEvents = true;
    for (const t of TEAMS) this.scores[t.id] = 0;
    this.unsubDay = [
      onSnapshot(this.dayRef(), (snap: any) => {
        const data = snap.data();
        this.dayReady = !!data;
        if (!data) {
          if (this.canEdit) void this.ensureDay();
          return;
        }
        const scores = (data.scores ?? {}) as Record<string, number>;
        for (const t of TEAMS) this.scores[t.id] = Number(scores[t.id]) || 0;
        const world = WORLD_IDS.includes(data.world) ? (data.world as WorldId) : dailyWorld(day);
        if (world !== this.world) {
          this.world = world;
          this.emit({ kind: 'world' });
        }
        this.emit({ kind: 'settings' });
      }, (err: any) => this.fail(`雲端連線失敗：${err.message}`)),
      onSnapshot(query(collection(this.dayRef(), 'events'), orderBy('seq')), (snap: any) => {
        this.events = snap.docs.map((d: any) => d.data() as ScoreEvent);
        for (const change of snap.docChanges()) {
          if (change.type !== 'added' || this.seen.has(change.doc.id)) continue;
          this.seen.add(change.doc.id);
          if (this.firstEvents) continue;
          // Live event from any browser: animate it here too.
          const e = change.doc.data() as ScoreEvent;
          this.scores[e.team_id] = e.after;
          this.emit(e);
        }
        this.firstEvents = false;
      }, (err: any) => this.fail(`雲端連線失敗：${err.message}`)),
    ];
    this.emit({ kind: initial ? 'settings' : 'new_day' });
  }

  /** Teachers create today's document (scores at zero, today's world) if nobody has yet. */
  private async ensureDay(): Promise<void> {
    if (this.dayReady || this.now() >= this.closesAt) return;
    const ref = this.dayRef();
    try {
      await runTransaction(this.db, async (tx: any) => {
        const snap = await tx.get(ref);
        if (snap.exists()) return;
        tx.set(ref, {
          day: this.day,
          scores: Object.fromEntries(TEAMS.map((t) => [t.id, 0])),
          goal: this.goal,
          world: dailyWorld(this.day),
          closesAt: Timestamp.fromMillis(this.closesAt),
          serial: 0,
          updatedAt: serverTimestamp(),
        });
      });
    } catch (err) {
      this.fail(`無法建立今日記錄：${(err as Error).message}`);
    }
  }

  checkClock(ms = this.now()): void {
    const { day } = taipeiParts(ms);
    if (day !== this.day) {
      this.openDay(day);
      return;
    }
    if (!this.closed && ms >= this.closesAt) {
      this.closed = true;
      this.emit({ kind: 'closed' });
    }
  }

  async signIn(): Promise<void> {
    if (this.sso) { this.sso.login(); return; }
    await this.authApi.signInWithPopup(this.auth, new this.authApi.GoogleAuthProvider());
  }

  /** Emulator only: sign in as any Google account without a popup (used by automated tests). */
  async signInForTesting(email: string): Promise<void> {
    if (!this.config.useEmulator) throw new Error('only available with the emulator');
    const token = JSON.stringify({ sub: email.replace(/\W/g, ''), email, email_verified: true });
    await this.authApi.signInWithCredential(this.auth, this.authApi.GoogleAuthProvider.credential(token));
  }

  async signOut(): Promise<void> {
    if (this.sso) { await this.sso.logout(); return; }
    await this.authApi.signOut(this.auth);
  }

  private guard(): string | null {
    if (!this.user) return '請先由右上角以教師帳號登入';
    if (!this.canEdit) return '這個帳號沒有教師權限';
    if (this.closed) return '今日已結算';
    return null;
  }

  async addScore(teamId: string, delta: number, reason = '課堂表現'): Promise<boolean> {
    this.checkClock();
    const blocked = this.guard();
    if (blocked) { this.fail(blocked); return false; }
    if (!(teamId in this.scores) || !Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 100) return false;
    await this.ensureDay();
    try {
      return await runTransaction(this.db, async (tx: any) => {
        const ref = this.dayRef();
        const snap = await tx.get(ref);
        const data = snap.data();
        if (!data) throw new Error('今日記錄尚未建立');
        const before = Number(data.scores?.[teamId]) || 0;
        const after = Math.min(99999, Math.max(0, before + delta));
        if (after === before) return false;
        const seq = (Number(data.serial) || 0) + 1;
        tx.update(ref, { [`scores.${teamId}`]: after, serial: seq, updatedAt: serverTimestamp() });
        tx.set(doc(ref, 'events', eventId(seq)), this.eventDoc(seq, 'score', teamId, before, after, reason.trim().slice(0, 80)));
        return true;
      });
    } catch (err) {
      this.fail(`加分失敗：${(err as Error).message}`);
      return false;
    }
  }

  private eventDoc(seq: number, kind: 'score' | 'undo', teamId: string, before: number, after: number, reason: string, source?: number | string): DocumentData {
    return {
      id: seq, seq, kind, team_id: teamId, delta: after - before, before, after, reason,
      time: this.now() / 1000, by: this.user?.email ?? '', undone: false, ...(source !== undefined ? { source_id: source } : {}),
    };
  }

  canUndo(): boolean {
    return this.canEdit && !this.closed && this.events.some((e) => e.kind === 'score' && !e.undone);
  }

  /** Undo the latest score event that has not been undone yet (by any teacher). */
  async undo(): Promise<boolean> {
    this.checkClock();
    const blocked = this.guard();
    if (blocked) { this.fail(blocked); return false; }
    const target = [...this.events].reverse().find((e) => e.kind === 'score' && !e.undone);
    if (!target) return false;
    try {
      return await runTransaction(this.db, async (tx: any) => {
        const ref = this.dayRef();
        const sourceRef = doc(ref, 'events', eventId(Number(target.id)));
        const [daySnap, sourceSnap] = [await tx.get(ref), await tx.get(sourceRef)];
        const day = daySnap.data();
        const source = sourceSnap.data();
        if (!day || !source || source.undone) return false;
        const before = Number(day.scores?.[source.team_id]) || 0;
        const after = Math.max(0, before - Number(source.delta));
        const seq = (Number(day.serial) || 0) + 1;
        tx.update(sourceRef, { undone: true });
        tx.update(ref, { [`scores.${source.team_id}`]: after, serial: seq, updatedAt: serverTimestamp() });
        tx.set(doc(ref, 'events', eventId(seq)), this.eventDoc(seq, 'undo', source.team_id, before, after, `撤銷：${source.reason}`, source.id));
        return true;
      });
    } catch (err) {
      this.fail(`撤銷失敗：${(err as Error).message}`);
      return false;
    }
  }

  setGoal(value: number): void {
    if (!this.canEdit) return;
    const goal = Math.min(999, Math.max(1, Math.round(value)));
    void setDoc(this.classRef, { goal, teamNames: this.teamNames, updatedAt: serverTimestamp() }, { merge: true })
      .catch((err: any) => this.fail(`設定失敗：${err.message}`));
  }

  renameTeam(id: string, name: string): void {
    const trimmed = name.trim().slice(0, 12);
    if (!this.canEdit || !trimmed) return;
    void setDoc(this.classRef, { goal: this.goal, teamNames: { ...this.teamNames, [id]: trimmed }, updatedAt: serverTimestamp() }, { merge: true })
      .catch((err: any) => this.fail(`設定失敗：${err.message}`));
  }

  /** A teacher switching the world switches it for every browser watching today. */
  setWorld(id: WorldId): void {
    if (!this.canEdit) {
      // Viewers may still preview another world locally.
      this.world = id;
      this.emit({ kind: 'world' });
      return;
    }
    void updateDoc(this.dayRef(), { world: id, updatedAt: serverTimestamp() })
      .catch((err: any) => this.fail(`切換世界失敗：${err.message}`));
  }

  async history(): Promise<DayRecord[]> {
    const snap = await getDocs(query(collection(this.classRef, 'days'), orderBy('day', 'desc'), limit(120)));
    const rows = snap.docs.map((d: any) => {
      const data = d.data();
      return { day: String(data.day ?? d.id), scores: (data.scores ?? {}) as Record<string, number>, goal: Number(data.goal) || 30, world: data.world } as DayRecord;
    });
    if (!rows.some((r: any) => r.day === this.day)) rows.unshift({ day: this.day, scores: { ...this.scores }, goal: this.goal, world: this.world });
    return rows;
  }
}
