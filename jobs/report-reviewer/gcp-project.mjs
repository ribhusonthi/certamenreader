// Vertex project for the local maintenance scripts: GOOGLE_CLOUD_PROJECT,
// else GCLOUD_PROJECT, else `gcloud config get-value project`. Kept out of
// the source so the project ID isn't published with the repo.

import { execSync } from 'child_process';

function resolveProject () {
  const env = process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT;
  if (env) return env;
  try {
    return execSync('gcloud config get-value project', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

export const PROJECT = resolveProject();
if (!PROJECT) {
  console.error('No GCP project. Set GOOGLE_CLOUD_PROJECT or run `gcloud config set project <id>`.');
  process.exit(1);
}
