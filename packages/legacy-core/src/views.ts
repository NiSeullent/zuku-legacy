import { escape as e, text, paragraph, plain, safeHttpUrl } from './html.js';
import { legacyToPublicPath } from './routing.js';
import { CLASSIC_ASSET_REVISION } from './assets.js';
import type { Session } from './state.js';

export const PRODUCTS = [
  { id: '', name: '둘러보기', label: '모든 창작물' },
  { id: 'thread', name: 'Thread', label: '사람과 이야기' },
  { id: 'hype', name: 'Hype', label: '영상 · 이미지' },
  { id: 'swipe', name: 'Swipe', label: '짧은 순간' },
  { id: 'jump', name: 'Jump', label: '게임과 놀이' },
  { id: 'vive', name: 'Vive', label: '글과 문학' },
  { id: 'vine', name: 'Vine', label: '음악과 목소리' }
] as const;
export type ViewMode = 'auto' | 'text';
export interface ViewContext { base: string; mode: ViewMode; secure: boolean; bridge: boolean; session?: Session; modernOrigin: string; path: string; publicRouting?: boolean; }
const obj = (v: unknown): Record<string, unknown> => typeof v === 'object' && v !== null ? v as Record<string, unknown> : {};
export function href(ctx: ViewContext, path = '', query: Record<string, string | number | undefined> = {}): string {
  const params = new URLSearchParams();
  if (ctx.mode === 'text') params.set('mode', 'text');
  for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== '') params.set(key, String(value));
  return `${ctx.publicRouting ? legacyToPublicPath(path) : ctx.base + path}${params.size ? '?' + params : ''}`;
}
export function panel(title: string, body: string): string { return `<div class="lc-panel"><div class="lc-panel-header"><h2 class="lc-panel-title">${text(title)}</h2></div><div class="lc-panel-body">${body}</div></div>`; }
export function actionPanel(ctx: ViewContext, title: string, body: string): string { return ctx.secure && body ? panel(title, body) : ''; }
export function link(ctx: ViewContext, path: string, label: string, cls = '') { return `<a${cls ? ` class="${e(cls)}"` : ''} href="${e(href(ctx, path))}">${text(label)}</a>`; }
export function document(ctx: ViewContext, title: string, body: string): string {
  const status = ctx.bridge ? '연결됨' : ctx.secure ? '온라인' : '';
  const nav = PRODUCTS.map(p => `<li>${link(ctx, p.id ? '/' + p.id : '', p.name, (ctx.path === '/' + p.id || !p.id && ctx.path === '') ? 'lc-active' : '')}</li>`).join('');
  const account = ctx.session?.user ? `${text(ctx.session.user.display_name || ctx.session.user.username)} 님 · ${link(ctx, '/account', '내 계정')}` : ctx.secure ? link(ctx, '/connect', '계정 연결', 'lc-button') : '';
  const personal = ctx.secure ? `<li>${link(ctx, '/bookmarks', '보관함')}</li>` : '';
  return `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN" "http://www.w3.org/TR/html4/loose.dtd">
<html lang="ko"><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"><meta http-equiv="X-UA-Compatible" content="IE=edge"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><title>${text(title)} | ZUKU Legacy</title><link rel="stylesheet" type="text/css" href="${e(ctx.base)}/assets/neonux-lc.css?v=${CLASSIC_ASSET_REVISION}"></head>
<body class="lc-page" data-lc-mode="${ctx.mode}"><a class="lc-skip" href="#main">본문 바로가기</a><div class="lc-shell">
<div class="lc-header"><a class="lc-brand" href="${e(href(ctx))}"><span class="lc-brand-mark">Z</span> ZUKU <span class="lc-badge">LEGACY</span></a><p class="lc-muted">Swipe, Jump, Hype! 다시 만난 우리 세계로.</p><p class="lc-header-actions">${account}${link(ctx, '/settings', '화면 설정', 'lc-button')}</p></div>
<div class="lc-layout"><div class="lc-sidebar"><p class="lc-eyebrow">ZUKU NETWORK</p><ul class="lc-nav">${nav}${personal}</ul><div class="lc-panel"><div class="lc-panel-body" data-lc-surface="status">${status ? `<p class="lc-badge">${status}</p>` : ''}<p class="lc-muted">${ctx.mode === 'text' ? '텍스트 모드 · 이미지와 효과 없음' : '가벼운 화면 · 자동 재생 없음'}</p>${link(ctx, '/compatibility', '지원 기능 보기')}</div></div></div>
<div class="lc-main" id="main"><form class="lc-search" action="${e(ctx.publicRouting ? legacyToPublicPath('/search') : ctx.base+'/search')}" method="get"><label class="lc-label" for="q">ZUKU 검색</label><input class="lc-input" id="q" name="q" type="text" maxlength="120" value=""><input type="hidden" name="mode" value="${ctx.mode}"><button class="lc-button lc-button-primary" type="submit">검색</button></form>${body}</div></div>
<div class="lc-footer"><p>ZUKU Web Client (Legacy) · NeonUX-LC 0.1</p><p>${link(ctx, '/compatibility', '호환성')} · <a href="${e(ctx.modernOrigin)}">모던 ZUKU</a> · <a href="https://github.com/NiSeullent/zuku-legacy">소스 코드</a></p></div></div>${ctx.mode === 'text' ? '' : `<script type="text/javascript" src="${e(ctx.base)}/assets/neonux-lc.js?v=${CLASSIC_ASSET_REVISION}"></script>`}</body></html>`;
}
export function intro(title: string, summary: string): string { return `<div class="lc-hero"><p class="lc-eyebrow">ZUKU / CLASSIC WEB</p><h1>${text(title)}</h1><p>${text(summary)}</p></div>`; }
export function contentCard(ctx: ViewContext, value: unknown): string {
  const c = obj(value), creator = obj(c.creator), stats = obj(c.stats);
  const id = String(c.id || ''), title = c.title || '제목 없음';
  // A remote image could leak a private URL and cannot be fetched over protected HTTP.
  // Images are therefore opt-in via a content link, never mandatory for navigation.
  return `<div class="lc-card"><p class="lc-eyebrow">${text(c.category || 'ZUKU')} <span class="lc-muted">/ ${text(c.type || '창작물')}</span></p><h2>${link(ctx, '/content/' + encodeURIComponent(id), String(title))}</h2><p>${text(plain(c.description), 200)}</p><p class="lc-muted">${creator.handle ? link(ctx, '/profile/' + encodeURIComponent(String(creator.handle)), String(creator.display_name || creator.handle)) : text(creator.display_name || 'ZUKU 창작자')} · 좋아요 ${text(stats.like_count || 0)} · 댓글 ${text(stats.comment_count || 0)}</p></div>`;
}
export function contentList(ctx: ViewContext, list: unknown[]): string { return list.length ? `<div class="lc-card-grid">${list.slice(0, 12).map(c => contentCard(ctx, c)).join('')}</div>` : panel('아직 표시할 창작물이 없습니다', '<p>다른 채널을 둘러보거나 검색어를 바꿔 보세요.</p>'); }
export function pagination(ctx: ViewContext, path: string, value: unknown, extra: Record<string, string> = {}): string {
  const p = obj(value), page = Number(p.page || 1);
  return `<p class="lc-pagination">${p.has_prev ? `<a class="lc-button" href="${e(href(ctx, path, {...extra, page: page - 1}))}">이전</a> ` : ''}<span>${text(page)} 페이지</span>${p.has_next ? ` <a class="lc-button" href="${e(href(ctx, path, {...extra, page: page + 1}))}">다음</a>` : ''}</p>`;
}
export function form(ctx: ViewContext, action: string, label: string, fields: Record<string, string> = {}, textarea?: {label: string; max: number}): string {
  if (!ctx.secure) return '';
  if (!ctx.session?.token) return `<p>${link(ctx, '/connect', '계정을 연결하고 참여하기', 'lc-button')}</p>`;
  return `<form action="${e(ctx.base)}/actions/${e(action)}" method="post"><input type="hidden" name="csrf" value="${e(ctx.session.csrf)}"><input type="hidden" name="mode" value="${ctx.mode}"><input type="hidden" name="routing" value="${ctx.publicRouting ? 'public' : 'isolated'}">${Object.entries(fields).map(([k,v])=>`<input type="hidden" name="${e(k)}" value="${e(v)}">`).join('')}${textarea ? `<p><label class="lc-label" for="body-${e(action)}">${text(textarea.label)} (${textarea.max}자)</label><textarea class="lc-input" id="body-${e(action)}" name="body" rows="4" cols="35"></textarea></p>` : ''}<button class="lc-button" type="submit">${text(label)}</button></form>`;
}
export function threadCard(ctx: ViewContext, value: unknown, detail = false): string {
  const p = obj(value), author = obj(p.author || p.creator), stats = obj(p.stats), id = String(p.id || '');
  return `<div class="lc-card"><p class="lc-eyebrow">THREAD <span class="lc-muted">${text(String(p.created_at || '').slice(0, 16).replace('T', ' '))}</span></p><h2>${text(author.display_name || author.handle || 'ZUKU 사용자')}</h2><p>${paragraph(p.body, 5000)}</p><p class="lc-muted">좋아요 ${text(p.like_count ?? stats.like_count ?? 0)} · 답글 ${text(p.reply_count ?? stats.reply_count ?? 0)}</p>${detail ? form(ctx, 'like-post', p.is_liked ? '좋아요 취소' : '좋아요', {id, liked:p.is_liked ? '0' : '1'}) : link(ctx, '/thread/' + encodeURIComponent(id), '대화 열기', 'lc-button')}</div>`;
}

