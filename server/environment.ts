import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'dotenv';

export function isHosted(env = process.env) {
  return !!env.WEBSITE_SITE_NAME || env.HARNESS_HOSTED === 'true';
}

// Hosted deployments never load a developer's local credential file.
export function environment() {
  const local = !isHosted() && existsSync('.env') ? parse(readFileSync('.env')) : {};
  return { ...local, ...process.env };
}
