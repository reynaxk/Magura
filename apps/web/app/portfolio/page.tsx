'use client';

import Link from 'next/link';
import { AddFunds } from '@/components/add-funds';
import { RecapCard } from '@/components/recap-share';
import { PnlCalendar } from '@/components/pnl-calendar';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fmtUsd, type SwapTx } from '@magura/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { toast } from '@/components/toaster';
import { Avatar, Delta, Empty, Icon } from '@/components/ui';

interface Portfolio {
  realizedUsd: number;
  roiPct: number | null;
  winRatePct: number | null;
  positions: { chain: string; address: string; symbol: string; qty: string; costUsd: number; source: string }[];
}
interface Sub {
  id: string;
  mode: string;
  budgetUsd: string;
  maxPerBuyUsd: string;
  status: 'active' | 'paused' | 'stopped';
  memecoins: boolean;
  copySells: boolean;
  realizedPnlUsd: string;
  leader: { handle: string; avatarUrl: string | null };
  _count: { executions: number };
}
interface Pending {
  id: string;
  side: 'buy' | 'sell';
  chain: string;
  tokenAddress: string;
  tokenSymbol: string;
  amountUsd: string;
  subscription: { leader: { handle: string } };
}
interface Notif {
  id: string;
  kind: string;
  title: string;
  body: string;
  href: string | null;
  createdAt: string;
}

