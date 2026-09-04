'use client'

import { useState, type ReactNode } from 'react'
import { WagmiProvider, createConfig, http } from 'wagmi'
import { base } from 'wagmi/chains'
import { coinbaseWallet, injected, walletConnect } from 'wagmi/connectors'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * Folio takes anyone who can hold a token on Base.
 *
 *   Coinbase Smart Wallet - a passkey, no app, no seed phrase. It is also the only
 *     option that can batch calls through EIP-5792, so it gets the one-tap purchase.
 *   Injected - MetaMask, Rabby, Phantom and anything else announcing itself over
 *     EIP-6963. wagmi discovers these automatically; this is the generic fallback.
 *   WalletConnect - mobile wallets, which injected cannot reach outside a wallet's own
 *     browser. Needs a free project id from reown.com, so it appears only when one is
 *     configured rather than rendering a button that cannot work.
 *
 * Wallets that cannot batch still work: lib/use-executor.ts sends the same calls one at
 * a time and tells the user that is what is happening.
 */
const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID

export const wagmiConfig = createConfig({
  chains: [base],
  connectors: [
    coinbaseWallet({ appName: 'Folio', preference: 'smartWalletOnly' }),
    injected({ shimDisconnect: true }),
    ...(walletConnectProjectId
      ? [walletConnect({ projectId: walletConnectProjectId, showQrModal: true })]
      : []),
  ],
  // Discovers EIP-6963 wallets in the browser and offers them alongside the above.
  multiInjectedProviderDiscovery: true,
  transports: {
    [base.id]: http(process.env.NEXT_PUBLIC_BASE_RPC_URL || 'https://mainnet.base.org'),
  },
  ssr: true,
})

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig
  }
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 20_000, refetchOnWindowFocus: false, retry: 1 } },
      }),
  )

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  )
}
