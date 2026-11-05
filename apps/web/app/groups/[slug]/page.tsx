'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { ChatPanel } from '@/components/chat-panel';
import { toast } from '@/components/toaster';
import { SocialTabs } from '@/components/header';
import { Avatar, Icon, Svg } from '@/components/ui';

interface Channel {
  id: string;
  name: string;
  topic: string | null;
  kind: 'text' | 'calls' | 'voice';
  roomId: string;
}
interface Group {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  rules: string | null;
  color: string;
  role: string | null;
  channels: Channel[];
  _count: { members: number };
}
interface Member {
  role: string;
  user: { id: string; handle: string; displayName: string | null; avatarUrl: string | null };
}

export default function GroupPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const { me, login } = useSession();
  const qc = useQueryClient();
  const router = useRouter();
  const group = useQuery({ queryKey: ['group', slug], queryFn: () => api<Group>(`/groups/${slug}`) });
  const members = useQuery({ queryKey: ['group', slug, 'members'], queryFn: () => api<Member[]>(`/groups/${slug}/members`) });
  const [channelId, setChannelId] = useState<string | null>(null);
  const g = group.data;
  const text = g?.channels.filter((c) => c.kind !== 'voice') ?? [];
  const voice = g?.channels.filter((c) => c.kind === 'voice') ?? [];
  const channel = text.find((c) => c.id === channelId) ?? text[0];

  const join = useMutation({
    mutationFn: () => api(`/groups/${slug}/join`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['group', slug] });
      qc.invalidateQueries({ queryKey: ['groups', 'mine'] });
    },
  });
  const startVoice = useMutation({
    mutationFn: (cid: string) => api<{ id: string }>('/calls', { body: { channelId: cid, video: false } }),
    onSuccess: (c) => router.push(`/call/${c.id}`),
    onError: (e) => toast({ title: "Couldn't join voice", body: (e as Error).message.replace(/_/g, ' ') }),
  });

  if (!g) return <div className="p-6 text-sm text-muted">{group.isError ? 'Group not found' : 'Loading…'}</div>;
  const isMember = !!g.role;

  return (
    <div className="flex h-app flex-col">
    <SocialTabs />
    <div className="flex min-h-0 flex-1 md:flex-wrap">
      <aside aria-label="Channels" className="hidden w-[260px] shrink-0 flex-col border-r border-line bg-bar md:flex">
        <div className="flex flex-col gap-3 border-b border-line p-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl text-sm font-semibold text-bar" style={{ background: g.color }}>
              {g.name.slice(0, 2).toUpperCase()}
            </span>
            <div className="flex min-w-0 flex-col">
              <span className="truncate font-semibold">{g.name}</span>
              <span className="text-xs text-muted">{g._count.members} members</span>
            </div>
          </div>
          {!isMember && (
            <button className="btn-lime h-9" onClick={() => (me ? join.mutate() : login())}>
              Join group
            </button>
          )}
        </div>
        <nav className="flex flex-col gap-0.5 p-2.5">
          <span className="label px-2 pb-1.5">Text</span>
          {text.map((c) => (
            <button
              key={c.id}
              onClick={() => setChannelId(c.id)}
              className={`flex h-9 items-center gap-2 rounded-[10px] px-2.5 text-left text-sm font-semibold ${channel?.id === c.id ? 'bg-[#1A1D26] text-text' : 'text-muted hover:text-text'}`}
            >
              <span className="num text-faint">#</span>
              {c.name}
            </button>
          ))}
          <span className="label px-2 pb-1.5 pt-4">Voice & video</span>
          {voice.map((c) => (
            <button key={c.id} onClick={() => (me ? startVoice.mutate(c.id) : login())} className="flex h-9 items-center gap-2 rounded-[10px] px-2.5 text-left text-sm font-semibold text-muted hover:bg-panel hover:text-text">
              <Svg d={Icon.mic} size={15} color="#9D8CFF" />
              {c.name}
              <span className="ml-auto text-[11px] text-lime">Join</span>
            </button>
          ))}
        </nav>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-col gap-2 border-b border-line px-4 py-3 md:hidden">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-[10px] text-xs font-semibold text-bar" style={{ background: g.color }}>
              {g.name.slice(0, 2).toUpperCase()}
            </span>
            <span className="font-semibold">{g.name}</span>
            <span className="text-xs text-muted">{g._count.members} members</span>
            {!isMember && (
              <button className="btn-lime ml-auto h-8 text-xs" onClick={() => (me ? join.mutate() : login())}>
                Join
              </button>
            )}
          </div>
          <div className="scroll-thin -mx-4 flex gap-1.5 overflow-x-auto px-4">
            {text.map((c) => (
              <button key={c.id} onClick={() => setChannelId(c.id)} className={`${channel?.id === c.id ? 'chip-on' : 'chip'} shrink-0`}>
                #{c.name}
              </button>
            ))}
            {voice.map((c) => (
              <button key={c.id} onClick={() => (me ? startVoice.mutate(c.id) : login())} className="chip shrink-0 gap-1.5 border-violet-line text-violet-2">
                <Svg d={Icon.mic} size={13} color="#B9AEFF" />
                {c.name}
              </button>
            ))}
          </div>
        </div>
        {channel && (
          <>
            <div className="hidden items-center gap-2.5 border-b border-line px-5 py-3.5 md:flex">
              <span className="num text-lg text-faint">#</span>
              <h1 className="text-[17px] font-semibold">{channel.name}</h1>
              <span className="truncate text-[13px] text-muted">{channel.topic}</span>
            </div>
            {g.rules && (
              <div className="mx-4 mt-3 hidden items-center gap-2.5 rounded-[14px] md:mx-5 md:mt-3.5 md:flex border border-[#2E2850] bg-violet-dim px-3.5 py-3 text-[13px] text-[#D9D2FF]">
                <Svg d={Icon.pin} size={16} color="#B9AEFF" />
                {g.rules}
              </div>
            )}
            <ChatPanel
              key={channel.roomId}
              roomId={channel.roomId}
              header={false}
              placeholder={isMember ? `Message #${channel.name}` : 'Join the group to post'}
              className="min-h-0 flex-1 pt-3"
            />
          </>
        )}
      </main>

      <aside aria-label="Members" className="hidden w-[240px] shrink-0 flex-col gap-1 overflow-y-auto border-l border-line bg-bar p-3 lg:flex">
        {['owner', 'lead', 'member'].map((role) => {
          const list = members.data?.filter((m) => m.role === role) ?? [];
          if (!list.length) return null;
          return (
            <div key={role} className="flex flex-col gap-0.5">
              <span className="label px-2 pb-1.5 pt-2.5">
                {role === 'member' ? 'Members' : role === 'lead' ? 'Leads' : 'Owner'} — {list.length}
              </span>
              {list.map((m) => (
                <Link key={m.user.id} href={`/u/${m.user.handle}`} className="flex items-center gap-2.5 rounded-[10px] px-2 py-1.5 hover:bg-panel">
                  <Avatar name={m.user.handle} src={m.user.avatarUrl} size={30} />
                  <span className="text-[13px] font-semibold">{m.user.displayName ?? m.user.handle}</span>
                </Link>
              ))}
            </div>
          );
        })}
      </aside>
    </div>
    </div>
  );
}
