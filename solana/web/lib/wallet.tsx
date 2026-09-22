'use client'

import { useCallback, useMemo, useState } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import { useSignTransaction, useWallets } from '@privy-io/react-auth/solana'

/**
 * The one place the app touches the wallet. Screens see an account with an address that
 * can sign — never a wallet picker, a chain, or a "connect" step. Folio's own review
 * screen is the confirmation, so Privy's transaction modal (which speaks in lamports and
 * programs) is hidden.
 */
export function useFolioWallet() {
  const { ready, authenticated, login, logout, getAccessToken } = usePrivy()
  const { ready: walletsReady, wallets } = useWallets()
  const { signTransaction: privySign } = useSignTransaction()

  // The embedded wallet made at sign-up. Anything else linked later is ignored.
  const wallet = useMemo(
    () => wallets.find((w) => w.standardWallet.name.toLowerCase().includes('privy')) ?? wallets[0] ?? null,
    [wallets],
  )

  const signTransaction = useCallback(
    async (transaction: Uint8Array) => {
      if (!wallet) throw new Error('Your account is still being set up. Try again in a moment.')
      const { signedTransaction } = await privySign({
        transaction,
        wallet,
        chain: 'solana:mainnet',
        options: { uiOptions: { showWalletUIs: false } },
      })
      return signedTransaction
    },
    [wallet, privySign],
  )

  return {
    ready: ready && (!authenticated || walletsReady),
    authenticated,
    address: authenticated ? (wallet?.address ?? null) : null,
    login: () => login(),
    logout,
    signTransaction,
    getAccessToken,
  }
}

export function AccountButton() {
  const { address, logout } = useFolioWallet()
  const [open, setOpen] = useState(false)
  if (!address) return null
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="border border-rule-mid px-2 py-1 font-mono text-[10px] uppercase tracking-monolabel text-body-soft hover:border-ink"
      >
        Account
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-56 border-2 border-ink bg-ground p-3">
          <p className="t-mono-label">Your address</p>
          <p className="figure mt-1 break-all text-[10.5px] text-ink">{address}</p>
          <button onClick={() => logout()} className="btn-secondary mt-3 !min-h-[40px] !text-[11px]">
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
