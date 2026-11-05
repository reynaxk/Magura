'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { SessionProvider } from '@/lib/session';
import { SocketProvider } from '@/lib/socket';
import { Toaster } from '@/components/toaster';
import { RefAttach } from '@/components/ref-attach';

export function Providers({ children }: { children: ReactNode }) {
  const [qc] = useState(
    () => new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1, staleTime: 10_000 } } }),
  );
  return (
    <QueryClientProvider client={qc}>
      <SessionProvider>
        <SocketProvider>
          {children}
          <Toaster />
          <RefAttach />
        </SocketProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
}
