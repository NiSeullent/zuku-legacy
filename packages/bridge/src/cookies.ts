interface Cookie { name: string; value: string; path: string; expiresAt?: number }

/** An origin-scoped memory jar. Remote cookies never leave the companion process. */
export class BridgeCookieJar {
  private readonly cookies = new Map<string, Cookie>();
  constructor(private readonly hostname: string, private readonly capacity = 32) {}

  absorb(lines: string[], requestPath: string, now = Date.now()): void {
    for (const line of lines) {
      if (line.length > 4096) throw new Error('Upstream cookie exceeds limit');
      const segments = line.split(';');
      const pair = segments.shift()!;
      const separator = pair.indexOf('=');
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      if (separator < 1 || !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name) || /[\x00-\x20\x7f;,]/.test(value)) continue;
      const slash = requestPath.lastIndexOf('/');
      let path = slash > 0 ? requestPath.slice(0, slash) : '/';
      let expiresAt: number | undefined;
      let maxAge: number | undefined;
      let allowed = true;
      for (const segment of segments) {
        const split = segment.indexOf('=');
        const key = (split < 0 ? segment : segment.slice(0, split)).trim().toLowerCase();
        const attribute = split < 0 ? '' : segment.slice(split + 1).trim();
        if (key === 'domain' && attribute.toLowerCase().replace(/^\./, '') !== this.hostname.toLowerCase()) allowed = false;
        if (key === 'path' && attribute.startsWith('/')) path = attribute;
        if (key === 'expires') {
          const parsed = Date.parse(attribute);
          if (Number.isFinite(parsed)) expiresAt = parsed;
        }
        if (key === 'max-age' && /^-?\d+$/.test(attribute)) maxAge = Number(attribute);
      }
      if (!allowed) continue;
      if (maxAge !== undefined) expiresAt = now + Math.max(0, maxAge) * 1000;
      const id = `${name}\n${path}`;
      if (expiresAt !== undefined && expiresAt <= now) { this.cookies.delete(id); continue; }
      this.expire(now);
      if (!this.cookies.has(id) && this.cookies.size >= this.capacity) throw new Error('Upstream cookie capacity exceeded');
      this.cookies.set(id, { name, value, path, ...(expiresAt !== undefined ? { expiresAt } : {}) });
    }
  }

  header(path: string, now = Date.now()): string {
    this.expire(now);
    return [...this.cookies.values()]
      .filter(cookie => path === cookie.path || (path.startsWith(cookie.path) && (cookie.path.endsWith('/') || path[cookie.path.length] === '/')))
      .sort((a, b) => b.path.length - a.path.length)
      .map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
  }

  private expire(now: number): void {
    for (const [id, cookie] of this.cookies) if (cookie.expiresAt !== undefined && cookie.expiresAt <= now) this.cookies.delete(id);
  }
}
