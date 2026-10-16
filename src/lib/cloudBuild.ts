import { applicationDefault } from 'firebase-admin/app';

interface BuildTriggerResponse {
  metadata?: {
    build?: {
      id?: string;
    };
  };
  response?: {
    id?: string;
  };
}

export async function requestPublishBuild(
  projectId: string,
  triggerId: string,
  location: string,
  accessToken: string,
  releaseId: string,
  request: typeof fetch = fetch,
): Promise<string> {
  const endpoint = new URL(
    `https://cloudbuild.googleapis.com/v1/projects/${encodeURIComponent(projectId)}` +
      `/locations/${encodeURIComponent(location)}/triggers/${encodeURIComponent(triggerId)}:run`,
  );
  const response = await request(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      projectId,
      triggerId,
      source: { branchName: 'main' },
      substitutions: { _RELEASE_ID: releaseId },
    }),
  });
  const result = await response.json() as BuildTriggerResponse | { error?: { message?: string } };
  if (!response.ok) {
    const message = 'error' in result && result.error?.message
      ? result.error.message
      : `Cloud Build trigger returned HTTP ${response.status}.`;
    throw new Error(message);
  }

  if (!('metadata' in result) && !('response' in result)) {
    throw new Error('Cloud Build did not return an operation containing a build identifier.');
  }
  const buildId = result.metadata?.build?.id ?? result.response?.id;
  if (!buildId) {
    throw new Error('Cloud Build accepted the trigger but did not return a build identifier.');
  }
  return buildId;
}

export async function runPublishBuild(releaseId: string): Promise<string> {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const triggerId = process.env.CLOUD_BUILD_TRIGGER_ID;
  const location = process.env.CLOUD_BUILD_LOCATION || 'global';
  if (!projectId || !triggerId) {
    throw new Error('FIREBASE_PROJECT_ID and CLOUD_BUILD_TRIGGER_ID must be configured.');
  }

  const { access_token: accessToken } = await applicationDefault().getAccessToken();
  if (!accessToken) throw new Error('Application Default Credentials returned no access token.');
  return requestPublishBuild(projectId, triggerId, location, accessToken, releaseId);
}
