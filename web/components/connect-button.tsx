'use client'

import { useEffect, useMemo, useState } from 'react'
import { useAccount, useConnect, useConnectors, useDisconnect, type Connector } from 'wagmi'

export function shortAddress(address?: string) {
  if (!address) return ''
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

const SMART_WALLET_IDS = new Set(['coinbaseWalletSDK', 'baseAccount'])

/**
 * Only the Coinbase Smart Wallet can batch, so it is presented first and labelled for
 * what it actually gives you. Every other wallet still works - it just signs each step.
 */
function describe(connector: Connector) {
  if (SMART_WALLET_IDS.has(connector.id)) {
    return { title: 'Coinbase Smart Wallet', subtitle: 'Passkey · one tap · no seed phrase', best: true }
  }
  if (connector.id === 'walletConnect') {
    return { title: 'WalletConnect', subtitle: 'Scan with any mobile wallet', best: false }
  }
  if (connector.id === 'injected') {
    return { title: 'Browser wallet', subtitle: 'Whatever is installed here', best: false }
  }
  return { title: connector.name, subtitle: 'Signs each step separately', best: false }
}

function useOfferedConnectors() {
  const connectors = useConnectors()
  return useMemo(() => {
    const list = [...connectors]
    // wagmi discovers installed wallets over EIP-6963 and also keeps the generic
    // injected shim. Showing both would list the same wallet twice.
    const hasDiscovered = list.some((c) => c.id !== 'injected' && c.type === 'injected')
    const filtered = hasDiscovered ? list.filter((c) => c.id !== 'injected') : list

    return filtered.sort((a, b) => {
      const aBest = SMART_WALLET_IDS.has(a.id) ? 0 : 1
      const bBest = SMART_WALLET_IDS.has(b.id) ? 0 : 1
      return aBest - bBest
    })
  }, [connectors])
}

export function ConnectButton({ full = false }: { full?: boolean }) {
  const { address, isConnected, connector: active } = useAccount()
  const { disconnect } = useDisconnect()
  const [open, setOpen] = useState(false)

  if (isConnected) {
    return (
      <button
        onClick={() => disconnect()}
        className={`btn-ghost ${full ? 'w-full' : '!px-3 !py-2 text-xs'}`}
        title={`Signed in with ${active?.name ?? 'a wallet'} — click to sign out`}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-gain" />
        {shortAddress(address)}
      </button>
    )
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={full ? 'btn-primary w-full' : 'btn-primary !px-3.5 !py-2 text-xs'}
      >
        {full ? 'Sign in' : 'Sign in'}
      </button>
      {open && <WalletSheet onClose={() => setOpen(false)} />}
    </>
  )
}

function WalletSheet({ onClose }: { onClose: () => void }) {
  const offered = useOfferedConnectors()
  const { connect, isPending, error, variables } = useConnect()
  const { isConnected } = useAccount()

  useEffect(() => {
    if (isConnected) onClose()
  }, [isConnected, onClose])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 backdrop-blur-sm sm:items-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Choose a wallet"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[440px] rounded-t-2xl bg-paper-card p-5 shadow-2xl sm:rounded-2xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[17px] font-semibold tracking-tight">Sign in</h2>
          <button onClick={onClose} className="rounded-full p-1.5 text-ink/40 hover:bg-black/[0.05]" aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="space-y-2">
          {offered.map((connector) => {
            const { title, subtitle, best } = describe(connector)
            const busy = isPending && variables?.connector === connector
            return (
              <button
                key={connector.uid}
                onClick={() => connect({ connector })}
                disabled={isPending}
                className={`flex w-full items-center gap-3 rounded-xl border p-3.5 text-left transition disabled:opacity-50 ${
                  best ? 'border-accent/40 bg-accent-soft/40 hover:border-accent' : 'border-black/10 hover:bg-black/[0.02]'
                }`}
              >
                <WalletIcon connector={connector} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="text-[14.5px] font-semibold">{title}</span>
                    {best && <span className="pill bg-accent text-[10px] text-white">Fastest</span>}
                  </span>
                  <span className="mt-0.5 block truncate text-[12.5px] text-ink/50">{subtitle}</span>
                </span>
                {busy && (
                  <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-black/10 border-t-accent" />
                )}
              </button>
            )
          })}
        </div>

        {error && (
          <p className="mt-3 rounded-xl bg-loss/[0.06] px-3.5 py-2.5 text-[12.5px] leading-relaxed text-loss">
            {/rejected|denied/i.test(error.message) ? 'You closed the wallet before signing in.' : error.message}
          </p>
        )}

        <p className="mt-4 text-[12px] leading-relaxed text-ink/40">
          With a Coinbase Smart Wallet the whole purchase is one confirmation. Other wallets sign
          each step — same result, more taps.
        </p>
      </div>
    </div>
  )
}

function WalletIcon({ connector }: { connector: Connector }) {
  // Wallets discovered over EIP-6963 supply their own icon; the configured connectors
  // do not, so the two we always show get drawn rather than reduced to a letter.
  if (connector.icon) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={connector.icon} alt="" className="h-9 w-9 shrink-0 rounded-lg" />
  }

  if (SMART_WALLET_IDS.has(connector.id)) {
    return (
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="10" fill="white" />
          <rect x="8.5" y="8.5" width="7" height="7" rx="1.6" fill="#0052FF" />
        </svg>
      </span>
    )
  }

  if (connector.id === 'walletConnect') {
    return (
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#3B99FC]">
        <svg width="20" height="14" viewBox="0 0 24 15" fill="none" aria-hidden="true">
          <path
            d="M5 4.6a9.9 9.9 0 0 1 14 0l.5.5a.7.7 0 0 1 0 1l-1.6 1.6a.35.35 0 0 1-.5 0l-.7-.7a6.9 6.9 0 0 0-9.8 0l-.7.8a.35.35 0 0 1-.5 0L4.1 6.1a.7.7 0 0 1 0-1z"
            fill="white"
          />
        </svg>
      </span>
    )
  }

  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ink-soft text-[14px] font-bold text-white">
      {connector.name.slice(0, 1)}
    </span>
  )
}
