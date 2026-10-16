import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requestPublishBuild } from '../src/lib/cloudBuild.ts';

test('Cloud Build dispatch passes the immutable release ID to the staging trigger', async () => {
  let call;
  const buildId = await requestPublishBuild(
    'staging-project',
    'cms-publish-trigger',
    'global',
    'server-only-token',
    'release-20261016-0001',
    async (url, options) => {
      call = { url: String(url), options };
      return Response.json({
        metadata: { build: { id: 'build-123' } },
      }, { status: 200 });
    },
  );

  assert.equal(buildId, 'build-123');
  assert.equal(
    call.url,
    'https://cloudbuild.googleapis.com/v1/projects/staging-project/locations/global/triggers/cms-publish-trigger:run',
  );
  assert.equal(call.options.headers.Authorization, 'Bearer server-only-token');
  assert.deepEqual(JSON.parse(call.options.body), {
    projectId: 'staging-project',
    triggerId: 'cms-publish-trigger',
    source: { branchName: 'main' },
    substitutions: { _RELEASE_ID: 'release-20261016-0001' },
  });
});

test('Cloud Build dispatch surfaces API errors and missing build identifiers', async () => {
  await assert.rejects(
    requestPublishBuild(
      'staging-project',
      'cms-publish-trigger',
      'global',
      'server-only-token',
      'release-20261016-0001',
      async () => Response.json({ error: { message: 'permission denied' } }, { status: 403 }),
    ),
    /permission denied/,
  );
  await assert.rejects(
    requestPublishBuild(
      'staging-project',
      'cms-publish-trigger',
      'global',
      'server-only-token',
      'release-20261016-0001',
      async () => Response.json({ metadata: {} }),
    ),
    /did not return a build identifier/,
  );
});
