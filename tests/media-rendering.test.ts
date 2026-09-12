import assert from 'node:assert/strict';
import test from 'node:test';
import { contentDetail, type ViewContext } from '../packages/legacy-core/src/views.js';

const context: ViewContext = {
  base: '/legacy', mode: 'auto', secure: false, bridge: false,
  modernOrigin: 'https://www.zuzunza.com', path: '/content/demo', publicRouting: true
};

const creator = { display_name: '작가', handle: 'author' };

test('content detail emits a converted HTML5 video and an IE6–8 object fallback', () => {
  const html = contentDetail(context, {
    id: 'video-1', category: 'swipe', type: 'vertical_video', title: '영상', description: '설명', creator,
    media_url: 'https://cdn.example.test/source.mov',
    thumbnail_url: 'https://cdn.example.test/poster.jpg',
    conversion: { status: 'ready', playback_url: 'https://cdn.example.test/playback.mp4', poster_url: 'https://cdn.example.test/converted-poster.jpg' }
  });

  assert.match(html, /<video class="lc-media-video" controls="controls" preload="none" poster="https:\/\/cdn\.example\.test\/converted-poster\.jpg">/);
  assert.match(html, /<source src="https:\/\/cdn\.example\.test\/playback\.mp4" type="video\/mp4">/);
  assert.match(html, /<source src="https:\/\/cdn\.example\.test\/source\.mov" type="video\/quicktime">/);
  assert.match(html, /<object class="lc-media-object"[^>]+data="https:\/\/cdn\.example\.test\/playback\.mp4"/);
  assert.match(html, /<embed src="https:\/\/cdn\.example\.test\/playback\.mp4" type="video\/mp4"/);
  assert.doesNotMatch(html, /지원되지 않|보안 연결이 필요/);
});

test('Vine audio uses the same source order and old plugin fallback', () => {
  const html = contentDetail(context, {
    id: 'audio-1', category: 'vine', type: 'audio_track', title: '음악', description: '', creator,
    media_url: 'https://cdn.example.test/track.mp3'
  });

  assert.match(html, /<audio class="lc-media-audio" controls="controls" preload="none">/);
  assert.match(html, /<source src="https:\/\/cdn\.example\.test\/track\.mp3" type="audio\/mpeg">/);
  assert.match(html, /<object class="lc-media-object"[^>]+type="audio\/mpeg"/);
});

test('media URLs are still filtered and masked content emits no player or private URL', () => {
  const untrusted = contentDetail(context, {
    id: 'bad-media', category: 'hype', type: 'horizontal_media', title: '잘못된 주소', description: '', creator,
    media_url: 'http://cdn.example.test/private.mp4', conversion: { status: 'ready', playback_url: 'javascript:alert(1)' }
  });
  assert.doesNotMatch(untrusted, /<video|<audio|<object|private\.mp4|javascript:/);

  const masked = contentDetail(context, {
    id: 'masked', category: 'hype', type: 'horizontal_media', title: '비공개', description: 'private description', creator,
    media_url: 'https://cdn.example.test/private.mp4', can_view_full: false
  });
  assert.doesNotMatch(masked, /<video|<audio|<object|private\.mp4/);
  assert.doesNotMatch(masked, /private description/);
});

test('dead myflash gateway media is rewritten to the existing CDN contract', () => {
  const html = contentDetail(context, {
    id: 'flash-1', category: 'jump', type: 'game', title: '옛 게임', description: '', creator,
    media_url: 'https://api.zuzunza.com/gateway/myflash/50001.swf',
    thumbnail_url: 'https://api.zuzunza.com/gateway/myflash/50001.swf?kind=thumbnail'
  });

  assert.match(html, /https:\/\/cdn\.zuzunza\.com\/myflash\/pre_swf\/02\/50001\.swf/);
  assert.match(html, /https:\/\/www\.zuzunza\.com\/xpi\/api\/media\/thumbnail\?key=myflash%2Fpre_swf%2F02%2F50001\.swf/);
  assert.doesNotMatch(html, /api\.zuzunza\.com\/gateway\/myflash/);
});
