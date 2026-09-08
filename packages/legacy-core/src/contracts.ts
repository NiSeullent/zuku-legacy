/** Wire projections of the existing ZUKU /api/v1 contract, not new domain models. */
export type Category = 'hype' | 'swipe' | 'jump' | 'vive' | 'vine';
export const CATEGORIES: readonly Category[] = ['hype', 'swipe', 'jump', 'vive', 'vine'];

export interface ApiMeta { request_id?: string; timestamp?: string; version?: string }
export type ApiEnvelope<T> =
  | { success: true; data: T; meta?: ApiMeta }
  | { success: false; error: { code: string; message: string }; meta?: ApiMeta };

export interface Pagination {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
  next_cursor: string | null;
  prev_cursor: string | null;
}

export interface Creator {
  id: string;
  display_name: string;
  handle: string;
  avatar_url: string;
  is_verified: boolean;
}

export interface ContentStats {
  like_count: number;
  comment_count: number;
  view_count: number;
  share_count: number;
  bookmark_count: number;
}

export interface Content {
  id: string;
  category: Category;
  type: string;
  title: string;
  description: string;
  thumbnail_url: string;
  media_url?: string | null;
  creator: Creator;
  stats: ContentStats;
  tags?: string[];
  is_liked?: boolean;
  is_bookmarked?: boolean;
  created_at: string;
  updated_at?: string;
  locked?: boolean;
  can_view_full?: boolean;
  body_masked?: boolean;
  jump?: { genre?: string; status?: string; play_count?: number; [key: string]: unknown };
  [key: string]: unknown;
}

export interface FeedData { feeds: Content[]; pagination: Pagination; sort?: string }
export interface GamesData { games: Content[]; pagination: Pagination }
export interface SearchData { results: Content[]; pagination: Pagination; query: string; mode?: string }

/** Vive/Vine have a distinct upstream envelope; only presentation pagination is adapted. */
export interface ReadingFeedData {
  items: Content[];
  page: number;
  per_page: number;
  total: number;
  has_more: boolean;
  sort?: string;
}

export interface PostStem {
  content_id: string;
  category: Category;
  type: string;
  title: string;
  thumbnail_url?: string | null;
  canonical_host?: string;
  canonical_path?: string;
}
export interface Post {
  id: string;
  author: Creator;
  body: string;
  parent_id?: string | null;
  root_id?: string;
  like_count: number;
  reply_count: number;
  is_liked: boolean;
  is_deleted?: boolean;
  created_at: string;
  updated_at?: string;
  content_id?: string | null;
  stem?: PostStem;
}
export interface ThreadData { posts: Post[]; next_cursor: string | null; root_id?: string }
export interface Comment {
  id: string;
  parent_id: string | null;
  user: Creator;
  body: string;
  like_count: number;
  reply_count: number;
  is_liked: boolean;
  is_deleted?: boolean;
  created_at: string;
  updated_at?: string;
}
export interface CommentsData { comments: Comment[]; pagination: Pagination }
export interface LikeData { is_liked: boolean; like_count: number }
export interface BookmarkData { is_bookmarked: boolean; bookmark_count: number }
export interface AuthUser {
  id: string;
  display_name: string;
  handle: string;
  email?: string;
  role?: string;
  avatar_url?: string | null;
  created_at?: string;
}
export interface CreatorProfile extends Creator {
  bio?: string | null;
  website_url?: string | null;
  follower_count?: number;
  following_count?: number;
  content_count?: number;
  post_count?: number;
  is_following?: boolean;
}
