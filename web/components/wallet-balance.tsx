'use client'

import { useAccount, useReadContract } from 'wagmi'
import { erc20Abi, formatUnits } from 'viem'
import { useCurrency } from './currency-context'
import { formatLocal, settlementCurrency } from '@/lib/assets'

/**
 * The home number is the user's money in the user's currency. Not a token balance,
 * not a transaction list. When the display currency has no onchain market, the app
 * says so here rather than implying it holds naira.
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

  // A tradeable local stablecoin is already denominated in the user's currency.
  // Otherwise convert the settlement balance through FX for display.
  const localValue = currency.tradeable ? held : held * (fx[code] ?? 0) * (1 / (fx[settle.code] ?? 1))

  return (
    <div className="card p-5">
      <p className="label">Available to invest</p>
      {isLoading ? (
        <div className="skeleton mt-2 h-9 w-40 rounded" />
      ) : (
        <p className="figure mt-1 text-[34px] font-semibold leading-none">
          {formatLocal(localValue, code)}
        </p>
      )}

      <div className="mt-3 flex items-center gap-2 text-[12px] text-ink/45">
        <span className="pill bg-black/[0.04]">
          {held.toLocaleString(undefined, { maximumFractionDigits: 2 })} {settle.token}
        </span>
        {!currency.tradeable && (
          <span className="pill bg-accent-soft text-accent">settles in {settle.code}</span>
        )}
      </div>

      {!currency.tradeable && (
        <p className="mt-3 text-[12px] leading-relaxed text-ink/45">
          {currency.token} is live on Base but has no market yet, so Folio prices in {code} and
          settles in {settle.code}. Nothing here pretends to be naira you can trade.
        </p>
      )}
    </div>
  )
}
