// Isolated VM QA only: deterministic fixtures, no production API or credentials.
import { createLegacyApp } from '@zuku/legacy-core';
import { createStandaloneServer } from '../../apps/server/server.mjs';
import { fixtureFetch } from '../../tests/fixtures.mjs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const port = Number(process.env.QA_PORT || 18787);
const publicOrigin = process.env.QA_PUBLIC_ORIGIN || 'http://10.0.2.100';
const core = createLegacyApp({ apiOrigin: 'https://api.example.test', publicOrigin, fetch: fixtureFetch });
const app = {
  async handle(request, context) {
    const url = new URL(request.url);
    if (url.pathname === '/legacy/__qa/ie6-probe.vbs' && request.method === 'GET') {
      return new Response(await readFile(new URL('./ie6-probe.vbs', import.meta.url)), { headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="ie6-probe.vbs"', 'Cache-Control': 'no-store' } });
    }
    if (url.pathname === '/legacy/__qa/results' && request.method === 'POST') {
      const bytes = Buffer.from(await request.arrayBuffer());
      const result = bytes[0] === 0xff && bytes[1] === 0xfe ? bytes.subarray(2).toString('utf16le') : bytes.toString('utf8');
      console.log(`Received explicit VM probe upload (${bytes.length} bytes, ${result.length} chars)`);
      if (result.length > 1000000) return new Response('Report too large', { status: 413 });
      const directory = new URL('../../artifacts/', import.meta.url);
      await mkdir(directory, { recursive: true });
      await writeFile(new URL('ie6-vm-report.txt', directory), result);
      console.log(`Saved explicit VM probe result to artifacts/ie6-vm-report.txt (${result.length} chars)`);
      return new Response('Recorded');
    }
    const response = await core.handle(request, context);
    // Deliberately omit queries, headers, cookies and form bodies from logs.
    console.log(JSON.stringify({ time: new Date().toISOString(), method: request.method, path: url.pathname, status: response.status, userAgent: request.headers.get('user-agent') }));
    return response;
  },
};
const server = createStandaloneServer({ app, publicOrigin, maxBodyBytes: 128 * 1024 });
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
console.log(`VM fixtures: 127.0.0.1:${port}, expected guest origin ${publicOrigin}`);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
