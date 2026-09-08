export const pagination = {page:1,per_page:12,total:24,total_pages:2,has_next:true,has_prev:false,next_cursor:null,prev_cursor:null};
export const creator={id:'usr_demo',handle:'creator',display_name:'ZUKU 테스트 창작자',avatar_url:'',is_verified:false};
export const content={id:'cnt_demo',category:'hype',type:'image',title:'작은 화면에 담은 넓은 세계',description:'테스트용 콘텐츠입니다. 같은 API와 같은 이야기를 더 가볍게 만납니다.',thumbnail_url:'',media_url:null,creator,stats:{like_count:24,comment_count:2,view_count:120,share_count:0,bookmark_count:3},created_at:'2026-09-08T00:00:00Z'};
export const post={id:'pst_demo',author:creator,body:'오래된 브라우저에서도, 새로운 이야기는 계속됩니다.',like_count:3,reply_count:1,is_liked:false,created_at:'2026-09-08T00:00:00Z'};
export function fixtureFetch(input,init) {
  const url=new URL(String(input)),path=url.pathname.replace('/api/v1','');
  let data;
  if (path.startsWith('/feeds')) data={feeds:[content,{...content,id:'cnt_demo2',category:'jump',title:'가볍게 시작하는 오늘의 게임'},{...content,id:'cnt_demo3',category:'vive',title:'천천히 읽는 오후의 기록'}],pagination:{...pagination,page:Number(url.searchParams.get('page')||1),has_prev:url.searchParams.get('page')==='2',has_next:url.searchParams.get('page')!=='2'}};
  else if (path==='/search') data={results:[content],pagination,query:url.searchParams.get('q')};
  else if (path.endsWith('/comments')) data={comments:[{id:'cmt_demo',user:creator,body:'반가워요. 이 댓글도 같은 ZUKU에 남습니다.',like_count:0,reply_count:0,is_liked:false,parent_id:null,created_at:post.created_at}],pagination:{...pagination,total:1,has_next:false}};
  else if (path.startsWith('/contents/')) data={content};
  else if (path==='/thread/posts'||path.endsWith('/thread')) data={posts:[post],next_cursor:null};
  else if (path.startsWith('/creators/')) data={creator:{...creator,bio:'테스트 프로필',follower_count:5,content_count:3}};
  else if(path==='/auth/me') data={user:{id:'usr_demo',display_name:creator.display_name,handle:creator.handle}};
  else return Promise.resolve(Response.json({success:false,error:{code:'NOT_FOUND',message:'테스트 항목을 찾지 못했습니다.'}},{status:404}));
  return Promise.resolve(Response.json({success:true,data}));
}
