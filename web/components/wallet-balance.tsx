'use client'

import { useAccount, useReadContract } from 'wagmi'
import { erc20Abi, formatUnits } from 'viem'
import { useCurrency } from './currency-context'
import { MonoLabel, SideNote } from './ui'
import { formatLocal, formatUsd, settlementCurrency } from '@/lib/assets'

/**
 * The headline number is the user's money in the user's currency — not a token balance
 * and not a transaction list. When the display currency has no on-chain market, this
 * says so rather than implying the app holds it.
 */
export function WalletBalance() {
  const { address } = useAccount()
  const { code, currency, fx } = useCurrency()
  const settle = settlementCurrency(code)

  const { data: raw, isLoading } = useReadContract({
    address: settle.address,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address), refetchInterval: 20_000 },
  })

  const held = raw !== undefined ? Number(formatUnits(raw as bigint, settle.decimals)) : 0
  const heldUsd = settle.code === 'USD' ? held : held / (fx[settle.code] ?? 1)
  const localValue = currency.tradeable ? held : heldUsd * (fx[code] ?? 0)

  return (
    <div>
      <MonoLabel>Ready to invest</MonoLabel>

      {isLoading ? (
        <div className="mt-2 h-11 w-48 bg-ground-inset" />
      ) : (
        <p className="t-figure-lg mt-2">{formatLocal(localValue, code)}</p>
      )}

      <p className="figure mt-2 text-[11px] text-body-mute">
        ≈ {formatUsd(heldUsd)} · held as {settle.token}
      </p>

      {!currency.tradeable && (
        <div className="mt-4">
          <SideNote>
            {currency.token} is live on Base but has no market yet, so Folio prices in {code} and
            settles in {settle.code}. Nothing here is naira you could trade.
          </SideNote>
        </div>
      )}
    </div>
  )
}
