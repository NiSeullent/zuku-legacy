import { randomBytes, timingSafeEqual } from 'node:crypto';

export interface Session {
  id: string;
  csrf: string;
  expires: number;
  token?: string;
  user?: { id: string; username?: string; display_name?: string; [key: string]: unknown };
  pairCode?: string;
}
export interface Pairing {
  code: string;
  sessionId: string;
  expires: number;
  approved?: { token: string; user: NonNullable<Session['user']> };
}
/** A shared implementation must make approval, claim, CSRF consumption and rotation atomic and enforce expiry/capacity. */
export interface LegacyState {
  getSession(id: string): Promise<Session | undefined>;
  putSession(session: Session): Promise<void>;
  deleteSession(id: string): Promise<void>;
  getPair(code: string): Promise<Pairing | undefined>;
  putPair(pair: Pairing): Promise<void>;
  takePair(code: string, sessionId: string): Promise<Pairing | undefined>;
  approvePair(code: string, approved: NonNullable<Pairing["approved"]>): Promise<boolean>;
  consumeCsrf(id: string, csrf: string): Promise<Session | undefined>;
  rotateSession(id: string, session: Session): Promise<boolean>;
}

export class MemoryLegacyState implements LegacyState {
  private sessions = new Map<string, Session>();
  private pairs = new Map<string, Pairing>();
  constructor(private capacity = 2000, private now: () => number = Date.now) {}
  private prune<T extends { expires: number }>(map: Map<string, T>) {
    for (const [key, value] of map) if (value.expires <= this.now()) map.delete(key);
  }
  async getSession(id: string) {
    const item = this.sessions.get(id);
    if (item && item.expires > this.now()) return structuredClone(item);
    this.sessions.delete(id);
    return undefined;
  }
  async putSession(session: Session) {
    this.prune(this.sessions);
    if (!this.sessions.has(session.id) && this.sessions.size >= this.capacity) throw new Error('Session capacity reached');
    this.sessions.set(session.id, structuredClone(session));
  }
  async deleteSession(id: string) { this.sessions.delete(id); }
  async rotateSession(id: string, session: Session) {
    const current = this.sessions.get(id);
    if (!current || current.expires <= this.now() || session.expires <= this.now() ||
        (session.id !== id && this.sessions.has(session.id))) return false;
    // Replace the authenticated browser identity without a temporary capacity increase.
    // No await between validation and replacement: an old session can rotate only once.
    this.sessions.delete(id);
    this.sessions.set(session.id, structuredClone(session));
    return true;
  }
  async getPair(code: string) {
    const item = this.pairs.get(code);
    if (item && item.expires > this.now()) return structuredClone(item);
    this.pairs.delete(code);
    return undefined;
  }
  async putPair(pair: Pairing) {
    this.prune(this.pairs);
    if (!this.pairs.has(pair.code) && this.pairs.size >= this.capacity) throw new Error('Pairing capacity reached');
    this.pairs.set(pair.code, structuredClone(pair));
  }
  async approvePair(code: string, approved: NonNullable<Pairing["approved"]>) {
    const item = this.pairs.get(code);
    if (!item || item.expires <= this.now() || item.approved) return false;
    item.approved = structuredClone(approved);
    return true;
  }
  async consumeCsrf(id: string, csrf: string) {
    const item = this.sessions.get(id);
    if (!item || item.expires <= this.now() || !equalSecret(csrf,item.csrf)) return undefined;
    item.csrf = randomBytes(32).toString("hex");
    return structuredClone(item);
  }
  async takePair(code: string, sessionId: string) {
    // No await between lookup and deletion: atomic within this process.
    const item = this.pairs.get(code);
    if (!item || item.expires <= this.now() || item.sessionId !== sessionId || !item.approved) return undefined;
    this.pairs.delete(code);
    return structuredClone(item);
  }
}

export function newSession(now = Date.now()): Session {
  return { id: randomBytes(32).toString('hex'), csrf: randomBytes(32).toString('hex'), expires: now + 15 * 60_000 };
}
export function equalSecret(a: string, b: string): boolean {
  if (!a || a.length !== b.length || a.length > 256) return false;
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function sessionCookie(request: Request): string {
  const values = (request.headers.get('cookie') || '').split(';').map(v => v.trim()).filter(v => v.startsWith('zuku_lc_session='));
  // Ambiguous cookies fail closed; do not accept a sibling-path shadow cookie.
  if (values.length !== 1) return '';
  const id = values[0]!.slice('zuku_lc_session='.length);
  return /^[a-f0-9]{64}$/.test(id) ? id : '';
}

/** Bounded local limiter; inject a distributed implementation at a multi-worker ingress. */
export class RateLimiter {
  private buckets = new Map<string, { count: number; expires: number }>();
  allow(key: string, max = 30, window = 60_000, now = Date.now()): boolean {
    for (const [k, b] of this.buckets) if (b.expires <= now) this.buckets.delete(k);
    let entry = this.buckets.get(key);
    if (!entry) {
      if (this.buckets.size >= 5000) return false;
      entry = { count: 0, expires: now + window };
      this.buckets.set(key, entry);
    }
    entry.count += 1;
    return entry.count <= max;
  }
}
