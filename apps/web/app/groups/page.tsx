'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { toast } from '@/components/toaster';
import { Avatar, Empty } from '@/components/ui';

interface GroupRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  color: string;
  iconUrl: string | null;
  _count: { members: number };
}

export default function GroupsPage() {
  const { me, login } = useSession();
  const router = useRouter();
  const discover = useQuery({ queryKey: ['groups'], queryFn: () => api<GroupRow[]>('/groups') });
  const mine = useQuery({ queryKey: ['groups', 'mine'], queryFn: () => api<GroupRow[]>('/groups/mine'), enabled: !!me });
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const create = useMutation({
    mutationFn: () =>
      api<GroupRow>('/groups', {
        body: { name, description, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || `group-${Date.now()}` },
      }),
    onSuccess: (g) => router.push(`/groups/${g.slug}`),
    onError: (e) => toast({ title: "Couldn't create group", body: (e as Error).message }),
  });

  return (
    <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-6 p-6">
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[30px] font-semibold tracking-tight">Groups</h1>
          <p className="text-sm text-muted">Trade with your people: channels, spot calls, voice and video rooms.</p>
        </div>
        <button className="btn-lime ml-auto" onClick={() => (me ? setCreating(true) : login())}>
          Create group
        </button>
      </div>

      {creating && (
        <form
          className="panel flex flex-wrap items-end gap-3 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <label className="flex min-w-[220px] flex-1 flex-col gap-1.5 text-xs text-muted">
            Name
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={40} />
          </label>
          <label className="flex min-w-[280px] flex-[2] flex-col gap-1.5 text-xs text-muted">
            Description
            <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={280} />
          </label>
          <button className="btn-lime h-11" disabled={create.isPending}>
            Create
          </button>
          <button type="button" className="btn-ghost h-11" onClick={() => setCreating(false)}>
            Cancel
          </button>
        </form>
      )}

      {!!mine.data?.length && <GroupGrid title="Your groups" groups={mine.data} />}
      <GroupGrid title="Discover" groups={discover.data ?? []} loading={discover.isLoading} />
    </div>
  );
}

function GroupGrid({ title, groups, loading }: { title: string; groups: GroupRow[]; loading?: boolean }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="label">{title}</h2>
      {!loading && groups.length === 0 && <Empty title="No groups yet">Create the first one.</Empty>}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
        {groups.map((g) => (
          <Link key={g.id} href={`/groups/${g.slug}`} className="card flex items-center gap-3.5 p-4 hover:bg-hover">
            {g.iconUrl ? (
              <Avatar name={g.name} src={g.iconUrl} size={48} />
            ) : (
              <span className="flex h-12 w-12 items-center justify-center rounded-[14px] text-sm font-semibold text-bar" style={{ background: g.color }}>
                {g.name.slice(0, 2).toUpperCase()}
              </span>
            )}
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="font-semibold">{g.name}</span>
              <span className="truncate text-xs text-muted">{g.description ?? 'No description'}</span>
              <span className="text-[11px] text-faint">{g._count.members} members</span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
