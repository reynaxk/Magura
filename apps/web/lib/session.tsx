'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PrivyProvider, usePrivy, useWallets } from '@privy-io/react-auth';
import { useSolanaWallets } from '@privy-io/react-auth/solana';
import { Connection, VersionedTransaction } from '@solana/web3.js';
import { CHAINS, type ChainId, type SwapTx } from '@magura/shared';
import { api, configureAuth } from './api';

export interface Me {
  id: string;
  handle: string;
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  badges: string[];
  experience: string | null;
  interests: string[];
  wallets: { id: string; chainKind: 'svm' | 'evm'; address: string; label: string | null; isPrimary: boolean; delegated: boolean }[];
  settings: Record<string, any>;
  followers: number;
  following: number;
  copiers: number;
}

interface Session {
  mode: 'privy' | 'dev';
  ready: boolean;
  authenticated: boolean;
  me: Me | null;
  login: () => void;
  logout: () => Promise<void>;
  /** Address used for a chain ("svm" wallets for Solana, "evm" for the rest). */
  addressFor: (chain: ChainId) => string | null;
  /** Sign + send a swap tx built by the API. Returns the tx hash/signature. */
  sendSwap: (tx: SwapTx) => Promise<string>;
  refresh: () => void;
}

const SessionCtx = createContext<Session | null>(null);

export function useSession(): Session {
  const s = useContext(SessionCtx);
  if (!s) throw new Error('useSession outside provider');
  return s;
}

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
const SOLANA_RPC = process.env.NEXT_PUBLIC_SOLANA_RPC ?? 'https://api.mainnet-beta.solana.com';

function useMe(enabled: boolean) {
  return useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/me'), enabled, staleTime: 30_000, retry: false });
}

/* ───────────────────────── Privy (production) ───────────────────────── */

function PrivyBridge({ children }: { children: ReactNode }) {
  const { ready, authenticated, login, logout, getAccessToken } = usePrivy();
  const { wallets: evmWallets } = useWallets();
  const { wallets: solWallets } = useSolanaWallets();
  const qc = useQueryClient();
  const [tokenReady, setTokenReady] = useState(false);

  useEffect(() => {
    configureAuth({ getToken: () => getAccessToken() });
    setTokenReady(true);
  }, [getAccessToken]);

  const me = useMe(ready && authenticated && tokenReady);

  const addressFor = useCallback(
    (chain: ChainId) => (CHAINS[chain].kind === 'svm' ? solWallets[0]?.address : evmWallets.find((w) => w.walletClientType !== 'solana')?.address) ?? null,
    [solWallets, evmWallets],
  );

  const sendSwap = useCallback(
    async (tx: SwapTx) => {
      if (tx.solanaTxBase64) {
        const w = solWallets[0];
        if (!w) throw new Error('Connect a Solana wallet first');
        const conn = new Connection(SOLANA_RPC, 'confirmed');
        const vtx = VersionedTransaction.deserialize(Buffer.from(tx.solanaTxBase64, 'base64'));
        return w.sendTransaction(vtx, conn);
      }
      const w = evmWallets[0];
      if (!w || !tx.evmTx) throw new Error('Connect an EVM wallet first');
      await w.switchChain(CHAINS[tx.chain].evmChainId!);
      const provider = await w.getEthereumProvider();
      if (tx.approval) {
        const data =
          '0x095ea7b3' + tx.approval.spender.slice(2).padStart(64, '0') + BigInt(tx.approval.amount).toString(16).padStart(64, '0');
        await provider.request({ method: 'eth_sendTransaction', params: [{ from: w.address, to: tx.approval.token, data }] });
      }
      return provider.request({
        method: 'eth_sendTransaction',
        params: [{ from: w.address, to: tx.evmTx.to, data: tx.evmTx.data, value: '0x' + BigInt(tx.evmTx.value).toString(16) }],
      }) as Promise<string>;
    },
    [solWallets, evmWallets],
  );

  // keep API wallet list in sync with Privy-linked wallets
  useEffect(() => {
    if (!me.data) return;
    const known = new Set(me.data.wallets.map((w) => w.address.toLowerCase()));
    const all = [
      ...solWallets.map((w) => ({ chainKind: 'svm' as const, address: w.address, label: w.walletClientType })),
      ...evmWallets.filter((w) => w.address.startsWith('0x')).map((w) => ({ chainKind: 'evm' as const, address: w.address, label: w.walletClientType })),
    ];
    const missing = all.filter((w) => !known.has(w.address.toLowerCase()));
    if (missing.length) Promise.all(missing.map((w) => api('/me/wallets', { body: w }))).then(() => qc.invalidateQueries({ queryKey: ['me'] }));
  }, [me.data, solWallets, evmWallets, qc]);

  const value: Session = {
    mode: 'privy',
    ready: ready && (!authenticated || !me.isLoading),
    authenticated: authenticated && !!me.data,
    me: me.data ?? null,
    login,
    logout: async () => {
      await logout();
      qc.clear();
    },
    addressFor,
    sendSwap,
    refresh: () => qc.invalidateQueries({ queryKey: ['me'] }),
  };
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

/* ───────────────────────── Dev login (local only) ───────────────────────── */

function DevSession({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [handle, setHandle] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let h: string | null = null;
    try {
      h = localStorage.getItem('magura:devUser');
    } catch {}
    configureAuth({ devUser: h });
    setHandle(h);
    setLoaded(true);
  }, []);

  const me = useMe(loaded && !!handle);

  const value = useMemo<Session>(
    () => ({
      mode: 'dev',
      ready: loaded && (!handle || !me.isLoading),
      authenticated: !!me.data,
      me: me.data ?? null,
      login: () => {
        const h = window.prompt('Dev login — pick a handle (local only)', 'emir');
        if (!h) return;
        try {
          localStorage.setItem('magura:devUser', h);
        } catch {}
        configureAuth({ devUser: h });
        setHandle(h);
        qc.invalidateQueries();
      },
      logout: async () => {
        try {
          localStorage.removeItem('magura:devUser');
        } catch {}
        configureAuth({ devUser: null });
        setHandle(null);
        qc.clear();
      },
      addressFor: (chain) => me.data?.wallets.find((w) => w.chainKind === CHAINS[chain].kind)?.address ?? null,
      sendSwap: async () => {
        throw new Error('Trading needs a real wallet — set NEXT_PUBLIC_PRIVY_APP_ID');
      },
      refresh: () => qc.invalidateQueries({ queryKey: ['me'] }),
    }),
    [loaded, handle, me.data, me.isLoading, qc],
  );
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  if (!PRIVY_APP_ID) return <DevSession>{children}</DevSession>;
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        appearance: { theme: 'dark', accentColor: '#C8F05A', walletChainType: 'ethereum-and-solana', landingHeader: 'Enter Magura' },
        loginMethods: ['wallet', 'email', 'google', 'twitter'],
        embeddedWallets: { ethereum: { createOnLogin: 'users-without-wallets' }, solana: { createOnLogin: 'users-without-wallets' } },
      }}
    >
      <PrivyBridge>{children}</PrivyBridge>
    </PrivyProvider>
  );
}
