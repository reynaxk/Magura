import type { Metadata, Viewport } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import './globals.css';
import { Providers } from './providers';
import { Header } from '@/components/header';

export const metadata: Metadata = {
  title: { default: 'Magura — Social spot trading', template: '%s · Magura' },
  description: 'Social spot trading terminal. Trade together, copy the best, live in every coin.',
};

export const viewport: Viewport = { themeColor: '#07090A', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-screen font-sans">
        <Providers>
          <Header />
          <main className="pb-[76px] md:pb-0">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
