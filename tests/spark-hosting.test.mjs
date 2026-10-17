import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));

test('Spark Hosting config serves only static public output and does not deploy backend services', async () => {
  const config = JSON.parse(await readFile(path.join(root, 'firebase.spark.json'), 'utf8'));
  assert.equal(config.hosting.public, 'dist/client');
  assert.equal(config.functions, undefined);
  assert.equal(config.firestore, undefined);
  assert.equal(config.storage, undefined);
  assert.equal(config.hosting.rewrites, undefined);
  assert.equal(config.hosting.headers[0].source, '**');
  assert.ok(config.hosting.headers[0].headers.some(
    (header) => header.key === 'X-Robots-Tag' && header.value.includes('noindex'),
  ));
});

test('Spark contact form is disabled by default and only enabled explicitly', async () => {
  const component = await readFile(
    path.join(root, 'src', 'components', 'contact', 'TechnicalQuotation.astro'),
    'utf8',
  );
  const environmentExample = await readFile(path.join(root, '.env.example'), 'utf8');
  assert.match(component, /import\.meta\.env\.PUBLIC_CONTACT_FORM_ENABLED === 'true'/);
  assert.match(component, /The online inquiry form is unavailable on this static test site\./);
  assert.match(environmentExample, /^PUBLIC_CONTACT_FORM_ENABLED=false$/m);
  assert.match(environmentExample, /^PUBLIC_DEMO_MODE=true$/m);
});

test('Spark build forces the site-wide demo notice on', async () => {
  const script = await readFile(path.join(root, 'scripts', 'build-spark.mjs'), 'utf8');
  assert.match(script, /PUBLIC_DEMO_MODE:\s*'true'/);
  assert.match(script, /PUBLIC_WHATSAPP_NUMBER:\s*''/);
  assert.match(script, /Site-wide demo-content notice is missing/);
  assert.match(script, /active WhatsApp, telephone, or email contact link/);
});

test('Spark deploy script requires explicit project and confirmation and limits deployment to Hosting', async () => {
  const script = await readFile(path.join(root, 'scripts', 'deploy-spark.mjs'), 'utf8');
  assert.match(script, /--confirm-static-hosting-deploy/);
  assert.match(script, /--project/);
  assert.match(script, /firebase\.spark\.json/);
  assert.match(script, /--only hosting/);
  assert.match(script, /scripts\/build-spark\.mjs/);
  assert.doesNotMatch(script, /--only\s+functions/);
});
