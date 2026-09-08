import { CLASSIC_CSS, CLASSIC_JS } from '@zuku/neonux-lc/server-assets';
import { createHash, randomBytes } from 'node:crypto';
import { BridgeReplayCache, verifyBridgeRequest } from '@zuku/legacy-bridge';
import { ZukuApi, ApiError, type Category } from './api.js';
import { MemoryLegacyState, newSession, sessionCookie, RateLimiter, type LegacyState, type Session } from './state.js';
import { escape as e, text, safeId, intPage } from './html.js';
import * as v from './views.js';
import { isClassicUserAgent, publicToLegacyPath, legacyToPublicPath } from './routing.js';
export { ZukuApi, ApiError } from './api.js';
export { MemoryLegacyState } from './state.js';
export type { LegacyState, Session, Pairing } from './state.js';

export interface LegacyOptions {
  apiOrigin: string;
  /** Exact public Legacy origin. Mount under the modern host for shared pairing state. */
  publicOrigin: string;
  modernOrigin?: string;
  bridgeKey?: string;
  basePath?: string;
  state?: LegacyState;
  fetch?: typeof fetch;
  requestBodyTimeoutMs?: number;
}
export interface RequestContext {
  /** Set only from the accepted socket or an authenticated, sanitizing HTTPS ingress. */
  secureTransport?: boolean;
  /** Adapter-derived address; never take X-Forwarded-For from an untrusted client. */
  clientAddress?: string;
  /** Trusted adapter policy for a dedicated Classic hostname such as ie.zuzunza.com. */
  forceClassicView?: boolean;
}
const MAX_FORM = 16 * 1024;
class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
function fail(status: number, message: string): never { throw new HttpError(status, message); }
function decodePath(value: string): string { try { return decodeURIComponent(value); } catch { return fail(400,'올바르지 않은 주소입니다.'); } }
function identifier(id: string | undefined): string { try { return safeId(id || ''); } catch { return fail(400, '올바르지 않은 항목 주소입니다.'); } }
async function requestBody(request: Request, timeoutMs: number): Promise<Uint8Array> {
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_FORM)) fail(413, '요청이 너무 큽니다.');
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0, timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve,reject) => {
    timer = setTimeout(() => {
      reject(new HttpError(408,'요청을 받는 시간이 초과되었습니다.'));
      void reader.cancel().catch(() => undefined);
    },timeoutMs);
  });
  const read = async () => {
    while (true) {
      const part = await reader.read();
      if (part.done) return Buffer.concat(chunks);
      size += part.value.length;
      if (size > MAX_FORM) { void reader.cancel().catch(() => undefined); fail(413,'요청이 너무 큽니다.'); }
      chunks.push(part.value);
    }
  };
  try { return await Promise.race([read(),timeout]); }
  finally { clearTimeout(timer); reader.releaseLock(); }
}
function field(form: URLSearchParams, name: string, max = 128): string {
  if (form.getAll(name).length > 1) fail(400, '중복 입력을 처리할 수 없습니다.');
  const value = form.get(name) || '';
  if (value.length > max) fail(400, '입력 길이를 확인해 주세요.');
  return value;
}
function userSummary(user: unknown): NonNullable<Session['user']> {
  const u = user as Record<string, unknown>;
  if (typeof u?.id !== 'string') fail(502, '계정 응답을 확인할 수 없습니다.');
  return { id: u.id as string, username: String(u.handle || ''), display_name: String(u.display_name || u.handle || '') };
}
function cursor(url: URL): string | undefined {
  const value = url.searchParams.get('cursor');
  if (value && (value.length > 1024 || /[\x00-\x1f]/.test(value))) fail(400, '잘못된 페이지 주소입니다.');
  return value || undefined;
}

