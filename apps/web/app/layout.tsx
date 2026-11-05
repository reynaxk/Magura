import type { Metadata, Viewport } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import './globals.css';
import { Providers } from './providers';
import { Header } from '@/components/header';
import { StatusBar } from '@/components/status-bar';
import { Shortcuts } from '@/components/shortcuts';
import { InstallHint } from '@/components/install-hint';

export const metadata: Metadata = {
  title: { default: 'Magura — Social spot trading', template: '%s · Magura' },
  description: 'Social spot trading terminal. Trade together, copy the best, live in every coin.',
  appleWebApp: { capable: true, title: 'Magura', statusBarStyle: 'black-translucent' },
  icons: { apple: '/apple-touch-icon.png' },
};

export const viewport: Viewport = { themeColor: '#08090C', viewportFit: 'cover', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children, drawer }: { children: React.ReactNode; drawer: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-screen font-sans">
        <Providers>
          <Header />
          <main className="pb-[76px] md:pb-[30px]">{children}</main>
          {drawer}
          <StatusBar />
          <Shortcuts />
          <InstallHint />
        </Providers>
      </body>
    </html>
  );
}
