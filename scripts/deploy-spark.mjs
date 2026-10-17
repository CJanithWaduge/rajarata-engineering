import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const projectIndex = args.indexOf('--project');
const projectId = projectIndex >= 0 ? args[projectIndex + 1] : '';
const confirmation = args.includes('--confirm-static-hosting-deploy');
const allowedArgs = new Set(['--project', projectId, '--confirm-static-hosting-deploy']);

if (
  !projectId ||
  !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId) ||
  !confirmation ||
  args.some((argument) => !allowedArgs.has(argument)) ||
  args.filter((argument) => argument === '--project').length !== 1 ||
  args.filter((argument) => argument === '--confirm-static-hosting-deploy').length !== 1
) {
  console.error(
    'Deployment stopped. Specify the Firebase project and explicit confirmation:\n' +
    'npm run deploy:spark -- --project <firebase-project-id> --confirm-static-hosting-deploy',
  );
  process.exit(2);
}

const build = spawnSync(process.execPath, ['scripts/build-spark.mjs'], {
  cwd: projectRoot,
  env: process.env,
  stdio: 'inherit',
});
if (build.error) {
  console.error('Could not run the Spark build audit.', build.error);
  process.exit(1);
}
if (build.status !== 0) {
  console.error('Deployment stopped because the Spark build and audit did not pass.');
  process.exit(build.status ?? 1);
}

console.log(`Deploying Firebase Hosting only to explicitly selected project "${projectId}".`);
const deploymentArgs = 'deploy --config firebase.spark.json --only hosting --project ' + projectId;
const deployment = process.platform === 'win32'
  ? spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `firebase ${deploymentArgs}`], {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit',
  })
  : spawnSync('firebase', deploymentArgs.split(' '), {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit',
  });

if (deployment.error) {
  console.error('Firebase Hosting deployment command failed to start.', deployment.error);
  process.exit(1);
}
if (deployment.status !== 0) {
  console.error(`Firebase Hosting deployment failed with exit code ${deployment.status ?? 'unknown'}.`);
  process.exit(deployment.status ?? 1);
}