type MediaKind = 'video' | 'audio';
interface MediaSource { url: string; mime?: string }
function safeMediaHttpUrl(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().startsWith('/xpi/')) return safeHttpUrl(`https://www.zuzunza.com${value.trim()}`);
  return safeHttpUrl(value);
}
function legacyMediaUrl(value: unknown, thumbnail = false): string | undefined {
  const safe = safeMediaHttpUrl(value);
  if (!safe) return undefined;
  try {
    const parsed = new URL(safe);
    const match = parsed.hostname.toLowerCase() === 'api.zuzunza.com' && parsed.pathname.match(/^\/gateway\/myflash\/(\d+)(?:\.swf)?$/i);
    if (!match) return safe;
    const id = Number(match[1]);
    if (!Number.isSafeInteger(id) || id < 1) return undefined;
    let directory = 'swf';
    if (id <= 50_000) directory = 'pre_swf/01';
    else if (id <= 100_000) directory = 'pre_swf/02';
    else if (id <= 150_000) directory = 'pre_swf/03';
    else if (id <= 200_000) directory = 'pre_swf/04';
    else if (id <= 250_000) directory = 'pre_swf/05';
    else if (id <= 300_000) directory = 'pre_swf/06';
    else if (id <= 350_000) directory = 'pre_swf/07';
    else if (id <= 400_000) directory = 'pre_swf/08';
    else if (id <= 450_000) directory = 'pre_swf/09';
    else if (id <= 500_000) directory = 'pre_swf/10';
    const objectKey = `myflash/${directory}/${id}.swf`;
    return thumbnail || /[?&]kind=thumbnail(?:&|$)/i.test(parsed.search)
      ? `https://www.zuzunza.com/xpi/api/media/thumbnail?key=${encodeURIComponent(objectKey)}`
      : `https://cdn.zuzunza.com/${objectKey}`;
  } catch { return undefined; }
}
function mediaExtension(value: string): string {
  try {
    const pathname = new URL(value).pathname.toLowerCase();
    const match = pathname.match(/\.([a-z0-9]{2,8})$/);
    return match?.[1] || '';
  } catch { return ''; }
}
function mediaMime(value: string): string | undefined {
  return ({
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
    mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', mov: 'video/quicktime',
    flv: 'video/x-flv', swf: 'application/x-shockwave-flash',
    mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg',
    webma: 'audio/webm', wma: 'audio/x-ms-wma', asf: 'video/x-ms-asf', wmv: 'video/x-ms-wmv'
  } as Record<string, string>)[mediaExtension(value)];
}
function mediaKind(value: Record<string, unknown>, sources: MediaSource[]): MediaKind | undefined {
  const extensionMimes = sources.map(source => source.mime).filter(Boolean) as string[];
  if (extensionMimes.some(mime => mime.startsWith('audio/'))) return 'audio';
  if (extensionMimes.some(mime => mime.startsWith('video/'))) return 'video';
  if (extensionMimes.some(mime => mime.startsWith('image/'))) return undefined;
  const type = String(value.type || '').toLowerCase();
  if (/(image|photo|picture)/.test(type)) return undefined;
  if (/(audio|voice|music|sound)/.test(type) || String(value.category || '').toLowerCase() === 'vine') return 'audio';
  if (/(video|media|movie|animation)/.test(type) || ['hype', 'swipe'].includes(String(value.category || '').toLowerCase())) return 'video';
  return undefined;
}
function mediaSources(value: Record<string, unknown>): MediaSource[] {
  const sources: MediaSource[] = [];
  const conversion = obj(value.conversion);
  const playback = conversion.status === 'ready' ? legacyMediaUrl(conversion.playback_url) : undefined;
  const original = legacyMediaUrl(value.media_url);
  for (const url of [playback, original]) {
    if (url && !sources.some(source => source.url === url)) sources.push({ url, mime: mediaMime(url) });
  }
  return sources;
}
function mediaFallback(source: MediaSource, kind: MediaKind): string {
  const mime = source.mime || (kind === 'video' ? 'video/mp4' : 'audio/mpeg');
  const height = kind === 'video' ? '240' : '64';
  // IE6–8 cannot decode HTML5 media. The object/embed path lets an installed
  // Windows Media or Flash player use the same approved URL; the link remains
  // useful when no plugin is present and does not claim that decoding is local.
  return `<object class="lc-media-object" data="${e(source.url)}" type="${e(mime)}" width="100%" height="${height}"><param name="src" value="${e(source.url)}"><param name="URL" value="${e(source.url)}"><param name="autoStart" value="0"><param name="ShowControls" value="1"><embed src="${e(source.url)}" type="${e(mime)}" width="100%" height="${height}" autostart="0" showcontrols="1"></embed><a class="lc-button lc-media-fallback" href="${e(source.url)}">미디어 파일 열기</a></object>`;
}
function mediaPlayer(value: Record<string, unknown>): string {
  const sources = mediaSources(value), kind = mediaKind(value, sources);
  if (!kind || !sources.length) return '';
  const conversion = obj(value.conversion), poster = legacyMediaUrl(conversion.poster_url, true) || legacyMediaUrl(value.thumbnail_url, true);
  const sourceTags = sources.map(source => `<source src="${e(source.url)}"${source.mime ? ` type="${e(source.mime)}"` : ''}>`).join('');
  const fallback = mediaFallback(sources[0]!, kind);
  if (kind === 'audio') return `<div class="lc-media lc-media-audio-wrap"><audio class="lc-media-audio" controls="controls" preload="none">${sourceTags}${fallback}</audio></div>`;
  return `<div class="lc-media lc-media-video-wrap"><video class="lc-media-video" controls="controls" preload="none"${poster ? ` poster="${e(poster)}"` : ''}>${sourceTags}${fallback}</video></div>`;
}
export function contentDetail(ctx: ViewContext, value: unknown): string {
  const c = obj(value), creator = obj(c.creator), id = String(c.id || '');
  const permitted = c.can_view_full !== false && c.body_masked !== true;
  const media = permitted ? legacyMediaUrl(c.media_url) : undefined, thumbnail = permitted ? legacyMediaUrl(c.thumbnail_url, true) : undefined;
  const actions = form(ctx, 'like-content', c.is_liked ? '좋아요 전환' : '좋아요', {id}) + form(ctx, 'bookmark', '보관함에 추가 / 해제', {id}) + form(ctx, 'comment', '댓글 남기기', {id}, {label:'댓글',max:1000});
  const player = permitted ? mediaPlayer(c) : '';
  return intro(String(c.title || '창작물'), String(creator.display_name || creator.handle || 'ZUKU 창작자')) + panel('작품 소개', `<p>${permitted ? paragraph(c.description) : '이 작품은 현재 공개된 정보만 표시합니다.'}</p><p class="lc-muted">${text(c.category)} · ${text(c.type)}</p>${player}${media && !player ? `<p><a class="lc-button" href="${e(media)}">미디어 파일 열기</a></p>` : ''}${thumbnail ? `<p><a href="${e(thumbnail)}">대표 이미지 열기</a></p>` : ''}`) + actionPanel(ctx, '함께하기', actions);
}
export function comments(list: unknown[]): string {
  return panel('댓글', list.length ? list.slice(0, 12).map(value => {const c = obj(value), a = obj(c.author || c.user); return `<div class="lc-card"><p><strong>${text(a.display_name || a.handle || 'ZUKU 사용자')}</strong></p><p>${paragraph(c.body,1000)}</p></div>`;}).join('') : '<p>첫 댓글을 남겨 보세요.</p>');
}
export function profile(ctx: ViewContext, value: unknown): string {
  const p = obj(value), stats = obj(p.stats);
  return intro(String(p.display_name || p.handle || '프로필'), '@' + String(p.handle || '')) + panel('소개', `<p>${paragraph(p.bio)}</p><p>팔로워 ${text(stats.follower_count ?? p.follower_count ?? 0)} · 작품 ${text(stats.content_count ?? p.content_count ?? 0)}</p><p><a class="lc-button" href="${e(ctx.modernOrigin + '/profile/' + encodeURIComponent(String(p.handle || '')))}">모던 프로필</a></p>`);
}
export function capabilityPage(ctx: ViewContext): string {
  const rows = [
    ['피드 · 검색 · 작품 · 프로필', '서버 HTML, 자바스크립트 없이 이용'],
    ['Thread · 공개 댓글', '기존 ZUKU 콘텐츠를 같은 주소에서 열람'],
    ['NeonUX-LC', 'DOM 기본, 지원 시 canvas / VML. 텍스트 모드 선택 가능'],
    ['영상 · 음악 · 게임', '소개와 대화 이용 가능. 재생은 코덱·엔진 지원에 따름'],
    ['Internet Explorer 6–11', '같은 Classic 화면. IE6 실기기 검증 완료, IE7–11 자동 분기·ES3·CSS2 계약 검사 완료']
  ];
  if (ctx.secure) rows.splice(2, 0, ['글·답글·좋아요·보관함', '연결한 기존 ZUKU 계정과 API 사용']);
  return intro('작은 브라우저의 사용 설명서', '기기에 맞는 표현으로 같은 ZUKU를 둘러봅니다.') + panel('지원 기능', `<table class="lc-table" summary="기능별 지원 범위"><thead><tr><th>기능</th><th>지원 방식</th></tr></thead><tbody>${rows.map(r=>`<tr><th>${text(r[0])}</th><td>${text(r[1])}</td></tr>`).join('')}</tbody></table>`);
}