export default function PortfolioPage() {
  const { me, login, addressFor, sendSwap } = useSession();
  const qc = useQueryClient();
  const pf = useQuery({ queryKey: ['portfolio'], queryFn: () => api<Portfolio>('/me/portfolio'), enabled: !!me });
  const subs = useQuery({ queryKey: ['copy-subs'], queryFn: () => api<Sub[]>('/copy/subscriptions'), enabled: !!me });
  const pending = useQuery({ queryKey: ['copy-pending'], queryFn: () => api<Pending[]>('/copy/pending'), enabled: !!me });
  const activity = useQuery({ queryKey: ['notifications'], queryFn: () => api<Notif[]>('/notifications'), enabled: !!me });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: Sub['status'] }) => api(`/copy/subscriptions/${id}`, { method: 'PATCH', body: { status } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['copy-subs'] }),
  });

  async function confirm(p: Pending) {
    const wallet = addressFor(p.chain as any);
    if (!wallet) return toast({ title: 'No wallet', body: `Connect a wallet for ${p.chain}` });
    try {
      const r = await api<{ quoteId: string; tx: SwapTx }>(`/copy/executions/${p.id}/confirm`, { body: { wallet } });
      const txHash = await sendSwap(r.tx);
      await api('/trades', { body: { quoteId: r.quoteId, chain: p.chain, side: p.side, tokenAddress: p.tokenAddress, tokenSymbol: p.tokenSymbol, txHash, copyExecutionId: p.id } });
      toast({ title: 'Copied', body: `${p.side} ${p.tokenSymbol}`, tone: 'lime' });
    } catch (e) {
      toast({ title: 'Copy failed', body: (e as Error).message });
    } finally {
      qc.invalidateQueries({ queryKey: ['copy-pending'] });
    }
  }

  if (!me)
    return (
      <Empty icon={Icon.trend} title="Log in to see your portfolio">
        <button className="btn-lime mt-3" onClick={login}>
          Log in
        </button>
      </Empty>
    );

  const p = pf.data;
  const deployed = p?.positions.reduce((s, x) => s + x.costUsd, 0) ?? 0;
  const bySource = new Map<string, number>();
  p?.positions.forEach((x) => bySource.set(x.source, (bySource.get(x.source) ?? 0) + x.costUsd));
  const palette = ['#2FE39A', '#1FA673', '#8A93A6', '#5B6375', '#C9CFDA', '#3A404D'];

  return (
    <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-5 p-4 md:p-6">
      {!!pending.data?.length && (
        <section className="panel flex flex-col gap-3 border-lime-line! p-5">
          <h2 className="text-[17px] font-semibold">Copies waiting for you</h2>
          {pending.data.map((x) => (
            <div key={x.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-raised p-3.5">
              <Avatar name={x.subscription.leader.handle} size={34} />
              <span className="text-sm">
                <b>@{x.subscription.leader.handle}</b> {x.side === 'buy' ? 'bought' : 'sold'} <b>{x.tokenSymbol}</b> · your size ~{fmtUsd(Number(x.amountUsd))}
              </span>
              <div className="ml-auto flex gap-2">
                <button className="btn-lime h-9" onClick={() => confirm(x)}>
                  Confirm
                </button>
                <button className="btn-ghost h-9" onClick={() => api(`/copy/executions/${x.id}/skip`, { method: 'POST' }).then(() => qc.invalidateQueries({ queryKey: ['copy-pending'] }))}>
                  Skip
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      <Link href="/rewards" className="panel flex items-center gap-3 p-4 hover:bg-hover md:hidden">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-lime-line bg-lime-dim text-lime">%</span>
        <span className="flex flex-col">
          <span className="text-sm font-semibold">Invite friends, earn 25% of their fees</span>
          <span className="text-xs text-muted">They pay 10% less. Open Rewards</span>
        </span>
      </Link>

      <div className="flex flex-wrap gap-5">
        <section className="panel flex min-w-0 flex-[999_1_560px] flex-col gap-4 p-6">
          <div className="flex items-center gap-3">
            <span className="text-[13px] text-muted">Deployed in open positions</span>
            <span className="ml-auto">
              <AddFunds />
            </span>
          </div>
          <span className="num text-[40px] font-semibold tracking-tight">{fmtUsd(deployed, { compact: false })}</span>
          <div className="num flex flex-wrap gap-6 text-[13px]">
            <span>
              <span className="font-sans text-muted">Realized</span> <span className={(p?.realizedUsd ?? 0) >= 0 ? 'text-lime' : 'text-down'}>{fmtUsd(p?.realizedUsd ?? 0, { compact: false })}</span>
            </span>
            <span>
              <span className="font-sans text-muted">ROI</span> <Delta value={p?.roiPct} />
            </span>
            <span><span className="font-sans text-muted">Win rate</span> {p?.winRatePct != null ? `${p.winRatePct.toFixed(0)}%` : '—'}</span>
          </div>
        </section>
        <section className="panel flex flex-[1_1_300px] flex-col gap-4 p-6">
          <h2 className="text-[17px] font-semibold">Where your money is</h2>
          <div className="flex h-3.5 gap-[3px] overflow-hidden rounded-full">
            {[...bySource.entries()].map(([k, v], i) => (
              <div key={k} style={{ width: `${(v / (deployed || 1)) * 100}%`, background: palette[i % palette.length] }} />
            ))}
          </div>
          {[...bySource.entries()].map(([k, v], i) => (
            <div key={k} className="flex items-center gap-2.5 text-[13px]">
              <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: palette[i % palette.length] }} />
              {k.startsWith('copy:') ? `Copied from ${k.slice(5)}` : k === 'manual' ? 'Your own trades' : k === 'quickbuy' ? 'Trenches quick buys' : k}
              <span className="num ml-auto text-text-2">{fmtUsd(v)}</span>
            </div>
          ))}
          {bySource.size === 0 && <span className="text-sm text-muted">No open positions</span>}
        </section>
      </div>

      <div className="flex flex-wrap items-start gap-5">
        <section className="panel min-w-0 flex-[999_1_560px] px-5 pb-3 pt-4">
          <div className="mb-2 flex items-center">
            <h2 className="text-[17px] font-semibold">Holdings</h2>
            <span className="ml-auto text-xs text-muted">Spot only</span>
          </div>
          {p?.positions.length ? (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="label border-b border-line text-left">
                  <th className="py-2.5 font-medium">Token</th>
                  <th className="font-medium">Chain</th>
                  <th className="font-medium">Cost basis</th>
                  <th className="font-medium">Source</th>
                </tr>
              </thead>
              <tbody>
                {p.positions.map((x) => (
                  <tr key={`${x.chain}:${x.address}`} className="border-b border-[#151820]">
                    <td className="py-3">
                      <Link href={`/t/${x.chain}/${x.address}`} className="flex items-center gap-2.5 font-semibold">
                        <Avatar name={x.symbol} size={28} shape="circle" />
                        {x.symbol}
                      </Link>
                    </td>
                    <td className="text-muted">{x.chain}</td>
                    <td className="num">{fmtUsd(x.costUsd)}</td>
                    <td className="text-text-2">{x.source.startsWith('copy:') ? `@${x.source.slice(5)}` : x.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty icon={Icon.trend} title="No holdings yet">Buy on Hunt or Trenches, or copy a trader.</Empty>
          )}
        </section>

        <section className="panel flex flex-[1_1_340px] flex-col gap-3 p-5">
          <div className="flex items-center">
            <h2 className="text-[17px] font-semibold">Who you copy</h2>
            <Link href="/copy" className="ml-auto text-xs text-lime">
              Find traders
            </Link>
          </div>
          {subs.data?.map((s) => (
            <div key={s.id} className="flex flex-col gap-2.5 rounded-2xl border border-line-2 bg-raised p-3.5">
              <div className="flex items-center gap-2.5">
                <Avatar name={s.leader.handle} src={s.leader.avatarUrl} size={36} />
                <div className="flex flex-col">
                  <Link href={`/u/${s.leader.handle}`} className="text-sm font-semibold">
                    {s.leader.handle}
                  </Link>
                  <span className="text-[11px] text-muted">
                    {s.mode} · {s.memecoins ? 'incl. memecoins' : 'no memecoins'}
                  </span>
                </div>
                <span className={`ml-auto rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${s.status === 'active' ? 'border-lime-line text-lime' : 'border-[#4A3A1E] text-amber'}`}>{s.status.toUpperCase()}</span>
              </div>
              <div className="num grid grid-cols-3 gap-1.5 text-[11px]">
                <span className="flex flex-col">
                  <span className="font-sans text-muted">Budget</span>
                  {fmtUsd(Number(s.budgetUsd))}
                </span>
                <span className="flex flex-col">
                  <span className="font-sans text-muted">Copies</span>
                  {s._count.executions}
                </span>
                <span className="flex flex-col">
                  <span className="font-sans text-muted">Max/buy</span>
                  {fmtUsd(Number(s.maxPerBuyUsd))}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <button className="btn-ghost h-9 text-xs" onClick={() => setStatus.mutate({ id: s.id, status: s.status === 'active' ? 'paused' : 'active' })}>
                  {s.status === 'active' ? 'Pause' : 'Resume'}
                </button>
                <button className="btn-danger h-9 text-xs" onClick={() => setStatus.mutate({ id: s.id, status: 'stopped' })}>
                  Stop
                </button>
              </div>
            </div>
          ))}
          {subs.data?.length === 0 && <span className="text-sm text-muted">You&apos;re not copying anyone yet.</span>}
        </section>
      </div>

      <PnlCalendar />
      <RecapCard />

      <section id="activity" className="panel flex flex-col p-5">
        <h2 className="mb-2 text-[17px] font-semibold">Activity</h2>
        {activity.data?.map((n) => (
          <div key={n.id} className="flex items-center gap-3 border-b border-[#151820] py-2.5 text-[13px] last:border-0">
            <span className="rounded-md border border-line-3 px-1.5 py-0.5 text-[10px] uppercase text-muted">{n.kind}</span>
            <span className="font-semibold">{n.title}</span>
            <span className="text-text-2">{n.body}</span>
            <span className="ml-auto text-[11px] text-faint">{new Date(n.createdAt).toLocaleString()}</span>
          </div>
        ))}
        {activity.data?.length === 0 && <span className="text-sm text-muted">Nothing yet.</span>}
      </section>
    </div>
  );
}
