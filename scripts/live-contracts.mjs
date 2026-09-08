import { ZukuApi } from '@zuku/legacy-core';
const api=new ZukuApi({origin:process.env.ZUKU_API_ORIGIN || 'http://127.0.0.1:30012'});
const report=[];
for (const category of [undefined,'hype','swipe','jump','vive','vine']) {
  const feed=await api.feed(category);
  if (!Array.isArray(feed.feeds) || !feed.pagination) throw new Error(`Invalid ${category || 'all'} feed`);
  report.push({route:'feed/'+(category||'all'),items:feed.feeds.length,page:feed.pagination.page});
  if (!category && feed.feeds[0]) {
    const content=await api.content(feed.feeds[0].id);
    const comments=await api.comments(content.id);
    if (!Array.isArray(comments.comments)) throw new Error('Invalid comments');
    report.push({route:'content+comments',ok:!!content.id});
  }
}
const search=await api.search('게임');
const thread=await api.thread();
if (!Array.isArray(search.results) || !Array.isArray(thread.posts)) throw new Error('Invalid search/thread');
report.push({route:'search',items:search.results.length},{route:'thread',items:thread.posts.length});
if (thread.posts[0]) { const conversation=await api.postThread(thread.posts[0].id); report.push({route:'thread/detail',items:conversation.posts.length}); }
console.log(JSON.stringify({mode:'read-only',report},null,2));
