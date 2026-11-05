'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { CHAINS, fmtAge, type ChainId } from '@magura/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Avatar, Empty, Icon } from '@/components/ui';
import { toast } from '@/components/toaster';

interface Rewards {
  code: string;
  invitedBy: string | null;
  totals: { invites: number; trading: number; earnedUsd: number; last7dUsd: number; claimableUsd: number; minClaimUsd: number };
  invites: { handle: string; avatarUrl: string | null; joinedAt: string; trades: number; earnedUsd: number }[];
  claims: { id: string; amountUsd: number; status: string; chain: ChainId; txHash: string | null; createdAt: string }[];
}

const usd = (v: number) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function RewardsPage() {
  const { me, login } = useSession();
  const qc = useQueryClient();
  const [chain, setChain] = useState<ChainId>('solana');
  const r = useQuery({ queryKey: ['rewards'], queryFn: () => api<Rewards>('/me/rewards'), enabled: !!me });
  const claim = useMutation({
    mutationFn: () => api('/me/rewards/claim', { body: { chain } }),
    onSuccess: () => {
      toast({ title: 'Claim sent', body: 'Paid to your wallet within 48 hours', tone: 'lime' });
      qc.invalidateQueries({ queryKey: ['rewards'] });
    },
    onError: (e) => toast({ title: 'Could not claim', body: (e as Error).message.replace(/_/g, ' ') }),
  });

  if (!me)
    return (
      <Empty icon={Icon.trend} title="Log in to see your rewards" action={<button className="btn-lime h-10 px-5" onClick={login}>Log in</button>}>
        Invite friends: they pay 10% less, you earn 25% of their fees.
      </Empty>
    );

  const link = typeof window !== 'undefined' ? `${window.location.origin}/r/${me.handle}` : `/r/${me.handle}`;
  const t = r.data?.totals;
  const canClaim = !!t && t.claimableUsd >= t.minClaimUsd && !r.data?.claims.some((c) => c.status === 'requested');

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-5 p-3 md:p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-[28px] font-semibold tracking-tight md:text-[32px]">Rewards</h1>
        <p className="text-sm text-muted">Friends who join with your link pay 10% less on every trade. You earn 25% of the fees they pay, for good.</p>
      </div>

      <section className="panel flex flex-col gap-3 p-5">
        <span className="label">Your invite link</span>
        <div className="flex flex-wrap items-center gap-2">
          <code className="num flex h-11 min-w-0 flex-1 items-center truncate rounded-xl border border-line-2 bg-raised px-3.5 text-sm">{link}</code>
          <button
            className="btn-lime h-11 px-5"
            onClick={() => navigator.clipboard.writeText(link).then(() => toast({ title: 'Link copied', body: 'Share it anywhere', tone: 'lime' }))}
          >
            Copy
          </button>
          <a
            className="btn-ghost h-11 px-5"
            target="_blank"
            rel="noreferrer"
            href={`https://x.com/intent/post?text=${encodeURIComponent('I trade on Magura. Join with my link for 10% off fees:')}&url=${encodeURIComponent(link)}`}
          >
            Post on X
          </a>
        </div>
        {r.data?.invitedBy && <span className="text-xs text-muted">You joined with @{r.data.invitedBy}&apos;s link, so your fees are 10% lower.</span>}
      </section>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ['Friends invited', t ? String(t.invites) : '—'],
          ['Trading', t ? String(t.trading) : '—'],
          ['Earned all time', t ? usd(t.earnedUsd) : '—'],
          ['Last 7 days', t ? usd(t.last7dUsd) : '—'],
        ].map(([k, v]) => (
          <div key={k} className="panel flex flex-col gap-1 p-4">
            <span className="text-xs text-muted">{k}</span>
            <span className="num text-xl font-semibold">{v}</span>
          </div>
        ))}
      </div>

      <section className="panel flex flex-wrap items-center gap-4 p-5">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted">Ready to claim</span>
          <span className="num text-[32px] font-semibold text-lime">{t ? usd(t.claimableUsd) : '—'}</span>
          <span className="text-xs text-faint">Claim from {t ? usd(t.minClaimUsd) : '$10'} · paid in the chain&apos;s coin within 48h</span>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="claim-chain">
            Pay out on
          </label>
          <select id="claim-chain" value={chain} onChange={(e) => setChain(e.target.value as ChainId)} className="input h-11 w-40 text-sm">
            {(Object.keys(CHAINS) as ChainId[]).map((c) => (
              <option key={c} value={c}>
                {CHAINS[c].name}
              </option>
            ))}
          </select>
          <button className="btn-lime h-11 px-6" disabled={!canClaim || claim.isPending} onClick={() => claim.mutate()}>
            {claim.isPending ? 'Sending…' : 'Claim'}
          </button>
        </div>
      </section>

      <section className="panel flex flex-col overflow-hidden">
        <h2 className="border-b border-line px-5 py-4 text-[15px] font-semibold">Your friends</h2>
        {r.data?.invites.length ? (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="label text-left">
                <th className="py-2.5 pl-5 font-medium">Trader</th>
                <th className="px-2 font-medium">Joined</th>
                <th className="px-2 text-right font-medium">Trades</th>
                <th className="pr-5 text-right font-medium">You earned</th>
              </tr>
            </thead>
            <tbody>
              {r.data.invites.map((i) => (
                <tr key={i.handle} className="border-t border-line">
                  <td className="py-2.5 pl-5">
                    <span className="flex items-center gap-2.5">
                      <Avatar name={i.handle} src={i.avatarUrl} size={28} />@{i.handle}
                    </span>
                  </td>
                  <td className="num px-2 text-muted">{fmtAge(i.joinedAt)} ago</td>
                  <td className="num px-2 text-right">{i.trades}</td>
                  <td className="num pr-5 text-right text-lime">{usd(i.earnedUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty icon={Icon.chat} title="No friends yet">
            Share your link. Every friend who trades earns you a share of the fees.
          </Empty>
        )}
      </section>

      {!!r.data?.claims.length && (
        <section className="panel flex flex-col gap-2 p-5">
          <h2 className="text-[15px] font-semibold">Payouts</h2>
          {r.data.claims.map((c) => (
            <div key={c.id} className="flex items-center gap-3 border-t border-line py-2.5 text-[13px] first:border-0">
              <span className="num">{usd(c.amountUsd)}</span>
              <span className="text-muted">{CHAINS[c.chain].name}</span>
              <span className={`ml-auto rounded-md border px-2 py-0.5 text-[11px] ${c.status === 'paid' ? 'border-lime-line text-lime' : c.status === 'rejected' ? 'border-down-line text-down-2' : 'border-line-3 text-text-2'}`}>
                {c.status === 'requested' ? 'Processing' : c.status === 'paid' ? 'Paid' : 'Rejected'}
              </span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
