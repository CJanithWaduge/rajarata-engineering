import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

function getAdminApp() {
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error('FIREBASE_PROJECT_ID is not configured for the Admin service.');

  const existing = getApps().find((app) => app.options.projectId === projectId);
  return existing ?? initializeApp({ projectId });
}

export function getAdminAuth() {
  return getAuth(getAdminApp());
}

export function getAdminFirestore() {
  return getFirestore(getAdminApp());
}

export function getDraftFirestore() {
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.PUBLIC_FIREBASE_PROJECT_ID;
  if (!process.env.FIRESTORE_EMULATOR_HOST || !projectId?.startsWith('demo-')) {
    throw new Error('Draft access is restricted to the local Firebase emulator project.');
  }
  return getAdminFirestore();
}

export function getDraftStorage() {
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.PUBLIC_FIREBASE_PROJECT_ID;
  if (
    !process.env.FIRESTORE_EMULATOR_HOST ||
    !process.env.FIREBASE_STORAGE_EMULATOR_HOST ||
    !projectId?.startsWith('demo-')
  ) {
    throw new Error('Draft media access is restricted to the local Firebase emulators.');
  }
  return getStorage(getAdminApp()).bucket(`${projectId}.appspot.com`);
}
