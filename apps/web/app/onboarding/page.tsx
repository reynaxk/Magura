'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { LeaderRow } from '@/components/terminal';
import { Wordmark } from '@/components/logo';
import { Avatar, Toggle } from '@/components/ui';

const STEPS = [
  ['Connect a wallet', 'Your keys, your coins', 'Connect your wallet', 'Magura is non-custodial. Trades run from your own wallet and we never hold your funds.'],
  ['Your style', 'So your feed fits you', 'What are you here for?', 'We use this to fill your feed, coin rooms and trader suggestions.'],
  ['Find your people', 'Traders and groups', 'Follow traders, join groups', 'Start with a few. Your DMs, group calls and live streams come from here.'],
  ['Copy safety', 'Limits before you copy', 'Set your safety limits', 'Copy trading mirrors someone else’s buys. Decide your limits now, while you’re calm.'],
] as const;
const INTERESTS = ['Majors', 'Memecoins', 'DeFi', 'AI tokens', 'New launches', 'Long-term holds', 'Day trading', 'Learning'];

export default function OnboardingPage() {
  const { me, login } = useSession();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [picks, setPicks] = useState<string[]>(['Majors']);
  const [level, setLevel] = useState<'new' | 'some' | 'pro'>('some');
  const [followed, setFollowed] = useState<string[]>([]);
  const [joined, setJoined] = useState<string[]>([]);
  const [safe, setSafe] = useState({ cap: true, stop: true, memes: false, confirm: true });
  const leaders = useQuery({ queryKey: ['leaderboard', 30], queryFn: () => api<LeaderRow[]>('/copy/leaderboard?days=30'), enabled: step === 2 });
  const groups = useQuery({ queryKey: ['groups'], queryFn: () => api<{ slug: string; name: string; color: string; _count: { members: number } }[]>('/groups'), enabled: step === 2 });

  async function finish() {
    await api('/me', { method: 'PATCH', body: { interests: picks, experience: level } });
    await api('/me/settings', {
      method: 'PATCH',
      body: { copyMemecoins: safe.memes, copyStopLossPct: safe.stop ? 20 : 100, copyConfirmAboveUsd: safe.confirm ? 500 : 1_000_000, copyMaxPerBuyUsd: safe.cap ? 250 : 100_000 },
    });
    router.push('/');
  }

  const [, , heading, desc] = STEPS[step];
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="panel flex w-full max-w-[1120px] flex-wrap overflow-hidden rounded-[28px]">
        <aside className="flex max-w-[360px] flex-[1_1_300px] flex-col gap-8 border-r border-line bg-bar p-8">
          <Wordmark />
          <div className="flex flex-col gap-2">
            
            <span className="text-[28px] font-semibold leading-tight tracking-tight">
              Trade together.
              <br />
              Copy the best.
            </span>
          </div>
          <ol className="flex flex-col gap-1.5">
            {STEPS.map(([t, sub], i) => (
              <li key={t}>
                <button
                  onClick={() => (me || i === 0 ? setStep(i) : undefined)}
                  className={`flex w-full items-center gap-3.5 rounded-[14px] border p-3 text-left ${i === step ? 'border-lime-line bg-lime-dim' : 'border-transparent'}`}
                >
                  <span className={`num flex h-[30px] w-[30px] items-center justify-center rounded-[10px] text-[13px] ${i <= step ? 'bg-lime text-bg' : 'bg-[#1A1D26] text-muted'}`}>{i < step ? '✓' : i + 1}</span>
                  <span className="flex flex-col">
                    <span className="text-sm font-semibold">{t}</span>
                    <span className="text-xs text-muted">{sub}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </aside>

        <main className="flex min-w-0 flex-[999_1_520px] flex-col gap-7 p-10">
          <div className="flex flex-col gap-2">
            <span className="num text-xs text-lime">STEP {step + 1} OF 4</span>
            <h1 className="text-[30px] font-semibold tracking-tight">{heading}</h1>
            <p className="text-[15px] leading-relaxed text-muted">{desc}</p>
          </div>

          {step === 0 &&
            (me ? (
              <div className="flex items-center gap-3 rounded-2xl border border-lime-line bg-lime-dim p-4 text-sm">
                <Avatar name={me.handle} size={40} /> Signed in as <b>@{me.handle}</b> · {me.wallets.length} wallet{me.wallets.length === 1 ? '' : 's'} linked
              </div>
            ) : (
              <button className="btn-lime h-[52px] self-start px-7 text-[15px]" onClick={login}>
                Connect wallet or continue with email
              </button>
            ))}

          {step === 1 && (
            <>
              <div className="flex flex-wrap gap-2.5">
                {INTERESTS.map((i) => {
                  const on = picks.includes(i);
                  return (
                    <button key={i} onClick={() => setPicks(on ? picks.filter((x) => x !== i) : [...picks, i])} className={`h-11 rounded-full border px-[18px] text-sm font-semibold ${on ? 'border-lime bg-lime text-bg' : 'border-line-3 text-text-2'}`}>
                      {i}
                    </button>
                  );
                })}
              </div>
              <div className="grid grid-cols-3 gap-2.5">
                {(
                  [
                    ['new', 'New', 'First time trading'],
                    ['some', 'Some', 'Traded a few months'],
                    ['pro', 'Experienced', 'Trading for years'],
                  ] as const
                ).map(([id, l, sub]) => (
                  <button key={id} onClick={() => setLevel(id)} className={`flex flex-col gap-1 rounded-2xl border p-4 text-left ${level === id ? 'border-lime bg-lime-dim' : 'border-line-2 bg-raised'}`}>
                    <span className="font-semibold">{l}</span>
                    <span className="text-xs text-muted">{sub}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {step === 2 && (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3">
              {leaders.data?.slice(0, 4).map((t) => {
                const on = followed.includes(t.handle);
                return (
                  <div key={t.handle} className="flex items-center gap-3 rounded-2xl border border-line-2 bg-raised p-3.5">
                    <Avatar name={t.handle} src={t.avatarUrl} size={42} shape="circle" />
                    <span className="flex flex-col">
                      <span className="text-sm font-semibold">{t.handle}</span>
                      <span className="text-xs text-muted">{t.copiers} copiers</span>
                    </span>
                    <button
                      className={`ml-auto h-[34px] rounded-xl px-3.5 text-xs font-semibold ${on ? 'border border-lime-line text-lime' : 'bg-lime text-bg'}`}
                      onClick={() => api(`/users/${t.handle}/follow`, { method: on ? 'DELETE' : 'POST' }).then(() => setFollowed(on ? followed.filter((x) => x !== t.handle) : [...followed, t.handle]))}
                    >
                      {on ? 'Following' : 'Follow'}
                    </button>
                  </div>
                );
              })}
              {groups.data?.slice(0, 4).map((g) => {
                const on = joined.includes(g.slug);
                return (
                  <div key={g.slug} className="flex items-center gap-3 rounded-2xl border border-line-2 bg-raised p-3.5">
                    <span className="flex h-[42px] w-[42px] items-center justify-center rounded-xl text-[13px] font-semibold text-bar" style={{ background: g.color }}>
                      {g.name.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="flex flex-col">
                      <span className="text-sm font-semibold">{g.name}</span>
                      <span className="text-xs text-muted">Group · {g._count.members} members</span>
                    </span>
                    <button
                      className={`ml-auto h-[34px] rounded-xl px-3.5 text-xs font-semibold ${on ? 'border border-lime-line text-lime' : 'bg-lime text-bg'}`}
                      onClick={() => api(`/groups/${g.slug}/join`, { method: on ? 'DELETE' : 'POST' }).then(() => setJoined(on ? joined.filter((x) => x !== g.slug) : [...joined, g.slug]))}
                    >
                      {on ? 'Joined' : 'Join'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {step === 3 && (
            <div className="rounded-[18px] border border-line-2 bg-raised px-[18px] py-2">
              <Toggle on={safe.cap} onChange={(v) => setSafe({ ...safe, cap: v })} label="Cap each copied buy" hint="Never more than $250 in one copied buy" />
              <Toggle on={safe.stop} onChange={(v) => setSafe({ ...safe, stop: v })} label="Auto-stop at -20%" hint="Stop copying a trader if you’re down 20% with them" />
              <Toggle on={safe.memes} onChange={(v) => setSafe({ ...safe, memes: v })} label="Allow memecoins in copies" hint="Off: only copy buys of established tokens" />
              <Toggle on={safe.confirm} onChange={(v) => setSafe({ ...safe, confirm: v })} label="Confirm large copies" hint="Ask me before any copied buy over $500" />
            </div>
          )}

          <div className="mt-auto flex items-center gap-3 pt-2">
            <button className="btn-ghost h-[52px] px-6" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>
              Back
            </button>
            <span className="flex-1" />
            {step < 3 ? (
              <button className="btn-lime h-[52px] px-7" disabled={!me} onClick={() => setStep(step + 1)}>
                Continue
              </button>
            ) : (
              <button className="btn-lime h-[52px] px-7" onClick={finish}>
                Enter Magura
              </button>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
