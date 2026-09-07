// ESM shim handing the engine's frame renderer a playwright-core whose
// Chromium build is actually installed. Candidates, first match wins:
// $PLAYWRIGHT_CORE_PATH, the engine's own node_modules, then a global install.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const candidates = [];
if (process.env.PLAYWRIGHT_CORE_PATH) candidates.push(process.env.PLAYWRIGHT_CORE_PATH);
const engineDir = process.env.MAZEBENCH_ENGINE_DIR || path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'vendor', 'MazeBenchEngine');
candidates.push(path.join(engineDir, 'node_modules', 'playwright-core'));
try {
  const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
  candidates.push(path.join(root, 'playwright', 'node_modules', 'playwright-core'), path.join(root, 'playwright-core'), path.join(root, 'playwright'));
} catch (e) { /* npm missing */ }
let pw = null, chosen = null;
for (const candidate of candidates) {
  try {
    const mod = require(candidate);
    const exe = mod.chromium.executablePath();
    if (exe && fs.existsSync(exe)) { pw = mod; chosen = candidate; break; }
    if (!pw) { pw = mod; chosen = candidate; }
  } catch (e) { /* try next */ }
}
if (!pw) throw new Error('playwright-core not found; set PLAYWRIGHT_CORE_PATH');
if (process.env.MAZEBENCH_DEBUG) console.error('playwright-core from', chosen, '->', pw.chromium.executablePath());
export const chromium = pw.chromium;
export default pw;
