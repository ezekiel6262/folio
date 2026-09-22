'use client'

import { useState, type ReactNode } from 'react'
import { PrivyProvider } from '@privy-io/react-auth'
import { createSolanaRpc, createSolanaRpcSubscriptions } from '@solana/kit'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * Sign-up is the wallet. Email, phone, Google or Apple, and Privy creates a Solana
 * wallet behind it — no seed phrase, no extension, no "connect wallet". Folio pays every
 * fee, so the wallet never needs SOL.
 *
 * The browser gets the public RPC only. Everything that reads the chain runs on the
 * server with the keyed RPC; the browser's only job is to sign its own slot.
 */
const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'
const WS = RPC.replace(/^http/, 'ws')

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 20_000, refetchOnWindowFocus: false, retry: 1 } } }),
  )
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID

  if (!appId) return <MissingConfig />

  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ['email', 'sms', 'google', 'apple'],
        appearance: { theme: 'light', accentColor: '#1a2fd6', walletChainType: 'solana-only' },
        embeddedWallets: { solana: { createOnLogin: 'all-users' }, ethereum: { createOnLogin: 'off' } },
        solana: {
          rpcs: {
            'solana:mainnet': { rpc: createSolanaRpc(RPC), rpcSubscriptions: createSolanaRpcSubscriptions(WS) },
          },
        },
      }}
    >
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </PrivyProvider>
  )
}

/** Stated plainly rather than failing somewhere deep inside the sign-in flow. */
function MissingConfig() {
  return (
    <div className="mx-auto flex min-h-screen max-w-[430px] flex-col justify-center bg-ground px-6">
      <p className="t-kicker">Setup</p>
      <h1 className="t-screen mt-4">
        Sign-in is not configured<span className="text-accent">.</span>
      </h1>
      <p className="t-body mt-5">
        Set <code className="figure">NEXT_PUBLIC_PRIVY_APP_ID</code> to the App ID from the Privy dashboard, then restart.
      </p>
    </div>
  )
}