/** One application instance serves both Next Route Handlers and the standalone Node/Bun adapter. */
export function createLegacyApp(options: LegacyOptions) {
  const api = new ZukuApi({ origin: options.apiOrigin, fetch: options.fetch });
  const publicUrl = new URL(options.publicOrigin);
  if (!['http:', 'https:'].includes(publicUrl.protocol) || publicUrl.username || publicUrl.password || publicUrl.pathname !== '/' || publicUrl.search || publicUrl.hash) throw new Error('publicOrigin must be a bare HTTP(S) origin');
  const modernUrl = new URL(options.modernOrigin || 'https://www.zuzunza.com');
  if (modernUrl.protocol !== 'https:' || modernUrl.username || modernUrl.password || modernUrl.pathname !== '/' || modernUrl.search || modernUrl.hash) throw new Error('modernOrigin must be a bare HTTPS origin');
  const base = options.basePath || '/legacy';
  if (!/^\/[a-z][a-z0-9/-]*$/.test(base) || base.endsWith('/')) throw new Error('Invalid basePath');
  if (options.bridgeKey && !/^(?:[a-fA-F0-9]{2}){32,}$/.test(options.bridgeKey)) throw new Error('bridgeKey needs at least 32 random bytes as hexadecimal');
  const bodyTimeout = options.requestBodyTimeoutMs ?? 10_000;
  if (!Number.isInteger(bodyTimeout) || bodyTimeout < 1 || bodyTimeout > 15_000) throw new Error('Invalid body timeout');
  const state = options.state || new MemoryLegacyState();
  const replay = new BridgeReplayCache();
  const limiter = new RateLimiter();
  const loadAsset = (kind: 'css' | 'js') => kind === 'css' ? CLASSIC_CSS : CLASSIC_JS;

  async function handle(request: Request, context: RequestContext = {}): Promise<Response> {
    let ctx: v.ViewContext = { base, mode: 'auto', secure: false, bridge: false, modernOrigin: modernUrl.origin, path: '' };
    const headers = new Headers({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, private',
      'X-Content-Type-Options': 'nosniff',
      'X-UA-Compatible': 'IE=edge',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
    });
    const html = (title: string, body: string, status = 200) => new Response(request.method === 'HEAD' ? null : v.document(ctx, title, body), {status, headers});
    const json = (value: unknown, status = 200) => { headers.set('Content-Type','application/json; charset=utf-8'); return new Response(JSON.stringify(value),{status,headers}); };
    const redirect = (path = '') => { headers.set('Location', v.href(ctx,path)); return new Response(null,{status:303,headers}); };
    const setSession = (s: Session) => headers.set('Set-Cookie', `zuku_lc_session=${s.id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=900${ctx.bridge || context.secureTransport ? '; Secure' : ''}`);
    const mustSecure = () => { if (!ctx.secure) fail(403,'계정 작업에는 HTTPS 또는 로컬 보안 브리지가 필요합니다.'); };
    const mustSession = () => { mustSecure(); if (!ctx.session) fail(403, '세션이 만료되었습니다. 연결 화면을 다시 열어 주세요.'); return ctx.session!; };
    const csrfCheck = async (form: URLSearchParams) => { const session = mustSession(); const claimed = await state.consumeCsrf(session.id,field(form,'csrf',256)); if (!claimed) fail(403,'이 양식은 만료되었거나 올바르지 않습니다. 화면을 새로 열어 주세요.'); ctx.session=claimed; return claimed!; };
    try {
      const url = new URL(request.url);
      const internal = url.pathname === base || url.pathname.startsWith(base + '/');
      const publicPath = internal ? null : publicToLegacyPath(url.pathname);
      if (!internal && publicPath === null) return new Response('Not found',{status:404});
      if (url.search.length > 4096) fail(414,'주소가 너무 깁니다.');
      if (!['GET','HEAD','POST'].includes(request.method)) { headers.set('Allow','GET, HEAD, POST'); fail(405,'지원하지 않는 요청 방식입니다.'); }
      ctx.path = internal ? url.pathname.slice(base.length).replace(/\/$/,'') : publicPath!;
      ctx.publicRouting = !internal;
      let proofTarget = url.pathname + url.search;
      const original = request.headers.get('x-zuku-lc-original-path');
      if (original) {
        if (!internal || original.length > 4096 || !original.startsWith('/') || original.startsWith('//') || /[\\\x00-\x20#]/.test(original)) fail(400,'올바르지 않은 요청 주소입니다.');
        const source = new URL(original,url.origin);
        if (source.origin !== url.origin || source.search !== url.search || publicToLegacyPath(source.pathname) !== ctx.path) fail(400,'요청 경로가 일치하지 않습니다.');
        proofTarget = original;
        ctx.publicRouting = true;
      }
      headers.set('Vary','User-Agent');
      ctx.mode = url.searchParams.get('mode') === 'text' ? 'text' : 'auto';
      const body = request.method === 'POST' ? await requestBody(request,bodyTimeout) : new Uint8Array();
      let hasProof = false; request.headers.forEach((_value,key) => { if (key.startsWith('x-zuku-bridge-')) hasProof = true; });
      if (hasProof) {
        if (!options.bridgeKey || !verifyBridgeRequest({method:request.method,url:proofTarget,headers:request.headers}, body, options.bridgeKey, replay)) fail(403, '보안 브리지 요청을 검증할 수 없습니다.');
        ctx.bridge = true;
      }
      ctx.secure = ctx.bridge || context.secureTransport === true;
      if (ctx.publicRouting && !ctx.bridge && !context.forceClassicView && !isClassicUserAgent(request.headers.get('user-agent'))) return new Response('Modern renderer should handle this request',{status:404,headers:{'Vary':'User-Agent'}});
      // Proof authenticates a configured companion; URL scheme and proxy headers alone never do.
      if (ctx.secure) {
        const id = sessionCookie(request);
        ctx.session = id ? await state.getSession(id) : undefined;
      }
      if (request.method === 'POST' && !ctx.bridge) {
        const origin = request.headers.get('origin');
        const referer = request.headers.get('referer');
        if (origin && origin !== publicUrl.origin) fail(403, '다른 사이트의 요청은 처리할 수 없습니다.');
        if (!origin && referer) {
          let referringOrigin: string;
          try { referringOrigin = new URL(referer).origin; } catch { return fail(403,'요청 출처를 확인할 수 없습니다.'); }
          if (referringOrigin !== publicUrl.origin) fail(403,'다른 사이트의 요청은 처리할 수 없습니다.');
        }
      }
      if (ctx.path === '/assets/neonux-lc.css' || ctx.path === '/assets/neonux-lc.js') {
        if (request.method === 'POST') fail(405, '지원하지 않는 요청 방식입니다.');
        const kind = ctx.path.endsWith('.css') ? 'css' : 'js';
        headers.set('Content-Type', kind === 'css' ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8');
        headers.set('Cache-Control','public, max-age=3600');
        return new Response(request.method === 'HEAD' ? null : await loadAsset(kind), {headers});
      }
      if (request.method === 'POST') {
        mustSecure();
        const rateKey = ctx.session?.id || context.clientAddress || 'unknown-client';
        if (!limiter.allow('post:' + rateKey)) fail(429,'요청이 많습니다. 잠시 후 다시 시도해 주세요.');
        if (ctx.path === '/authorize') {
          // Only an explicit modern-host approval can convey its existing bearer token.
          if (ctx.bridge || request.headers.get('origin') !== publicUrl.origin) fail(403,'모던 ZUKU에서 연결을 승인해 주세요.');
          if (!(request.headers.get('content-type') || '').startsWith('application/json')) fail(415,'JSON 요청이 필요합니다.');
          const auth = request.headers.get('authorization') || '';
          if (!/^Bearer [A-Za-z0-9._~-]{20,8192}$/.test(auth)) fail(401,'모던 ZUKU 로그인이 필요합니다.');
          let input: {code?: string};
          try { input = JSON.parse(Buffer.from(body).toString('utf8')); } catch { return fail(400,'올바르지 않은 요청입니다.'); }
          const code = typeof input?.code === 'string' ? input.code.replace(/-/g,'').toUpperCase() : '';
          if (!/^[A-F0-9]{12}$/.test(code)) fail(400,'연결 코드를 확인해 주세요.');
          const token = auth.slice(7);
          if (!limiter.allow('approve:' + createHash('sha256').update(token).digest('hex'), 8)) fail(429,'연결 시도가 많습니다. 잠시 후 다시 시도해 주세요.');
          const pair = await state.getPair(code);
          if (!pair || pair.approved) fail(400,'연결 코드가 만료되었거나 이미 승인되었습니다.');
          const user = userSummary(await api.me(token));
          if (!await state.approvePair(code,{token,user})) fail(400,'연결 코드가 만료되었거나 이미 승인되었습니다.');
          return json({success:true,display_name:user.display_name});
        }
        if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/x-www-form-urlencoded')) fail(415, '일반 HTML 양식으로 요청해 주세요.');
        const form = new URLSearchParams(Buffer.from(body).toString('utf8'));
        ctx.mode = field(form,'mode') === 'text' ? 'text' : 'auto';
        if (field(form,'routing') === 'public') ctx.publicRouting = true;
        const session = await csrfCheck(form);
        if (ctx.path === '/connect') {
          const approved = session.pairCode ? await state.takePair(session.pairCode, session.id) : undefined;
          if (!approved?.approved) return html('승인 대기', v.intro('아직 승인을 기다리고 있습니다','모던 ZUKU에서 연결을 승인한 뒤 다시 확인해 주세요.') + connectForm(session));
          const fresh = newSession();
          fresh.token = approved.approved.token;
          fresh.user = approved.approved.user;
          if (!await state.rotateSession(session.id,fresh)) fail(403,'세션이 만료되었습니다. 연결 화면을 다시 열어 주세요.');
          setSession(fresh);
          return redirect('/account');
        }
        if (ctx.path === '/logout') {
          await state.deleteSession(session.id);
          headers.set('Set-Cookie',`zuku_lc_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${ctx.secure ? '; Secure' : ''}`);
          return redirect();
        }
        if (!session.token) fail(401,'계정을 먼저 연결해 주세요.');
        const id = ctx.path === '/actions/post' ? '' : identifier(field(form,'id'));
        const bodyText = field(form,'body',1000).trim();
        let target = '';
        switch (ctx.path) {
          case '/actions/post': if (!bodyText || [...bodyText].length > 280) fail(400,'글은 1~280자로 입력해 주세요.'); await api.createPost(bodyText,session.token); target = '/thread'; break;
          case '/actions/reply': if (!bodyText || [...bodyText].length > 280) fail(400,'답글은 1~280자로 입력해 주세요.'); await api.reply(id,bodyText,session.token); target='/thread/'+id; break;
          case '/actions/like-post': await api.likePost(id,session.token,field(form,'liked') !== '0'); target='/thread/'+id; break;
          case '/actions/like-content': await api.likeContent(id,session.token); target='/content/'+id; break;
          case '/actions/bookmark': await api.bookmarkContent(id,session.token); target='/content/'+id; break;
          case '/actions/comment': if (!bodyText || [...bodyText].length > 1000) fail(400,'댓글은 1~1000자로 입력해 주세요.'); await api.comment(id,bodyText,session.token); target='/content/'+id; break;
          default: fail(404,'이 작업은 찾을 수 없습니다.');
        }
        return redirect(target);
      }
      if (ctx.path === '/connect') {
        if (!ctx.secure) return html('계정 연결', v.intro('안전한 연결부터 시작해요','이 HTTP 연결에서는 계정 정보를 입력하지 않습니다.') + v.panel('연결 방법', `<p>같은 기기의 보안 브리지를 실행한 뒤 <strong>http://127.0.0.1:8788/</strong> 을 열어 주세요. HTTPS를 지원하는 기기는 HTTPS 주소에서 바로 연결할 수 있습니다.</p><p>브리지는 설치 시 신뢰할 수 있는 경로로 전달받아야 합니다. 일반 LAN의 HTTP 브리지는 지원하지 않습니다.</p>${v.link(ctx,'/compatibility','지원 조건 보기','lc-button')}`));
        if (ctx.session?.token) return redirect('/account');
        if (!ctx.session && !limiter.allow('connect:'+(context.clientAddress || 'unknown-client'),10)) fail(429,'연결 시도가 많습니다. 잠시 후 다시 시도해 주세요.');
        if (!ctx.session) { ctx.session = newSession(); await state.putSession(ctx.session); setSession(ctx.session); }
        const session = ctx.session;
        let pair = session.pairCode ? await state.getPair(session.pairCode) : undefined;
        if (!pair) {
          pair = { code:randomBytes(6).toString('hex').toUpperCase(), sessionId:session.id, expires:Date.now()+5*60_000 };
          session.pairCode = pair.code;
          await state.putPair(pair);
          await state.putSession(session);
        }
        const displayCode = pair.code.match(/.{4}/g)!.join('-');
        const approvalUrl = `${modernUrl.origin}${base}/approve?code=${encodeURIComponent(pair.code)}`;
        return html('계정 연결',v.intro('같은 계정으로 이어서','모던 ZUKU에서 아래 코드를 확인하고 연결을 승인해 주세요.') + v.panel('5분 동안 유효한 연결 코드', `<p class="lc-pair-code"><strong>${text(displayCode)}</strong></p><p><a href="${e(approvalUrl)}">모던 ZUKU에서 승인 화면 열기</a></p><p>이미 로그인한 모던 기기에서 이 주소를 열고, 이 화면의 코드와 일치하는지 확인해 주세요. 비밀번호와 패스키는 모던 ZUKU에서 처리합니다.</p>${connectForm(session)}`));
      }
      if (ctx.path === '/account') {
        if (!ctx.session?.token) return redirect('/connect');
        const user = await api.me(ctx.session.token);
        return html('내 계정',v.intro('계정이 연결되었습니다',String(user.display_name || user.handle)) + v.panel('연결된 세션', `<p>세션은 연결 후 최대 15분간 유지됩니다. 기존 ZUKU의 권한과 계정 정책이 동일하게 적용됩니다.</p><form action="${e(base)}/logout" method="post"><input type="hidden" name="csrf" value="${e(ctx.session.csrf)}"><input type="hidden" name="routing" value="${ctx.publicRouting ? 'public' : 'isolated'}"><button class="lc-button" type="submit">이 기기 연결 해제</button></form>`));
      }
      if (ctx.path === '/authorize' || ctx.path === '/approve') return html('모던 계정 연결',v.intro('모던 ZUKU에서 승인해 주세요','현재 호스트에 계정 연결 화면이 아직 설치되지 않았습니다.') + v.panel('연결 안내','<p>운영자는 함께 제공된 Next.js 승인 화면을 기존 ZUKU 로그인에 연결해야 합니다. Legacy에서는 비밀번호를 입력하지 않습니다.</p>'),501);
      if (ctx.path === '/settings') return html('화면 설정',v.intro('기기에 맞게, 편안하게','화면 설정은 주소에 저장되며 자바스크립트가 필요하지 않습니다.') + v.panel('표현 방식',`<p><a class="lc-button" href="${e(ctx.publicRouting ? legacyToPublicPath('') : base)}?mode=text">텍스트 모드 — 효과 없음</a></p><p><a class="lc-button" href="${e(ctx.publicRouting ? legacyToPublicPath('') : base)}">표준 모드 — 지원되는 그래픽만</a></p><p>모든 모드에서 자동 재생, 무한 스크롤, 외부 글꼴을 사용하지 않습니다.</p>`));
      if (ctx.path === '/compatibility') return html('지원 기능',v.capabilityPage(ctx));
      if (ctx.path === '/messages') return html('메시지',v.intro('대화의 암호화를 유지합니다','ZUKU 메시지는 기존 종단간 암호화 클라이언트에서 확인해 주세요.') + v.panel('메시지 열기',`<p><a class="lc-button lc-button-primary" href="${e(modernUrl.origin)}/messages">모던 ZUKU 메시지</a></p><p>Legacy에서 메시지 내용을 평문으로 전송하거나 저장하지 않습니다.</p>`));
      const page = intPage(url.searchParams.get('page'));
      const token = ctx.session?.token;
      if (ctx.path === '/search') {
        const q = (url.searchParams.get('q') || '').trim().slice(0,120);
        if (!q) return html('검색',v.intro('무엇을 찾고 있나요?','창작물의 제목이나 키워드를 입력해 주세요.'));
        const data = await api.search(q,undefined,page,token);
        return html('검색: '+q,v.intro('“'+q+'” 검색 결과','ZUKU 전체 창작물을 검색합니다.') + v.contentList(ctx,data.results) + v.pagination(ctx,'/search',data.pagination,{q}));
      }
      if (ctx.path === '/bookmarks') {
        if (!token) return redirect('/connect');
        const data = await api.bookmarks(token,page);
        return html('보관함',v.intro('다시 보고 싶은 순간들','모던 ZUKU와 같은 보관함입니다.')+v.contentList(ctx,data.feeds)+v.pagination(ctx,'/bookmarks',data.pagination));
      }
      if (ctx.path === '/thread') {
        const data = await api.thread(cursor(url),token);
        return html('Thread',v.intro('지금, 나누고 싶은 이야기','짧은 글로 이어지는 ZUKU의 일상.')+v.panel('글 쓰기',v.form(ctx,'post','게시하기',{}, {label:'지금 무슨 생각을 하나요?',max:280}))+data.posts.map(p=>v.threadCard(ctx,p)).join('')+(data.next_cursor ? `<p><a class="lc-button" href="${e(v.href(ctx,'/thread',{cursor:data.next_cursor}))}">다음 이야기</a></p>`:''));
      }
      if (ctx.path.startsWith('/thread/')) {
        const id=identifier(decodePath(ctx.path.slice(8)));
        const data=await api.postThread(id,cursor(url),token);
        return html('대화',v.intro('Thread','하나의 이야기, 이어지는 대화.')+data.posts.map(p=>v.threadCard(ctx,p,true)).join('')+v.panel('대화에 참여하기',v.form(ctx,'reply','답글 남기기',{id},{label:'답글',max:280}))+(data.next_cursor?`<p><a class="lc-button" href="${e(v.href(ctx,'/thread/'+id,{cursor:data.next_cursor}))}">다음 답글</a></p>`:''));
      }
      if (ctx.path.startsWith('/content/')) {
        const id=identifier(decodePath(ctx.path.slice(9)));
        const content = await api.content(id,token);
        // Content must succeed before requesting comments, preserving backend visibility decisions.
        const data = await api.comments(id,page,token);
        return html(content.title,v.contentDetail(ctx,content)+v.comments(data.comments)+v.pagination(ctx,'/content/'+id,data.pagination));
      }
      if (ctx.path.startsWith('/profile/')) {
        const handle=decodePath(ctx.path.slice(9)).replace(/^@/,'');
        if (!/^[\p{L}\p{M}\p{N}_.-]{1,80}$/u.test(handle)) fail(400,'올바르지 않은 프로필 주소입니다.');
        return html('프로필',v.profile(ctx,await api.profile(handle,token)));
      }
      const category = ctx.path.slice(1);
      const product = v.PRODUCTS.find(p=>p.id===category && p.id!=='thread');
      if (!product) fail(404,'이 페이지는 찾을 수 없습니다.');
      const data = await api.feed((category || undefined) as Category | undefined,page,token);
      return html(product.name,v.intro(category ? product.name : '가벼운 웹, 넓은 세계.',category ? product.label : '창작물과 이야기, 모두 같은 ZUKU에서 만나요.')+v.contentList(ctx,data.feeds)+v.pagination(ctx,ctx.path,data.pagination));
    } catch (error) {
      const status = error instanceof HttpError ? error.status : error instanceof ApiError ? (error.status >= 400 && error.status <= 599 ? error.status : 502) : 502;
      if (status === 401 && ctx.session) { await state.deleteSession(ctx.session.id); ctx.session = undefined; }
      const message = error instanceof HttpError ? error.message : error instanceof ApiError ? error.message : '연결을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.';
      return html('요청을 완료하지 못했습니다',v.intro('잠시 확인이 필요해요',message)+v.panel('계속 이용하기',v.link(ctx,'','홈으로','lc-button')+' '+v.link(ctx,'/connect','계정 연결','lc-button')),status);
    }
    function connectForm(session: Session) { return `<form action="${e(base)}/connect" method="post"><input type="hidden" name="csrf" value="${e(session.csrf)}"><input type="hidden" name="mode" value="${ctx.mode}"><input type="hidden" name="routing" value="${ctx.publicRouting ? 'public' : 'isolated'}"><button class="lc-button lc-button-primary" type="submit">승인 완료 확인</button></form>`; }
  }
  return {handle};
}
