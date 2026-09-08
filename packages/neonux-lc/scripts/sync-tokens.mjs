// Fetch only pinned public sources. A new commit requires an explicit source.json edit/review.
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = JSON.parse(await readFile(path.join(root, 'vendor/source.json'), 'utf8'));
if (!/^[a-f0-9]{40}$/.test(source.commit) || source.repository !== 'https://github.com/NiSeullent/neonux-core') {
  throw new Error('Expected the explicitly pinned public NeonUX source.');
}
for (const [local, upstream] of Object.entries(source.files)) {
  if (!/^[\w.-]+$/.test(local) || !/^[\w./-]+$/.test(upstream)) throw new Error('Invalid snapshot path');
  const encoded = execFileSync('gh', ['api', `repos/NiSeullent/neonux-core/contents/${upstream}?ref=${source.commit}`, '--jq', '.content'], { encoding: 'utf8' });
  await writeFile(path.join(root, 'vendor', local), Buffer.from(encoded.replace(/\s/g, ''), 'base64'));
}
await import('./build.mjs');
