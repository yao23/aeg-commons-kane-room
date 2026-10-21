import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { importReferenceSeed } from './references.ts';
// Explicit CLI only. Startup never silently imports or replaces references.
const [seed, target, ...extra] = process.argv.slice(2);
if (!seed || extra.length) { console.error('Usage: npm run import:references -- <seed.json> [target-curated-references.json]'); process.exit(1); }
try {
  const report = importReferenceSeed(resolve(seed), target ? resolve(target) : fileURLToPath(new URL('../curated-references.json', import.meta.url)));
  console.log(JSON.stringify(report, null, 2));
  if (report.skipped.length) process.exitCode = 2;
} catch (error) { console.error(error.message); process.exitCode = 1; }
