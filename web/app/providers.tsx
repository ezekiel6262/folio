'use client'

import { useState, type ReactNode } from 'react'
import { WagmiProvider, createConfig, http } from 'wagmi'
import { base } from 'wagmi/chains'
import { coinbaseWallet } from 'wagmi/connectors'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * Coinbase Smart Wallet only. No seed phrase, no extension, no app install: the user
 * signs in with a passkey and gets a contract account on Base that can batch calls
 * through EIP-5792. That batching is what makes "swap, swap, deposit, mint" feel like
 * one tap instead of five confirmations.
 */
export const wagmiConfig = createConfig({
  chains: [base],
  connectors: [
    coinbaseWallet({
      appName: 'Folio',
      preference: 'smartWalletOnly',
    }),
  ],
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
