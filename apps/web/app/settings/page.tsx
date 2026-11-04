'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CHAIN_IDS, CHAINS, shortAddr } from '@magura/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { toast } from '@/components/toaster';
import { Avatar, Empty, Toggle } from '@/components/ui';

const SECTIONS = [
  ['profile', 'Profile'],
  ['wallets', 'Wallets'],
  ['trading', 'Trading'],
  ['copy', 'Copy defaults'],
  ['notif', 'Notifications'],
  ['privacy', 'Privacy & chat'],
  ['security', 'Security'],
] as const;
type Section = (typeof SECTIONS)[number][0];

const NOTIFS = [
  ['copy', 'Copied trades', 'A trader you copy buys or sells'],
  ['call', 'Calls', 'Incoming calls and group calls'],
  ['dm', 'Direct messages', 'New DMs and requests'],
  ['live', 'Going live', 'Someone you follow starts a stream'],
  ['price', 'Price alerts', 'Your saved alerts hit'],
  ['group', 'Group chat', 'Mentions and replies'],
] as const;

export default function SettingsPage() {
  const { me, login, logout, refresh } = useSession();
  const qc = useQueryClient();
  const [sec, setSec] = useState<Section>('profile');
  const [s, setS] = useState<Record<string, any>>({});
  const [profile, setProfile] = useState({ displayName: '', handle: '', bio: '', avatarUrl: '' });

  useEffect(() => {
    if (!me) return;
    setS(me.settings ?? {});
    setProfile({ displayName: me.displayName ?? '', handle: me.handle, bio: me.bio ?? '', avatarUrl: me.avatarUrl ?? '' });
  }, [me]);

  const saveSettings = useMutation({
    mutationFn: (patch: Record<string, unknown>) => api('/me/settings', { method: 'PATCH', body: patch }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
    onError: (e) => toast({ title: "Couldn't save", body: (e as Error).message }),
  });
  const saveProfile = useMutation({
    mutationFn: () =>
      api('/me', {
        method: 'PATCH',
        body: Object.fromEntries(Object.entries(profile).filter(([, v]) => v !== '')),
      }),
    onSuccess: () => {
      toast({ title: 'Profile saved', body: '', tone: 'lime' });
      refresh();
    },
    onError: (e) => toast({ title: "Couldn't save", body: (e as Error).message.replace(/_/g, ' ') }),
  });

  const set = (k: string, v: unknown) => {
    setS((x) => ({ ...x, [k]: v }));
    saveSettings.mutate({ [k]: v });
  };

  if (!me)
    return (
      <Empty title="Log in to change settings">
        <button className="btn-lime mt-3" onClick={login}>
          Log in
        </button>
      </Empty>
    );

  return (
    <div className="mx-auto flex w-full max-w-[1360px] flex-wrap items-start gap-6 p-6">
      <nav aria-label="Settings sections" className="flex max-w-[260px] flex-[1_1_220px] flex-col gap-1">
        <h1 className="mb-3 text-[26px] font-semibold tracking-tight">Settings</h1>
        {SECTIONS.map(([id, label]) => (
          <button key={id} onClick={() => setSec(id)} className={`h-11 rounded-xl px-3.5 text-left text-sm font-semibold ${sec === id ? 'bg-hover text-text' : 'text-muted hover:text-text'}`}>
            {label}
          </button>
        ))}
        <button onClick={() => logout()} className="mt-4 h-11 rounded-xl px-3.5 text-left text-sm font-semibold text-down-2 hover:bg-down-dim">
          Log out
        </button>
      </nav>

      <section className="panel flex min-w-0 flex-[999_1_600px] flex-col gap-5 p-6">
        {sec === 'profile' && (
          <>
            <h2 className="text-lg font-semibold">Profile</h2>
            <div className="flex items-center gap-4">
              <Avatar name={me.handle} src={profile.avatarUrl || null} size={72} />
              <label className="flex flex-1 flex-col gap-1.5 text-xs text-muted">
                Photo URL
                <input className="input" value={profile.avatarUrl} onChange={(e) => setProfile({ ...profile, avatarUrl: e.target.value })} placeholder="https://…" />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <label className="flex flex-col gap-1.5 text-xs text-muted">
                Display name
                <input className="input" value={profile.displayName} onChange={(e) => setProfile({ ...profile, displayName: e.target.value })} maxLength={40} />
              </label>
              <label className="flex flex-col gap-1.5 text-xs text-muted">
                Username
                <input className="input num" value={profile.handle} onChange={(e) => setProfile({ ...profile, handle: e.target.value.toLowerCase() })} maxLength={20} />
              </label>
            </div>
            <label className="flex flex-col gap-1.5 text-xs text-muted">
              Bio
              <textarea rows={3} className="input h-auto py-3" value={profile.bio} onChange={(e) => setProfile({ ...profile, bio: e.target.value })} maxLength={280} />
            </label>
            <button className="btn-lime self-start" onClick={() => saveProfile.mutate()} disabled={saveProfile.isPending}>
              Save profile
            </button>
            <div>
              <Toggle on={!!s.publicPnl} onChange={(v) => set('publicPnl', v)} label="Public PnL" hint="Show your trades and returns on your profile" />
              <Toggle on={!!s.showHoldings} onChange={(v) => set('showHoldings', v)} label="Show holdings" hint="Let others see what you hold" />
              <Toggle on={!!s.copyable} onChange={(v) => set('copyable', v)} label="Let others copy me" hint="Appear on the Copy leaderboard" />
            </div>
          </>
        )}

        {sec === 'wallets' && (
          <>
            <h2 className="text-lg font-semibold">Wallets</h2>
            {me.wallets.length === 0 && <span className="text-sm text-muted">No wallets linked yet. Log in with a wallet or let Magura create one.</span>}
            {me.wallets.map((w) => (
              <div key={w.id} className="flex items-center gap-3.5 rounded-2xl border border-line-2 bg-raised p-4">
                <Avatar name={w.label ?? w.chainKind} size={42} />
                <span className="flex flex-col">
                  <span className="font-semibold">{w.label ?? (w.chainKind === 'svm' ? 'Solana wallet' : 'EVM wallet')}</span>
                  <span className="num text-xs text-muted">{shortAddr(w.address, 6)}</span>
                </span>
                <span className="ml-auto flex gap-2">
                  {w.isPrimary && <span className="rounded-md border border-lime-line px-2 py-0.5 text-[11px] font-semibold text-lime">PRIMARY</span>}
                  <span className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${w.delegated ? 'border-violet-line text-violet-2' : 'border-line-3 text-muted'}`}>
                    {w.delegated ? 'AUTO-COPY ON' : 'CONFIRM EACH COPY'}
                  </span>
                </span>
              </div>
            ))}
          </>
        )}

        {sec === 'trading' && (
          <>
            <h2 className="text-lg font-semibold">Trading</h2>
            <p className="text-[13px] text-muted">Quick-buy amounts used in Trenches, per chain.</p>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {CHAIN_IDS.map((c) => (
                <label key={c} className="flex flex-col gap-1.5 text-xs text-muted">
                  {CHAINS[c].name} ({CHAINS[c].nativeSymbol})
                  <input
                    className="input num"
                    defaultValue={(s.quickBuyAmounts ?? {})[c] ?? ''}
                    onBlur={(e) => set('quickBuyAmounts', { ...(s.quickBuyAmounts ?? {}), [c]: e.target.value || '0.1' })}
                  />
                </label>
              ))}
            </div>
            <label className="flex max-w-[220px] flex-col gap-1.5 text-xs text-muted">
              Default slippage (%)
              <input className="input num" defaultValue={((s.slippageBps ?? 100) / 100).toString()} onBlur={(e) => set('slippageBps', Math.round(Number(e.target.value || 1) * 100))} />
            </label>
          </>
        )}

        {sec === 'copy' && (
          <>
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold">Copy defaults</h2>
              <p className="text-[13px] text-muted">Used for every new trader you copy. Change them per trader on their profile.</p>
            </div>
            <div className="grid grid-cols-3 gap-4">
              {[
                ['copyBudgetUsd', 'Total copy budget ($)'],
                ['copyMaxPerBuyUsd', 'Max per copied buy ($)'],
                ['copyStopLossPct', 'Auto-stop at loss (%)'],
              ].map(([k, l]) => (
                <label key={k} className="flex flex-col gap-1.5 text-xs text-muted">
                  {l}
                  <input className="input num" defaultValue={String(Number(s[k] ?? 0))} onBlur={(e) => set(k, Number(e.target.value || 0))} />
                </label>
              ))}
            </div>
            <div>
              <Toggle on={!!s.copySells} onChange={(v) => set('copySells', v)} label="Copy sells too" hint="Exit when the trader exits" />
              <Toggle on={!!s.copyMemecoins} onChange={(v) => set('copyMemecoins', v)} label="Include memecoins" hint="Copy buys of new launches" />
              <Toggle on={!!s.copyBuyExisting} onChange={(v) => set('copyBuyExisting', v)} label="Buy into current holdings" hint="Match their portfolio when you start" />
            </div>
            <label className="flex max-w-[260px] flex-col gap-1.5 text-xs text-muted">
              Confirm copied buys over ($)
              <input className="input num" defaultValue={String(Number(s.copyConfirmAboveUsd ?? 500))} onBlur={(e) => set('copyConfirmAboveUsd', Number(e.target.value || 0))} />
            </label>
          </>
        )}

        {sec === 'notif' && (
          <>
            <h2 className="text-lg font-semibold">Notifications</h2>
            <div className="label grid grid-cols-[1fr_80px_80px] gap-2.5 border-b border-line pb-2">
              <span>Event</span>
              <span className="text-center">Push</span>
              <span className="text-center">In-app</span>
            </div>
            {NOTIFS.map(([k, label, hint]) => {
              const cur = (s.notifications ?? {})[k] ?? { push: true, app: true };
              const flip = (f: 'push' | 'app') => set('notifications', { ...(s.notifications ?? {}), [k]: { ...cur, [f]: !cur[f] } });
              return (
                <div key={k} className="grid grid-cols-[1fr_80px_80px] items-center gap-2.5">
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm font-semibold">{label}</span>
                    <span className="text-xs text-muted">{hint}</span>
                  </span>
                  {(['push', 'app'] as const).map((f) => (
                    <input key={f} type="checkbox" aria-label={`${f} for ${label}`} checked={!!cur[f]} onChange={() => flip(f)} className="h-5 w-5 justify-self-center accent-lime" />
                  ))}
                </div>
              );
            })}
          </>
        )}

        {sec === 'privacy' && (
          <>
            <h2 className="text-lg font-semibold">Privacy & chat</h2>
            <div>
              <Toggle on={!!s.dmsFromAnyone} onChange={(v) => set('dmsFromAnyone', v)} label="DMs from anyone" hint="Off: people you don't follow land in Requests" />
              <Toggle on={!!s.showInWorld} onChange={(v) => set('showInWorld', v)} label="Show me in World chat" hint="Your messages appear in the global room" />
              <Toggle on={!!s.readReceipts} onChange={(v) => set('readReceipts', v)} label="Read receipts" hint="Show when you've read a DM" />
              <Toggle on={!!s.autoJoinVoice} onChange={(v) => set('autoJoinVoice', v)} label="Auto-join group voice" hint="Join voice when you open a group" />
              <Toggle on={!!s.hideBalanceOnStream} onChange={(v) => set('hideBalanceOnStream', v)} label="Hide balance on stream" hint="Blur balances while live or sharing screen" />
            </div>
          </>
        )}

        {sec === 'security' && (
          <>
            <h2 className="text-lg font-semibold">Security</h2>
            <div className="flex items-center gap-3.5 rounded-2xl border border-line-2 bg-raised p-4">
              <span className="flex flex-col">
                <span className="font-semibold">Login & two-factor</span>
                <span className="text-xs text-muted">Managed by your Privy account</span>
              </span>
            </div>
            <div className="flex items-center gap-3.5 rounded-2xl border border-down-line bg-down-dim p-4">
              <span className="flex flex-col">
                <span className="font-semibold">Stop all copying</span>
                <span className="text-xs text-muted">Pause every copy subscription right now</span>
              </span>
              <button
                className="btn-danger ml-auto"
                onClick={() => api('/copy/stop-all', { method: 'POST' }).then(() => toast({ title: 'All copying paused', body: 'Resume any trader from Portfolio' }))}
              >
                Stop all
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
