'use client';

import { use, useEffect } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Avatar } from '@/components/ui';
import { LogoMark } from '@/components/logo';

/** Invite landing: remembers who invited you, then sends you in. */
export default function InvitePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const { me, login, ready } = useSession();
  const inviter = useQuery({ queryKey: ['invite', code], queryFn: () => api<{ handle: string; displayName: string | null; avatarUrl: string | null }>(`/invite/${code}`), retry: false });
  useEffect(() => {
    if (inviter.data) {
      try {
        localStorage.setItem('magura:ref', inviter.data.handle);
      } catch {
        /* private mode */
      }
    }
  }, [inviter.data]);

  return (
    <div className="flex min-h-app items-center justify-center p-4">
      <div className="panel flex w-full max-w-md flex-col items-center gap-5 p-8 text-center">
        <LogoMark size={48} />
        {inviter.data ? (
          <>
            <Avatar name={inviter.data.handle} src={inviter.data.avatarUrl} size={64} />
            <div className="flex flex-col gap-1.5">
              <h1 className="text-2xl font-semibold tracking-tight">@{inviter.data.handle} invited you</h1>
              <p className="text-sm text-muted">Join Magura and pay 10% less on every trade, for good.</p>
            </div>
          </>
        ) : inviter.isError ? (
          <h1 className="text-xl font-semibold">This invite link isn&apos;t valid</h1>
        ) : (
          <div className="h-[140px]" />
        )}
        <ul className="flex w-full flex-col gap-2 text-left text-sm text-text-2">
          {['Find coins early with Hunt and Trenches', 'Copy the best traders automatically', 'Chat, call and stream inside every coin'].map((t) => (
            <li key={t} className="flex items-center gap-2.5 rounded-xl bg-raised px-3 py-2.5">
              <span className="h-1.5 w-1.5 rounded-full bg-lime" />
              {t}
            </li>
          ))}
        </ul>
        {me ? (
          <Link href="/" className="btn-lime h-12 w-full">
            Start hunting
          </Link>
        ) : (
          <button className="btn-lime h-12 w-full" onClick={login} disabled={!ready}>
            Create account
          </button>
        )}
        <p className="text-[11px] text-faint">Magura never asks for your seed phrase or for signatures to &ldquo;accept terms&rdquo;. Only trust this site&apos;s address.</p>
      </div>
    </div>
  );
}
