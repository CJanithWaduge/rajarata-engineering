import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const clientRoot = path.join(projectRoot, 'dist', 'client');
const requiredPages = [
  'index.html',
  'services/index.html',
  'about-us/index.html',
  'projects/index.html',
  'contact/index.html',
];

function runNpm(script) {
  const env = {
    ...process.env,
    PUBLIC_CONTACT_FORM_ENABLED: 'false',
    PUBLIC_DEMO_MODE: 'true',
    PUBLIC_WHATSAPP_NUMBER: '',
  };
  const result = process.platform === 'win32'
    ? spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `npm run ${script}`], {
      cwd: projectRoot,
      env,
      stdio: 'inherit',
    })
    : spawnSync('npm', ['run', script], { cwd: projectRoot, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`npm run ${script} failed with exit code ${result.status ?? 'unknown'}.`);
  }
}

function collectFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? collectFiles(entryPath) : [entryPath];
  });
}

function auditBuild() {
  if (!fs.existsSync(clientRoot)) throw new Error('The static public build directory dist/client is missing.');
  for (const relativePath of requiredPages) {
    if (!fs.existsSync(path.join(clientRoot, relativePath))) {
      throw new Error(`Expected public route output is missing: ${relativePath}`);
    }
  }

  const files = collectFiles(clientRoot);
  const adminFiles = files.filter((file) => path.relative(clientRoot, file).split(path.sep).includes('admin'));
  const sourceMaps = files.filter((file) => file.endsWith('.map'));
  const publicText = files
    .filter((file) => /\.(?:html|js|css|json|svg|txt|xml)$/i.test(file))
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n');
  const placeholders = publicText.match(/\[REPLACE:/g) ?? [];
  const temporaryImageHosts = publicText.match(/lh3\.googleusercontent\.com/gi) ?? [];
  const privatePatterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
    /"private_key"\s*:/i,
    /firebase-adminsdk/i,
    /CONTACT_SMTP_PASSWORD/i,
    /CONTACT_RATE_LIMIT_SALT/i,
  ];
  const privateMatches = privatePatterns.filter((pattern) => pattern.test(publicText));
  const findings = [];
  if (adminFiles.length) findings.push(`Admin-path files: ${adminFiles.length}`);
  if (sourceMaps.length) findings.push(`Source maps: ${sourceMaps.length}`);
  if (placeholders.length) findings.push(`${placeholders.length} [REPLACE: ...] placeholders; replace them only with owner-verified content`);
  if (temporaryImageHosts.length) findings.push(`${temporaryImageHosts.length} temporary Google-hosted image URL(s); use approved durable assets`);
  if (privateMatches.length) findings.push(`${privateMatches.length} private credential pattern(s)`);
  if (publicText.includes('id="contact-quotation-form"')) findings.push('Contact inquiry form is present; it must be disabled for this Spark build');
  if (/https:\/\/wa\.me\/|href=["'](?:tel:|mailto:)/i.test(publicText)) {
    findings.push('An active WhatsApp, telephone, or email contact link is present in the demo build');
  }
  if (!publicText.includes('The online inquiry form is unavailable on this static test site.')) {
    findings.push('Contact form unavailable notice is missing');
  }
  if (!publicText.includes('DEMO TEMPLATE')) findings.push('Site-wide demo-content notice is missing');
  if (findings.length) throw new Error(findings.join('; '));

  console.log(`Spark static build audit passed: ${requiredPages.length} routes, ${files.length} files, no placeholders, temporary image hosts, Admin output, source maps, or credential patterns.`);
}

try {
  runNpm('check');
  runNpm('build');
  auditBuild();
} catch (error) {
  console.error(`Spark build is not ready: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
