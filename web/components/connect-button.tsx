'use client'

import { useAccount, useConnect, useDisconnect } from 'wagmi'

export function shortAddress(address?: string) {
  if (!address) return ''
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

export function ConnectButton({ full = false }: { full?: boolean }) {
  const { address, isConnected } = useAccount()
  const { connect, connectors, isPending } = useConnect()
  const { disconnect } = useDisconnect()
  const connector = connectors[0]

  if (isConnected) {
    return (
      <button
        onClick={() => disconnect()}
        className={`btn-ghost ${full ? 'w-full' : '!px-3 !py-2 text-xs'}`}
        title="Sign out"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-gain" />
        {shortAddress(address)}
      </button>
    )
  }

  return (
    <button
      onClick={() => connector && connect({ connector })}
      disabled={isPending || !connector}
      className={full ? 'btn-primary w-full' : 'btn-primary !px-3.5 !py-2 text-xs'}
    >
      {isPending ? 'Opening…' : full ? 'Sign in with a passkey' : 'Sign in'}
    </button>
  )
}
