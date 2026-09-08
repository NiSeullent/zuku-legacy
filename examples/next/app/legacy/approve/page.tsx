import DeviceApproval from '../../../components/DeviceApproval';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Legacy 기기 연결 | ZUKU', robots: { index: false, follow: false } };

export default async function ApprovalPage({ searchParams }: {
  searchParams: Promise<{ code?: string | string[] }>;
}) {
  const params = await searchParams;
  // The standalone example has no account system. Install integration/ZukuApproval
  // in the real host to supply its existing auth-backed confirmation callback.
  return <DeviceApproval code={typeof params.code === 'string' ? params.code : ''} />;
}
