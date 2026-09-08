import { CATEGORIES, type AuthUser, type BookmarkData, type Category, type CommentsData, type Comment, type Content, type CreatorProfile, type FeedData, type GamesData, type LikeData, type Post, type ReadingFeedData, type SearchData, type ThreadData } from './contracts.js';

export * from './contracts.js';

export const API_PAGE_SIZE = 12;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 8000;

export class ApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ZukuApiOptions {
  /** Origin only. HTTPS is required except for an exact local loopback host. */
  origin: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

function apiOrigin(input: string): string {
  let url: URL;
  try { url = new URL(input); } catch { throw new TypeError('Invalid ZUKU API origin'); }
  const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new TypeError('ZUKU API origin must be HTTPS (or exact loopback HTTP), without credentials or a path');
  }
  return url.origin;
}

function segment(value: string): string {
  if (!value || value.length > 256 || value === '.' || value === '..' || /[\x00-\x20\x7f/\\]/.test(value)) {
    throw new TypeError('Invalid ZUKU identifier');
  }
  return encodeURIComponent(value);
}

function categoryValue(category: Category | undefined): Category | undefined {
  if (category !== undefined && !CATEGORIES.includes(category)) throw new TypeError('Invalid content category');
  return category;
}

function pageQuery(page: number): URLSearchParams {
  if (!Number.isSafeInteger(page) || page < 1) throw new TypeError('Invalid page number');
  return new URLSearchParams({ page: String(page), per_page: String(API_PAGE_SIZE) });
}

function cursorQuery(key: 'cursor' | 'before' | 'after', cursor?: string): URLSearchParams {
  const params = new URLSearchParams({ limit: String(API_PAGE_SIZE) });
  if (cursor) {
    if (cursor.length > 2048) throw new TypeError('Invalid page cursor');
    params.set(key, cursor);
  }
  return params;
}

