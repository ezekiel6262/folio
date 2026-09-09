'use client'

import { useEffect, useMemo, useState } from 'react'
import { useAccount, useConnect, useConnectors, useDisconnect, type Connector } from 'wagmi'
import { useSponsorship } from '@/lib/use-executor'

export function shortAddress(address?: string) {
  if (!address) return ''
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

const SMART_WALLET_IDS = new Set(['coinbaseWalletSDK', 'baseAccount'])

function describe(connector: Connector, feeCovered: boolean) {
  if (SMART_WALLET_IDS.has(connector.id)) {
    return {
      title: 'Coinbase Smart Wallet',
      note: feeCovered ? 'Passkey · one signature · fee covered' : 'Passkey · one signature',
      best: true,
    }
  }
  if (connector.id === 'walletConnect') {
    return { title: 'WalletConnect', note: 'Scan with a mobile wallet · signs every step', best: false }
  }
  if (connector.id === 'injected') {
    return { title: 'Browser wallet', note: 'Whatever is installed here · signs every step', best: false }
  }
  return { title: connector.name, note: 'Signs every step separately', best: false }
}

function useOfferedConnectors() {
  const connectors = useConnectors()
  return useMemo(() => {
    const list = [...connectors]
    // wagmi discovers installed wallets over EIP-6963 and also keeps the generic
    // injected shim; showing both would list the same wallet twice.
    const hasDiscovered = list.some((c) => c.id !== 'injected' && c.type === 'injected')
    const filtered = hasDiscovered ? list.filter((c) => c.id !== 'injected') : list
    return filtered.sort(
      (a, b) => (SMART_WALLET_IDS.has(a.id) ? 0 : 1) - (SMART_WALLET_IDS.has(b.id) ? 0 : 1),
    )
  }, [connectors])
}

export function ConnectButton({ full = false, label = 'Sign in' }: { full?: boolean; label?: string }) {
  const { address, isConnected } = useAccount()
  const { disconnect } = useDisconnect()
  const [open, setOpen] = useState(false)

  if (isConnected) {
    return (
      <button
        onClick={() => disconnect()}
        className="border border-ink px-2.5 py-[5px] font-mono text-[10px] uppercase tracking-monolabel text-ink transition-colors hover:border-accent hover:text-accent"
        title="Sign out"
      >
        {shortAddress(address)}
      </button>
    )
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={
          full
            ? 'btn-primary'
            : 'border border-ink px-2.5 py-[5px] font-mono text-[10px] uppercase tracking-monolabel text-ink transition-colors hover:border-accent hover:text-accent'
        }
      >
        {label}
      </button>
      {open && <WalletSheet onClose={() => setOpen(false)} />}
    </>
  )
}

/* ------------------------------------------------------- 04 Wallet picker */

function WalletSheet({ onClose }: { onClose: () => void }) {
  const offered = useOfferedConnectors()
  const { connect, isPending, error, variables } = useConnect()
  const { isConnected } = useAccount()
  const sponsorship = useSponsorship()
  const feeCovered = sponsorship.appHasPaymaster

  useEffect(() => {
    if (isConnected) onClose()
  }, [isConnected, onClose])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const best = offered.filter((c) => SMART_WALLET_IDS.has(c.id))
  const rest = offered.filter((c) => !SMART_WALLET_IDS.has(c.id))

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: 'rgba(8,8,8,0.62)' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Choose a wallet"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="animate-sheet w-full max-w-[430px] border-t-2 border-ink bg-ground px-5 pb-8 pt-5"
      >
        <div className="flex items-start justify-between">
          <div>
            <p className="t-kicker">How you sign</p>
            <h2 className="t-section mt-2">Pick a wallet</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="-mr-2 -mt-1 flex h-11 w-11 items-center justify-center font-mono text-[15px] text-body-mute hover:text-ink"
          >
            ✕
          </button>
        </div>

        {best.map((connector) => {
          const d = describe(connector, feeCovered)
          const busy = isPending && variables?.connector === connector
          return (
            <button
              key={connector.uid}
              onClick={() => connect({ connector })}
              disabled={isPending}
              className="mt-5 flex w-full items-center gap-3 border border-accent bg-ground-inset p-4 text-left transition-opacity disabled:opacity-50"
            >
              <WalletTile connector={connector} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="t-cardtitle">{d.title}</span>
                  <span className="bg-accent px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-monolabel text-white">
                    Best
                  </span>
                </span>
                <span className="mt-1 block font-mono text-[10px] uppercase tracking-monolabel text-body-mute">
                  {d.note}
                </span>
              </span>
              <span className="font-mono text-[13px] text-accent">{busy ? '…' : '↗'}</span>
            </button>
          )
        })}

        {rest.length > 0 && (
          <>
            <p className="t-mono-label mt-7">Wallets on this device</p>
            <div className="mt-2 border-t border-rule-hair">
              {rest.map((connector) => {
                const d = describe(connector, feeCovered)
                const busy = isPending && variables?.connector === connector
                return (
                  <button
                    key={connector.uid}
                    onClick={() => connect({ connector })}
                    disabled={isPending}
                    className="row-hover flex w-full items-center gap-3 border-b border-rule-hair py-3.5 text-left disabled:opacity-50"
                  >
                    <WalletTile connector={connector} />
                    <span className="min-w-0 flex-1">
                      <span className="t-cardtitle block truncate">{d.title}</span>
                      <span className="mt-0.5 block truncate font-mono text-[10px] uppercase tracking-monolabel text-body-mute">
                        {d.note}
                      </span>
                    </span>
                    <span className="font-mono text-[13px] text-accent">{busy ? '…' : '↗'}</span>
                  </button>
                )
              })}
            </div>
          </>
        )}

        {error && (
          <p className="mt-4 border border-accent p-3 font-sans text-[12.5px] leading-[1.55] text-body">
            <span className="text-accent">● </span>
            {/rejected|denied/i.test(error.message)
              ? 'You closed the wallet before signing in. Nothing has been charged.'
              : error.message}
          </p>
        )}

        <p className="t-disclaimer mt-6">
          A smart wallet does the whole purchase in one signature
          {feeCovered ? ', and we cover the network fee on it' : ''}. Every other wallet signs each
          step separately — the same result, more taps
          {feeCovered ? ', and the fee is not covered' : ''}.
        </p>
      </div>
    </div>
  )
}

function WalletTile({ connector }: { connector: Connector }) {
  if (connector.icon) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={connector.icon} alt="" className="h-[26px] w-[26px] shrink-0 border border-rule-hair" />
  }
  return (
    <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center border border-ink font-mono text-[11px] text-ink">
      {connector.name.slice(0, 1).toUpperCase()}
    </span>
  )
}
