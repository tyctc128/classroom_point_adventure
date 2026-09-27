/** Firebase web app settings (only used without the school login, e.g. with the emulator). */
type FirebaseOptions = Record<string, string>;

/**
 * Cloud sync settings. Leave `cloudConfig` as null to keep scores only in this browser.
 *
 * To turn on sync (see README "雲端同步"):
 *  1. Create a Firebase project, add a Web app, and paste its config below.
 *  2. Enable Authentication → Google, and Firestore Database.
 *  3. Put the teacher Gmail addresses in `teacherEmails` here AND in firestore.rules.
 *  4. Deploy the rules: `npx firebase deploy --only firestore:rules`.
 */
export interface CloudConfig {
  firebase: FirebaseOptions;
  /** One class = one scoreboard. Use a different id per class. */
  classId: string;
  /** Top-level Firestore collection that holds the classes (default "classes"). */
  root?: string;
  /** Sign in with the school's unified login (hspssso); teachers are accounts whose role is admin. */
  sso?: { portal: string };
  /** Emulator/Google sign-in only: teacher Gmail addresses (firestore.rules is what enforces it). */
  teacherEmails?: string[];
  /** Connect to the local Firebase emulators instead of the real project (for testing). */
  useEmulator?: boolean;
}

/** Class 412 on the school's hspssso Firebase project (data under classroomAdventure/class-412). */
export const cloudConfig = {
  firebase: {},
  classId: 'class-412',
  root: 'classroomAdventure',
  sso: { portal: 'https://hspssso-portal.vercel.app' },
} as CloudConfig | null;

/** Settings used with `?emulator=1` together with `npm run emulators`. */
export const emulatorConfig: CloudConfig = {
  firebase: { apiKey: 'demo-key', authDomain: 'demo-classroom.firebaseapp.com', projectId: 'demo-classroom' },
  classId: 'demo-class',
  teacherEmails: ['teacher@example.com'],
  useEmulator: true,
};
