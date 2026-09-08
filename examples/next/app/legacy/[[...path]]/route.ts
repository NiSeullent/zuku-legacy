import { handleLegacy } from '../../../lib/legacy-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = handleLegacy;
export const HEAD = handleLegacy;
export const POST = handleLegacy;
