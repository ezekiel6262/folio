'use client'

import Link from 'next/link'
import { useAccount } from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import { useCurrency } from '@/components/currency-context'
import { ConnectButton } from '@/components/connect-button'
import { FolioRow, type FolioSummary } from '@/components/folio-card'
import { WalletBalance } from '@/components/wallet-balance'
import { AppHeader, HairRule, HardRule, Kicker, Screen, Stop, MonoLabel } from '@/components/ui'
import { formatLocal, STOCKS } from '@/lib/assets'
import { IS_DEPLOYED } from '@/lib/deployment'

const MONEY_WORD: Record<string, string> = {
  BRL: 'reais',
  NGN: 'naira',
  IDR: 'rupiah',
  EUR: 'euros',
  USD: 'dollars',
}

export default function Home() {
  const { isConnected } = useAccount()
  return (
    <>
      <AppHeader />
      {isConnected ? <SignedIn /> : <Door />}
    </>
  )
}

/* ----------------------------------------------------------------- 03 Door */

function Door() {
  const { code, usdToLocal, prices, loading, staleHours } = useCurrency()
  const word = MONEY_WORD[code] ?? code
  const featured = ['AAPLc', 'NVDAc', 'MSFTc', 'TSLAc']

  return (
    <Screen>
      <Kicker>US shares · your currency</Kicker>

      <h1 className="t-display mt-4">
        Own Apple.
        <br />
        Pay in <span className="t-serif text-[44px]">{word}</span>
        <Stop />
      </h1>

      <p className="t-body mt-5">
        Describe a portfolio in a sentence. Keep it, lock it until a date, or hand it to someone you
        love.
      </p>

      <div className="mt-7">
        <ConnectButton full />
      </div>
      <p className="t-disclaimer mt-3 text-center">
        A passkey takes seconds, or use a wallet you already have.
      </p>

      {/* Reference prices, with their age stated rather than implied. */}
      <div className="mt-9 border-y border-ink bg-ground-inset px-4 py-4">
        <div className="flex items-center justify-between">
          <MonoLabel>Reference prices</MonoLabel>
          {!loading && staleHours > 0 && (
            <span className="border border-accent px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-monolabel text-accent">
              {staleHours}h old
            </span>
          )}
        </div>

        <div className="mt-3">
          {featured.map((symbol) => {
            const s = STOCKS.find((x) => x.symbol === symbol)!
            const usd = prices[symbol]
            return (
              <div
                key={symbol}
                className="flex items-baseline justify-between border-t border-rule-mid py-2.5 first:border-t-0"
              >
                <span className="font-sans text-[13.5px] text-ink">{s.display}</span>
                {loading || !usd ? (
                  <span className="h-3 w-16 bg-rule-mid/50" />
                ) : (
                  <span className="figure text-[13px] text-ink">
                    {formatLocal(usdToLocal(usd), code, { compact: true })}
                  </span>
                )}
              </div>
            )
          })}
        </div>

        <p className="t-disclaimer mt-3">
          Chainlink reference feeds on Base. Equity feeds hold the last close while the US market is
          shut, so this can read hours old. What you pay is set by the live market at the moment you
          buy, shown before you commit.
        </p>
      </div>

      <p className="t-label mt-9">How it works</p>
      <div className="mt-3">
        {[
          'Say what you want, in one sentence.',
          `See exactly what it buys, and what it costs, in ${word}.`,
          'Keep it in your name, or send it as a gift.',
        ].map((text, i) => (
          <div key={i} className="flex gap-4 border-t border-rule-hair py-3.5 first:border-t-0">
            <span className="font-mono text-[10px] tracking-monolabel text-accent">
              {String(i + 1).padStart(2, '0')}
            </span>
            <span className="t-body-sm !text-body">{text}</span>
          </div>
        ))}
      </div>

      <HardRule className="mt-9" />
      <p className="t-disclaimer mt-4">
        Folio is an interface and a vault. It is not a broker or an issuer, it does not hold your
        assets off-chain, and it grants no voting or redemption rights beyond what the token itself
        carries. Tokenized shares are available only to eligible people outside the United States.
      </p>
    </Screen>
  )
}

/* ----------------------------------------------------------------- 05 Home */

function SignedIn() {
  const { address } = useAccount()
  const { code, usdToLocal } = useCurrency()

  const { data, isLoading } = useQuery<{ folios: FolioSummary[] }>({
    queryKey: ['folios', address],
    queryFn: async () => (await fetch(`/api/folios?owner=${address}`)).json(),
    enabled: Boolean(address) && IS_DEPLOYED,
    refetchInterval: 30_000,
  })

  const folios = data?.folios ?? []
  const total = folios.reduce((a, b) => a + b.totalUsd, 0)

  return (
    <Screen>
      <WalletBalance />

      <Link href="/create" className="btn-primary mt-6 no-underline">
        Build a folio
      </Link>

      {!IS_DEPLOYED && (
        <div className="mt-4 border border-accent p-3.5">
          <p className="t-body-sm">
            <span className="text-accent">● </span>
            The vault is not deployed on this environment, so folios cannot be created here.
          </p>
        </div>
      )}

      <div className="mt-10">
        <div className="flex items-baseline justify-between">
          <p className="t-label">Your folios</p>
          <span className="figure text-[11px] text-body-mute">
            {isLoading ? '··' : String(folios.length).padStart(2, '0')}
          </span>
        </div>
        <HardRule className="mt-2.5" />

        {isLoading ? (
          <div className="pt-6">
            <div className="h-4 w-40 bg-ground-inset" />
            <div className="mt-3 h-4 w-24 bg-ground-inset" />
          </div>
        ) : folios.length ? (
          <>
            <div>
              {folios.map((f) => (
                <FolioRow key={f.id} folio={f} />
              ))}
            </div>
            <div className="flex items-baseline justify-between border-t border-rule-hair pt-3">
              <MonoLabel>Total</MonoLabel>
              <span className="figure text-[13px] text-ink">{formatLocal(usdToLocal(total), code)}</span>
            </div>
          </>
        ) : (
          <EmptyState />
        )}
      </div>
    </Screen>
  )
}

/** The empty state carries a drawn passbook — no images ship with this design. */
function EmptyState() {
  return (
    <div className="pt-10">
      <svg width="104" height="130" viewBox="0 0 104 130" fill="none" aria-hidden="true">
        <rect x="0.5" y="0.5" width="103" height="129" stroke="#d8d8d8" />
        <rect x="0" y="0" width="6" height="130" fill="#1a2fd6" />
        {[36, 58, 80, 102].map((y) => (
          <line key={y} x1="22" y1={y} x2="84" y2={y} stroke="#b5b2b2" />
        ))}
      </svg>

      <h2 className="t-section mt-7">
        Nothing here yet
        <Stop />
      </h2>
      <p className="t-body mt-4">
        A folio is a named basket of real US shares, held in your name. You describe it in a
        sentence and it takes about thirty seconds to make.
      </p>
      <p className="t-body-sm mt-3">
        Whatever you build stays yours. You can lock it until a date, or hand the whole thing to
        someone else with a link.
      </p>
      <HairRule className="mt-8" />
    </div>
  )
}
