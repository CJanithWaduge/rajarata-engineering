import assert from 'node:assert/strict';
import { test } from 'node:test';

test('the emulator callable rejects requests without an App Check token', async () => {
  const projectId = process.env.GCLOUD_PROJECT;
  assert.ok(projectId?.startsWith('demo-'), 'contact callable tests require a demo project');
  const response = await fetch(
    `http://127.0.0.1:5001/${projectId}/asia-south1/submitContactInquiry`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { fullName: '', consent: true } }),
    },
  );
  const result = await response.json();
  assert.equal(response.status, 401, JSON.stringify(result));
  assert.equal(result.error?.status, 'UNAUTHENTICATED');
  assert.equal(result.error?.message, 'Unauthenticated');
});
