import type { ReactNode } from 'react';
import './style.css';

export const metadata = { title: 'ZUKU Legacy / Next.js adapter', description: 'A shared ZUKU client for classic browsers.' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="ko"><body><main>{children}</main></body></html>;
}
