import { initializeApp, getApps } from 'firebase/app';
import {
  connectAuthEmulator,
  getAuth,
  inMemoryPersistence,
  setPersistence,
  type Auth,
} from 'firebase/auth';

let auth: Auth | undefined;

export async function getFirebaseAuth(): Promise<Auth> {
  if (auth) return auth;

  const { PUBLIC_FIREBASE_API_KEY, PUBLIC_FIREBASE_PROJECT_ID } = import.meta.env;
  const authDomain =
    import.meta.env.PUBLIC_FIREBASE_AUTH_DOMAIN || `${PUBLIC_FIREBASE_PROJECT_ID}.firebaseapp.com`;

  if (!PUBLIC_FIREBASE_API_KEY || !PUBLIC_FIREBASE_PROJECT_ID) {
    throw new Error('Firebase web configuration is incomplete.');
  }

  const app =
    getApps().find((candidate) => candidate.options.projectId === PUBLIC_FIREBASE_PROJECT_ID) ??
    initializeApp({
      apiKey: PUBLIC_FIREBASE_API_KEY,
      authDomain,
      projectId: PUBLIC_FIREBASE_PROJECT_ID,
    });

  auth = getAuth(app);
  await setPersistence(auth, inMemoryPersistence);

  const emulatorHost = import.meta.env.DEV
    ? import.meta.env.PUBLIC_FIREBASE_AUTH_EMULATOR_HOST
    : undefined;
  if (emulatorHost) connectAuthEmulator(auth, `http://${emulatorHost}`, { disableWarnings: true });

  return auth;
}
