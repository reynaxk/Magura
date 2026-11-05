'use client';

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { toast } from './toaster';

/** After sign-up, link the account to whoever invited it (stored by /r/<code>). */
export function RefAttach() {
  const { me } = useSession();
  const qc = useQueryClient();
  const done = useRef(false);
  useEffect(() => {
    if (!me || done.current) return;
    let code: string | null = null;
    try {
      code = localStorage.getItem('magura:ref');
    } catch {
      return;
    }
    if (!code || code.toLowerCase() === me.handle.toLowerCase()) return;
    done.current = true;
    api<{ ok: boolean; inviter: string; already?: boolean }>('/me/referral', { body: { code } })
      .then((r) => {
        if (!r.already) toast({ title: `Invited by @${r.inviter}`, body: 'You pay 10% less on every trade', tone: 'lime' });
        qc.invalidateQueries({ queryKey: ['rewards'] });
      })
      .catch(() => undefined)
      .finally(() => {
        try {
          localStorage.removeItem('magura:ref');
        } catch {
          /* ignore */
        }
      });
  }, [me, qc]);
  return null;
}
