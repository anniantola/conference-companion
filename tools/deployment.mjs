#!/usr/bin/env node
// Small integration entry point included in data-only deployment ZIPs.
import {access} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {pathToFileURL} from 'node:url';

const candidates = [process.env.CONFERENCE_ENGINE_DIR, '.engine', '../conference-companion'].filter(Boolean);
let modulePath;
for (const candidate of candidates) {
  const path = resolve(candidate, 'tools/deployment-engine.mjs');
  try { await access(path); modulePath = path; break; } catch { /* Try the next checkout. */ }
}
if (!modulePath) throw new Error('Shared engine missing. Set CONFERENCE_ENGINE_DIR or check out conference-companion into .engine.');
const {validateDeployment, stageDeployment} = await import(pathToFileURL(modulePath));
const action = process.argv[2];
if (action === 'check') await validateDeployment(process.cwd());
else if (action === 'stage') console.log(`Staged attendee deployment: ${await stageDeployment(process.cwd(), join(process.cwd(), '_site'))}`);
else throw new Error('Usage: node tools/deployment.mjs check|stage');
