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
export function link(ctx: ViewContext, path: string, label: string, cls = '') { return `<a${cls ? ` class="${e(cls)}"` : ''} href="${e(href(ctx, path))}">${text(label)}</a>`; }
export function document(ctx: ViewContext, title: string, body: string): string {
  const status = ctx.bridge ? '보안 브리지 연결' : ctx.secure ? 'HTTPS 연결' : 'HTTP · 공개 열람';
  const nav = PRODUCTS.map(p => `<li>${link(ctx, p.id ? '/' + p.id : '', p.name, (ctx.path === '/' + p.id || !p.id && ctx.path === '') ? 'lc-active' : '')}</li>`).join('');
  return `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN" "http://www.w3.org/TR/html4/loose.dtd">
<html lang="ko"><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><title>${text(title)} | ZUKU Legacy</title><link rel="stylesheet" type="text/css" href="${e(ctx.base)}/assets/neonux-lc.css?v=${CLASSIC_ASSET_REVISION}"></head>
<body class="lc-page" data-lc-mode="${ctx.mode}"><a class="lc-skip" href="#main">본문 바로가기</a><div class="lc-shell">
<div class="lc-header"><a class="lc-brand" href="${e(href(ctx))}"><span class="lc-brand-mark">Z</span> ZUKU <span class="lc-badge">LEGACY</span></a><p class="lc-muted">작은 기기에서도, 같은 세계로.</p><p class="lc-header-actions">${ctx.session?.user ? `${text(ctx.session.user.display_name || ctx.session.user.username)} 님 · ${link(ctx, '/account', '내 계정')}` : link(ctx, '/connect', '계정 연결', 'lc-button')}${link(ctx, '/settings', '화면 설정', 'lc-button')}</p></div>
<div class="lc-layout"><div class="lc-sidebar"><p class="lc-eyebrow">YOUR ZUKU</p><ul class="lc-nav">${nav}<li>${link(ctx, '/bookmarks', '보관함')}</li><li>${link(ctx, '/messages', '메시지')}</li></ul><div class="lc-panel"><div class="lc-panel-body" data-lc-surface="status"><p class="lc-badge">${status}</p><p class="lc-muted">${ctx.mode === 'text' ? '텍스트 모드 · 이미지와 효과 없음' : '가벼운 화면 · 자동 재생 없음'}</p>${link(ctx, '/compatibility', '지원 기능 보기')}</div></div></div>
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
  if (!ctx.secure) return `<p class="lc-notice">계정 작업에는 HTTPS 또는 보안 브리지 연결이 필요합니다. ${link(ctx, '/connect', '연결 안내')}</p>`;
  if (!ctx.session?.token) return `<p>${link(ctx, '/connect', '계정을 연결하고 참여하기', 'lc-button')}</p>`;
  return `<form action="${e(ctx.base)}/actions/${e(action)}" method="post"><input type="hidden" name="csrf" value="${e(ctx.session.csrf)}"><input type="hidden" name="mode" value="${ctx.mode}"><input type="hidden" name="routing" value="${ctx.publicRouting ? 'public' : 'isolated'}">${Object.entries(fields).map(([k,v])=>`<input type="hidden" name="${e(k)}" value="${e(v)}">`).join('')}${textarea ? `<p><label class="lc-label" for="body-${e(action)}">${text(textarea.label)} (${textarea.max}자)</label><textarea class="lc-input" id="body-${e(action)}" name="body" rows="4" cols="35"></textarea></p>` : ''}<button class="lc-button" type="submit">${text(label)}</button></form>`;
}
export function threadCard(ctx: ViewContext, value: unknown, detail = false): string {
  const p = obj(value), author = obj(p.author || p.creator), stats = obj(p.stats), id = String(p.id || '');
  return `<div class="lc-card"><p class="lc-eyebrow">THREAD <span class="lc-muted">${text(String(p.created_at || '').slice(0, 16).replace('T', ' '))}</span></p><h2>${text(author.display_name || author.handle || 'ZUKU 사용자')}</h2><p>${paragraph(p.body, 5000)}</p><p class="lc-muted">좋아요 ${text(p.like_count ?? stats.like_count ?? 0)} · 답글 ${text(p.reply_count ?? stats.reply_count ?? 0)}</p>${detail ? form(ctx, 'like-post', p.is_liked ? '좋아요 취소' : '좋아요', {id, liked:p.is_liked ? '0' : '1'}) : link(ctx, '/thread/' + encodeURIComponent(id), '대화 열기', 'lc-button')}</div>`;
}
export function contentDetail(ctx: ViewContext, value: unknown): string {
  const c = obj(value), creator = obj(c.creator), id = String(c.id || '');
  const permitted = c.can_view_full !== false && c.body_masked !== true;
  const media = permitted ? safeHttpUrl(c.media_url) : undefined, thumbnail = permitted ? safeHttpUrl(c.thumbnail_url) : undefined;
  return intro(String(c.title || '창작물'), String(creator.display_name || creator.handle || 'ZUKU 창작자')) + panel('작품 소개', `<p>${permitted ? paragraph(c.description) : '이 작품의 전문을 보려면 모던 ZUKU에서 열람 권한을 확인해 주세요.'}</p><p class="lc-muted">${text(c.category)} · ${text(c.type)}</p>${media ? `<p><a class="lc-button" href="${e(media)}">미디어 파일 열기 (HTTPS)</a></p>` : ''}${thumbnail ? `<p><a href="${e(thumbnail)}">대표 이미지 열기 (HTTPS)</a></p>` : ''}<p><a class="lc-button" href="${e(ctx.modernOrigin + '/content/' + encodeURIComponent(id))}">모던 플레이어로 열기</a></p><p class="lc-muted">영상·오디오 코덱과 게임 실행은 기기의 지원 여부에 따라 달라집니다. 브리지는 화면과 계정 연결을 보호하며 외부 미디어 파일을 변환하지 않습니다.</p>`) + panel('함께하기', form(ctx, 'like-content', c.is_liked ? '좋아요 전환' : '좋아요', {id}) + form(ctx, 'bookmark', '보관함에 추가 / 해제', {id}) + form(ctx, 'comment', '댓글 남기기', {id}, {label:'댓글',max:1000}));
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
    ['Thread · 답글 · 댓글 · 좋아요 · 보관함', '기존 API 공유. 계정 연결 및 보호된 전송 필요'],
    ['NeonUX-LC', 'DOM 기본, 지원 시 canvas / VML. 텍스트 모드 선택 가능'],
    ['영상 · 음악 · 게임', '소개와 대화 이용 가능. 재생은 코덱·엔진 지원에 따름'],
    ['메시지', '기존 종단간 암호화 필요. 모던 화면에서 이용'],
    ['패스키 · 결제 · Studio · 업로드 · 관리', '모던 ZUKU에서 이용'],
    ['IE6 실기기 검증', '아직 수행하지 않음. ES3 파싱·호환 API 테스트와 구분']
  ];
  return intro('작은 브라우저의 사용 설명서', '같은 ZUKU 계정과 콘텐츠. 기기에 맞는 표현 방식.') + panel('현재 지원 범위', `<table class="lc-table" summary="기능별 지원 범위"><thead><tr><th>기능</th><th>지원 방식</th></tr></thead><tbody>${rows.map(r=>`<tr><th>${text(r[0])}</th><td>${text(r[1])}</td></tr>`).join('')}</tbody></table>`) + panel('보호된 연결', '<p>공개 HTTP에서는 공개 콘텐츠만 읽을 수 있습니다. 계정 연결과 쓰기에는 HTTPS 또는 같은 기기의 루프백 보안 브리지가 필요합니다.</p><p>보안 브리지가 인증서를 검증하는 TLS 연결을 담당합니다. HTTP로 받은 자바스크립트 암호화는 통신 중 코드 변조를 막을 수 없어 TLS 대체제로 사용하지 않습니다.</p><p>최신 Node.js 브리지는 Windows XP에서 실행되지 않습니다. XP 기기는 별도로 검증한 호환 브리지 또는 운영체제 수준의 보호된 터널이 필요합니다. 일반 LAN의 HTTP 연결은 보호된 연결이 아닙니다.</p>') + panel('연결된 플랫폼', ['messages','settings','studio','wallet'].map(path=>`<p><a href="${e(ctx.modernOrigin + '/' + path)}">${text(path)} — 모던 화면</a></p>`).join(''));
}
