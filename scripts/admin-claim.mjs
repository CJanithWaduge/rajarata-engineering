#!/usr/bin/env node

import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { readFile } from 'node:fs/promises';

const STAGING_PROJECT_ID = 'rajarata-engineering-developer';
const REQUIRED_CUSTODIAN_COUNT = 2;
const allowedActions = new Set(['grant', 'revoke']);

function parseArguments(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (!key.startsWith('--')) throw new Error(`Unexpected argument: ${key}`);
    if (key === '--apply') {
      values.set('apply', true);
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
    values.set(key.slice(2), value);
    index += 1;
  }
  return values;
}

async function readCustodianUids() {
  const raw = await readFile(
    new URL('../src/config/admin-custodians.json', import.meta.url),
    'utf8',
  );
  let parsed;
  try {
    parsed = JSON.parse(raw).uids;
  } catch {
    throw new Error('src/config/admin-custodians.json must contain a JSON uids array.');
  }
  if (
    !Array.isArray(parsed) ||
    parsed.some((uid) => typeof uid !== 'string' || uid.trim() === '') ||
    new Set(parsed).size !== parsed.length
  ) {
    throw new Error('Custodian UIDs must be distinct, non-empty strings.');
  }
  return parsed;
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const projectId = args.get('project');
  const uid = args.get('uid');
  const action = args.get('action');
  const reason = args.get('reason')?.trim();
  if (projectId !== STAGING_PROJECT_ID) {
    throw new Error(`This bootstrap tool is staging-only. Set --project ${STAGING_PROJECT_ID}.`);
  }
  if (!uid || !/^[A-Za-z0-9:_-]{1,128}$/.test(uid)) {
    throw new Error('Provide a valid target Firebase Auth UID with --uid.');
  }
  if (!allowedActions.has(action)) throw new Error('--action must be grant or revoke.');
  if (!reason || reason.length < 3 || reason.length > 500) {
    throw new Error('Provide an audit reason between 3 and 500 characters with --reason.');
  }

  const custodianUids = await readCustodianUids();
  if (custodianUids.length < REQUIRED_CUSTODIAN_COUNT) {
    throw new Error(
      'Admin grants are blocked until at least two custodian UIDs are designated in src/config/admin-custodians.json.',
    );
  }
  if (!args.get('apply')) {
    console.log(
      `Dry run only: would ${action} the admin claim for UID ${uid} in staging project ${projectId}. No changes made.`,
    );
    return;
  }

  const app = initializeApp({
    credential: applicationDefault(),
    projectId,
  });
  const auth = getAuth(app);
  const firestore = getFirestore(app);
  const user = await auth.getUser(uid);
  const auditRef = firestore.collection('adminAudit').doc();
  await auditRef.set({
    actor: 'operator-run-script; see Google Cloud Audit Logs for the authenticated principal',
    targetUid: uid,
    action,
    reason,
    status: 'requested',
    createdAt: FieldValue.serverTimestamp(),
  });

  const claims = { ...user.customClaims };
  if (action === 'grant') claims.admin = true;
  else delete claims.admin;

  try {
    await auth.setCustomUserClaims(uid, claims);
    if (action === 'revoke') await auth.revokeRefreshTokens(uid);
  } catch (error) {
    await auditRef.update({
      status: 'failed',
      finishedAt: FieldValue.serverTimestamp(),
    });
    throw error;
  }

  await auditRef.update({
    status: 'completed',
    finishedAt: FieldValue.serverTimestamp(),
  });
  console.log(`Admin claim ${action} completed for UID ${uid} in ${projectId}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Admin claim operation failed.');
  process.exitCode = 1;
});
