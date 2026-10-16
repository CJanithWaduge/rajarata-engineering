import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import {
  initializeAppCheck,
  ReCaptchaV3Provider,
  type AppCheck,
} from 'firebase/app-check';
import {
  connectAuthEmulator,
  getAuth,
  inMemoryPersistence,
  setPersistence,
  type Auth,
} from 'firebase/auth';

let auth: Auth | undefined;
let app: FirebaseApp | undefined;
let appCheck: AppCheck | undefined;

export function getFirebaseApp(): FirebaseApp {
  if (app) return app;

  const { PUBLIC_FIREBASE_API_KEY, PUBLIC_FIREBASE_PROJECT_ID } = import.meta.env;
  const authDomain =
    import.meta.env.PUBLIC_FIREBASE_AUTH_DOMAIN || `${PUBLIC_FIREBASE_PROJECT_ID}.firebaseapp.com`;

  if (!PUBLIC_FIREBASE_API_KEY || !PUBLIC_FIREBASE_PROJECT_ID) {
    throw new Error('Firebase web configuration is incomplete.');
  }

  app = getApps().find((candidate) => candidate.options.projectId === PUBLIC_FIREBASE_PROJECT_ID) ??
    initializeApp({
      apiKey: PUBLIC_FIREBASE_API_KEY,
      authDomain,
      projectId: PUBLIC_FIREBASE_PROJECT_ID,
    });
  return app;
}

export function configureContactAppCheck(): void {
  if (appCheck) return;
  const siteKey = import.meta.env.PUBLIC_FIREBASE_APPCHECK_SITE_KEY;
  if (!siteKey) throw new Error('Firebase App Check is not configured for contact submissions.');
  appCheck = initializeAppCheck(getFirebaseApp(), {
    provider: new ReCaptchaV3Provider(siteKey),
    isTokenAutoRefreshEnabled: true,
  });
}

export async function getFirebaseAuth(): Promise<Auth> {
  if (auth) return auth;
  const firebaseApp = getFirebaseApp();
  auth = getAuth(firebaseApp);
  await setPersistence(auth, inMemoryPersistence);

  const emulatorHost = import.meta.env.DEV
    ? import.meta.env.PUBLIC_FIREBASE_AUTH_EMULATOR_HOST
    : undefined;
  if (emulatorHost) connectAuthEmulator(auth, `http://${emulatorHost}`, { disableWarnings: true });

  return auth;
}
