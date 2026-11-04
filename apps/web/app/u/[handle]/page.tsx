'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fmtUsd } from '@magura/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { toast } from '@/components/toaster';
import { Avatar, Empty, Segmented, Toggle } from '@/components/ui';

interface Profile {
  id: string;
  handle: string;
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  badges: string[];
  followers: number;
  following: number;
  copiers: number;
  copyable: boolean;
  publicPnl: boolean;
  isFollowing: boolean;
  copyStatus: string | null;
}

interface TradeRow {
  id: string;
  chain: string;
  side: 'buy' | 'sell';
  tokenAddress: string;
  tokenSymbol: string;
  amountUsd: string | null;
  createdAt: string;
}

export default function ProfilePage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = use(params);
  const { me, login } = useSession();
  const qc = useQueryClient();
  const profile = useQuery({ queryKey: ['profile', handle], queryFn: () => api<Profile>(`/users/${handle}`) });
  const trades = useQuery({ queryKey: ['trades', handle], queryFn: () => api<TradeRow[]>(`/users/${handle}/trades`) });
  const p = profile.data;
  const isMe = me?.handle === handle;

  const follow = useMutation({
    mutationFn: () => api(`/users/${handle}/follow`, { method: p?.isFollowing ? 'DELETE' : 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['profile', handle] }),
  });
  const dm = useMutation({
    mutationFn: () => api<{ roomId: string }>(`/dms/with/${handle}`, { method: 'POST' }),
    onSuccess: (r) => (window.location.href = `/messages/${encodeURIComponent(r.roomId)}`),
  });

  if (profile.isError) return <Empty title="Trader not found" />;

  return (
    <div className="mx-auto flex w-full max-w-[1360px] flex-wrap items-start gap-5 p-6">
      <div className="flex min-w-0 flex-[999_1_640px] flex-col gap-5">
        <section className="panel overflow-hidden">
          <div className="h-24 border-b border-line bg-lime-dim" />
          <div className="-mt-10 flex flex-wrap items-end gap-4 px-6 pb-5">
            <span className="rounded-[26px] border-4 border-panel">
              <Avatar name={handle} src={p?.avatarUrl} size={84} />
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex items-center gap-2">
                <h1 className="text-[26px] font-semibold tracking-tight">{p?.displayName ?? handle}</h1>
                {p?.badges.includes('TOP_1') && <span className="rounded border border-violet-line px-1.5 text-[10px] text-violet-2">TOP 1%</span>}
              </div>
              <span className="text-[13px] text-muted">
                @{handle}
                {p?.bio ? ` · ${p.bio}` : ''}
              </span>
            </div>
            {!isMe && (
              <div className="ml-auto flex gap-2">
                <button className="btn-ghost" onClick={() => (me ? follow.mutate() : login())}>
                  {p?.isFollowing ? 'Following' : 'Follow'}
                </button>
                <button className="btn-ghost" onClick={() => (me ? dm.mutate() : login())}>
                  Message
                </button>
              </div>
            )}
          </div>
          <dl className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] border-t border-line">
            {[
              ['Followers', p?.followers],
              ['Following', p?.following],
              ['Copiers', p?.copiers],
              ['Trades shown', trades.data?.length],
            ].map(([k, v]) => (
              <div key={k as string} className="flex flex-col gap-1 border-r border-line px-5 py-4">
                <dt className="label">{k}</dt>
                <dd className="num text-lg">{v ?? '—'}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="panel px-5 pb-3 pt-4">
          <h2 className="mb-2 text-[17px] font-semibold">Trade history</h2>
          {p && !p.publicPnl ? (
            <Empty title="Private">This trader keeps their trades private.</Empty>
          ) : trades.data?.length ? (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="label border-b border-line text-left">
                  <th className="py-2.5 font-medium">Token</th>
                  <th className="font-medium">Action</th>
                  <th className="font-medium">Size</th>
                  <th className="font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {trades.data.map((t) => (
                  <tr key={t.id} className="border-b border-[#151820]">
                    <td className="py-3">
                      <Link href={`/t/${t.chain}/${t.tokenAddress}`} className="flex items-center gap-2.5 font-semibold">
                        <Avatar name={t.tokenSymbol} size={26} shape="circle" />
                        {t.tokenSymbol}
                      </Link>
                    </td>
                    <td className={`num ${t.side === 'buy' ? 'text-lime' : 'text-down'}`}>{t.side === 'buy' ? 'Buy' : 'Sell'}</td>
                    <td className="num">{t.amountUsd ? fmtUsd(Number(t.amountUsd)) : '—'}</td>
                    <td className="text-muted">{new Date(t.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty title="No trades yet" />
          )}
        </section>
      </div>

      {!isMe && p && <CopyPanel handle={handle} copyable={p.copyable} status={p.copyStatus} />}
    </div>
  );
}

function CopyPanel({ handle, copyable, status }: { handle: string; copyable: boolean; status: string | null }) {
  const { me, login } = useSession();
  const qc = useQueryClient();
  const d = me?.settings ?? {};
  const [mode, setMode] = useState<'proportional' | 'fixed'>('proportional');
  const [budget, setBudget] = useState(String(Number(d.copyBudgetUsd ?? 0) || 1000));
  const [maxPerBuy, setMaxPerBuy] = useState(String(Number(d.copyMaxPerBuyUsd ?? 250)));
  const [fixed, setFixed] = useState('100');
  const [stop, setStop] = useState(String(d.copyStopLossPct ?? 20));
  const [t, setT] = useState({ copySells: d.copySells ?? true, memecoins: d.copyMemecoins ?? false, buyExisting: d.copyBuyExisting ?? false });
  const active = status === 'active';

  const start = useMutation({
    mutationFn: () =>
      api(`/copy/${handle}`, {
        body: { mode, budgetUsd: Number(budget), maxPerBuyUsd: Number(maxPerBuy), fixedAmountUsd: mode === 'fixed' ? Number(fixed) : undefined, stopLossPct: Number(stop), ...t },
      }),
    onSuccess: () => {
      toast({ title: `Copying @${handle}`, body: 'Their next spot trades will mirror to you', tone: 'lime' });
      qc.invalidateQueries({ queryKey: ['profile', handle] });
    },
    onError: (e) => toast({ title: "Couldn't start copying", body: (e as Error).message.replace(/_/g, ' ') }),
  });

  if (!copyable) return <aside className="panel flex-[1_1_340px] p-6 text-sm text-muted">@{handle} doesn&apos;t allow copying.</aside>;

  return (
    <aside id="copy" aria-label="Copy settings" className="panel flex max-w-[420px] flex-[1_1_340px] flex-col gap-5 border-lime-line! p-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold">Copy {handle}</h2>
        <p className="text-[13px] text-muted">Spot only. Every buy and sell is mirrored at your size.</p>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-xs text-muted">Sizing</span>
        <Segmented
          label="Sizing mode"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'proportional', label: 'Proportional' },
            { value: 'fixed', label: 'Fixed amount' },
          ]}
        />
        <span className="text-xs leading-relaxed text-muted">
          {mode === 'proportional'
            ? `If ${handle} puts 10% of their wallet into a token, you put 10% of your budget in.`
            : 'Every copied buy uses the same fixed amount.'}
        </span>
      </div>
      <label className="flex flex-col gap-1.5 text-xs text-muted">
        Budget for this trader (USD)
        <input className="input num" value={budget} onChange={(e) => setBudget(e.target.value.replace(/[^\d.]/g, ''))} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        {mode === 'fixed' ? (
          <label className="flex flex-col gap-1.5 text-xs text-muted">
            Per buy (USD)
            <input className="input num" value={fixed} onChange={(e) => setFixed(e.target.value.replace(/[^\d.]/g, ''))} />
          </label>
        ) : (
          <label className="flex flex-col gap-1.5 text-xs text-muted">
            Max per buy (USD)
            <input className="input num" value={maxPerBuy} onChange={(e) => setMaxPerBuy(e.target.value.replace(/[^\d.]/g, ''))} />
          </label>
        )}
        <label className="flex flex-col gap-1.5 text-xs text-muted">
          Stop at loss (%)
          <input className="input num" value={stop} onChange={(e) => setStop(e.target.value.replace(/[^\d]/g, ''))} />
        </label>
      </div>
      <div>
        <Toggle on={t.copySells} onChange={(v) => setT({ ...t, copySells: v })} label="Copy sells too" hint="Exit when they exit, at the same %" />
        <Toggle on={t.memecoins} onChange={(v) => setT({ ...t, memecoins: v })} label="Include memecoins" hint="Off: only established tokens" />
        <Toggle on={t.buyExisting} onChange={(v) => setT({ ...t, buyExisting: v })} label="Buy into current holdings" hint="Match their portfolio right away" />
      </div>
      <button className={`btn h-[52px] rounded-[14px] text-base ${active ? 'border border-lime text-lime' : 'bg-lime text-bg'}`} onClick={() => (me ? start.mutate() : login())} disabled={start.isPending}>
        {active ? 'Update copy settings' : 'Start copying'}
      </button>
      <p className="text-[11px] leading-relaxed text-muted">
        Copies run automatically only if you grant Magura a session signer on your wallet; otherwise you confirm each copy in one tap. Past results don&apos;t
        guarantee future returns.
      </p>
    </aside>
  );
}