function bearer(token: string | undefined, required = false): string | undefined {
  if (token === undefined && !required) return undefined;
  if (!token || token.length > 8192 || !/^[A-Za-z0-9._~+/-]+=*$/.test(token)) {
    throw new ApiError('AUTH_REQUIRED', '인증된 ZUKU 연결이 필요합니다.', 401);
  }
  return `Bearer ${token}`;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function boundedBody(response: Response): Promise<string> {
  const length = response.headers.get('content-length');
  if (length && Number(length) > MAX_RESPONSE_BYTES) {
    void response.body?.cancel().catch(() => undefined);
    throw new ApiError('RESPONSE_TOO_LARGE', '서버 응답이 기기 처리 한도를 초과했습니다.', 502);
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let body = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        void reader.cancel().catch(() => undefined);
        throw new ApiError('RESPONSE_TOO_LARGE', '서버 응답이 기기 처리 한도를 초과했습니다.', 502);
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    return body + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

/** Server-only adapter. No browser cookies/headers or arbitrary paths cross this boundary. */
export class ZukuApi {
  readonly origin: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #timeoutMs: number;

  constructor(options: ZukuApiOptions) {
    this.origin = apiOrigin(options.origin);
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isFinite(this.#timeoutMs) || this.#timeoutMs < 1 || this.#timeoutMs > 30000) {
      throw new TypeError('API timeout must be between 1 and 30000 milliseconds');
    }
  }

  async #request<T>(path: string, token?: string, method = 'GET', body?: object): Promise<T> {
    const authorization = bearer(token, method !== 'GET');
    const headers = new Headers({ Accept: 'application/json', 'Accept-Language': 'ko-KR' });
    if (authorization) headers.set('Authorization', authorization);
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new ApiError('UPSTREAM_TIMEOUT', 'ZUKU 서버 응답 시간이 초과되었습니다.', 504));
        controller.abort();
      }, this.#timeoutMs);
    });
    const operation = async (): Promise<T> => {
      const response = await this.#fetch(`${this.origin}/api/v1${path}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual', credentials: 'omit', cache: 'no-store', signal: controller.signal,
      });
      if (response.status >= 300 && response.status < 400) {
        void response.body?.cancel().catch(() => undefined);
        throw new ApiError('UPSTREAM_REDIRECT', 'ZUKU 서버가 예상하지 않은 경로를 반환했습니다.', 502);
      }
      if (response.status === 204) return undefined as T;
      const text = await boundedBody(response);
      let payload: unknown;
      try { payload = JSON.parse(text); } catch {
        throw new ApiError('INVALID_RESPONSE', 'ZUKU 서버 응답을 해석하지 못했습니다.', 502);
      }
      if (!record(payload) || typeof payload.success !== 'boolean') {
        throw new ApiError('INVALID_RESPONSE', 'ZUKU 서버 응답 형식이 올바르지 않습니다.', 502);
      }
      if (!response.ok || !payload.success) {
        const error = record(payload.error) ? payload.error : undefined;
        throw new ApiError(
          typeof error?.code === 'string' ? error.code.slice(0, 100) : 'UPSTREAM_ERROR',
          typeof error?.message === 'string' ? error.message.slice(0, 500) : 'ZUKU 요청을 처리하지 못했습니다.',
          response.ok ? 502 : response.status,
        );
      }
      if (!('data' in payload) || payload.data === null || payload.data === undefined) {
        throw new ApiError('INVALID_RESPONSE', 'ZUKU 서버 응답에 데이터가 없습니다.', 502);
      }
      return payload.data as T;
    };
    try { return await Promise.race([operation(), timeout]); }
    catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError('UPSTREAM_UNAVAILABLE', 'ZUKU 서버에 연결하지 못했습니다.', 502);
    } finally { clearTimeout(timer); }
  }

  async feed(category?: Category, page = 1, token?: string): Promise<FeedData> {
    categoryValue(category);
    const query = pageQuery(page);
    query.set('sort', 'hot');
    const data = await this.#request<FeedData | ReadingFeedData>(`/feeds${category ? `/${category}` : ''}?${query}`, token);
    if ('feeds' in data) return data;
    if (!Array.isArray(data.items) || !Number.isFinite(data.total) || data.per_page < 1) {
      throw new ApiError('INVALID_RESPONSE', 'ZUKU 피드 응답 형식이 올바르지 않습니다.', 502);
    }
    return {
      feeds: data.items, sort: data.sort,
      pagination: {
        page: data.page, per_page: data.per_page, total: data.total,
        total_pages: Math.max(1, Math.ceil(data.total / data.per_page)),
        has_next: data.has_more, has_prev: data.page > 1, next_cursor: null, prev_cursor: null,
      },
    };
  }

  search(q: string, category?: Category, page = 1, token?: string): Promise<SearchData> {
    categoryValue(category);
    if (q.length > 500) throw new TypeError('Search query is too long');
    const query = pageQuery(page);
    query.set('q', q); query.set('mode', 'keyword');
    if (category) query.set('category', category);
    return this.#request(`/search?${query}`, token);
  }

  async content(id: string, token?: string): Promise<Content> {
    return (await this.#request<{ content: Content }>(`/contents/${segment(id)}`, token)).content;
  }

  comments(id: string, page = 1, token?: string): Promise<CommentsData> {
    return this.#request(`/contents/${segment(id)}/comments?${pageQuery(page)}`, token);
  }

  thread(cursor?: string, token?: string): Promise<ThreadData> {
    return this.#request(`/thread/posts?${cursorQuery('cursor', cursor)}`, token);
  }

  postThread(id: string, cursor?: string, token?: string): Promise<ThreadData> {
    return this.#request(`/posts/${segment(id)}/thread?${cursorQuery('after', cursor)}`, token);
  }

  createPost(body: string, token: string): Promise<{ post: Post }> {
    return this.#request('/posts', token, 'POST', { body });
  }

  reply(id: string, body: string, token: string): Promise<{ post: Post }> {
    return this.#request(`/posts/${segment(id)}/replies`, token, 'POST', { body });
  }

  likePost(id: string, token: string, liked = true): Promise<LikeData> {
    return this.#request(`/posts/${segment(id)}/like`, token, liked ? 'POST' : 'DELETE');
  }

  likeContent(id: string, token: string): Promise<LikeData> {
    return this.#request(`/contents/${segment(id)}/like`, token, 'POST');
  }

  bookmarkContent(id: string, token: string): Promise<BookmarkData> {
    return this.#request(`/contents/${segment(id)}/bookmark`, token, 'POST');
  }

  comment(id: string, body: string, token: string, parentId?: string): Promise<{ comment: Comment }> {
    return this.#request(`/contents/${segment(id)}/comments`, token, 'POST', {
      body, ...(parentId ? { parent_id: parentId } : {}),
    });
  }

  async me(token: string): Promise<AuthUser> {
    bearer(token, true);
    const data = await this.#request<{ user: AuthUser }>('/auth/me', token);
    if (!record(data.user) || typeof data.user.id !== 'string' || !data.user.id ||
        typeof data.user.handle !== 'string' || typeof data.user.display_name !== 'string') {
      throw new ApiError('INVALID_RESPONSE', 'ZUKU 인증 응답 형식이 올바르지 않습니다.', 502);
    }
    return data.user;
  }

  async profile(handle: string, token?: string): Promise<CreatorProfile> {
    return (await this.#request<{ creator: CreatorProfile }>(`/creators/${segment(handle)}`, token)).creator;
  }

  bookmarks(token: string, page = 1): Promise<FeedData> {
    bearer(token, true);
    return this.#request(`/users/me/bookmarks?${pageQuery(page)}`, token);
  }

  games(page = 1, token?: string): Promise<GamesData> {
    return this.#request(`/jump/games?${pageQuery(page)}`, token);
  }

  async game(id: string, token?: string): Promise<Content> {
    return (await this.#request<{ content: Content }>(`/jump/games/${segment(id)}`, token)).content;
  }
}
