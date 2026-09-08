import { readFile, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { parse } from 'acorn';
const root = new URL('../',import.meta.url);
for (const [path,max,gzipMax] of [['packages/neonux-lc/dist/neonux-lc.js',16384,4096],['packages/neonux-lc/dist/neonux-lc.css',12288,4096]]) {
  const file=new URL(path,root), data=await readFile(file);
  if ((await stat(file)).size>max || gzipSync(data).length>gzipMax) throw new Error(`Asset budget exceeded: ${path}`);
  if (path.endsWith('.js')) parse(data.toString(),{ecmaVersion:3});
  console.log(`${path}: ${data.length} bytes / gzip ${gzipSync(data).length} bytes`);
}
