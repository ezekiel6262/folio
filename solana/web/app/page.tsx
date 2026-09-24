'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useCurrency } from '@/components/currency-context'
import { FolioRow } from '@/components/folio-row'
import { Reminders } from '@/components/reminders'
import { AppHeader, CurrencyChip, HairRule, HardRule, Kicker, MonoLabel, Screen, SideNote, Spinner, Stop } from '@/components/ui'
import { STOCK_BY_SYMBOL, STOCKS } from '@/lib/assets'
import { formatLocal } from '@/lib/currencies'
import { AccountButton, useFolioWallet } from '@/lib/wallet'
import type { WalletBalances } from '@/lib/balances'
import type { FolioView } from '@/lib/folio-reader'

export default function Home() {
  const wallet = useFolioWallet()
  return (
    <>
      <AppHeader
        right={
          <>
            <CurrencyChip />
            {wallet.authenticated && <AccountButton />}
          </>
        }
      />
      {!wallet.ready ? (
        <Screen>
          <div className="flex min-h-[50vh] items-center justify-center">
            <Spinner />
          </div>
        </Screen>
      ) : wallet.authenticated ? (
        <SignedIn />
      ) : (
        <Door />
      )}
    </>
  )
}

/* ----------------------------------------------------------------- Door */

function Door() {
  const { currency, code, usdToLocal, shareUsd, loading } = useCurrency()
  const { login } = useFolioWallet()
  const featured = ['AAPLx', 'NVDAx', 'SPYx', 'TSLAx']

  return (
    <Screen wide>
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-16">
      <div>
      <Kicker>US shares · any currency</Kicker>
      <h1 className="t-display mt-4">
        Own Apple.
        <br />
        Pay in <span className="t-serif text-[44px]">{currency.word}</span>
        <Stop />
      </h1>
      <p className="t-body mt-5">
        Sign up with your email. Add money. Describe a portfolio in a sentence, and own real US
        shares in your own name — kept, locked until a date, or given to someone you love.
      </p>

      <button onClick={login} className="btn-primary mt-7 lg:max-w-[360px]">
        Sign up or sign in
      </button>
      <p className="t-disclaimer mt-3 text-center lg:text-left">Email, phone, Google or Apple. No app, no seed phrase, no fees to pay.</p>
      </div>

      <div>
      <div className="mt-9 border-y border-ink bg-ground-inset px-4 py-4 lg:mt-0">
        <MonoLabel>Market prices, per share</MonoLabel>
        <div className="mt-3">
          {featured.map((symbol) => {
            const usd = shareUsd[symbol]
            return (
              <div key={symbol} className="flex items-baseline justify-between border-t border-rule-mid py-2.5 first:border-t-0">
                <span className="font-sans text-[13.5px] text-ink">{STOCK_BY_SYMBOL.get(symbol)?.display}</span>
                {loading || !usd ? (
                  <span className="h-3 w-16 bg-rule-mid/50" />
                ) : (
                  <span className="figure text-[13px] text-ink">{formatLocal(usdToLocal(usd), code)}</span>
                )}
              </div>
            )
          })}
        </div>
        <p className="t-disclaimer mt-3">
          Aggregated from Solana trading venues by Jupiter — a market price, not an independent
          reference. What you pay is quoted live before you commit.
        </p>
      </div>

      <p className="t-label mt-9">How it works</p>
      <div className="mt-3">
        {[
          'Sign up. Your account is created for you.',
          'Add money as stablecoins — USDC, USDT, EURC and others.',
          `Say what you want in one sentence, and see what it costs in ${currency.word}.`,
          'Keep it in your name, lock it, or send it as a gift.',
        ].map((text, i) => (
          <div key={i} className="flex gap-4 border-t border-rule-hair py-3.5 first:border-t-0">
            <span className="font-mono text-[10px] tracking-monolabel text-accent">{String(i + 1).padStart(2, '0')}</span>
            <span className="t-body-sm !text-body">{text}</span>
          </div>
        ))}
      </div>

      <HardRule className="mt-9" />
      <p className="t-disclaimer mt-4">
        Folio is an interface and a vault. It is not a broker or an issuer. The shares are xStocks
        issued by Backed, available only to eligible people outside the United States; the issuer
        can freeze, pause or move them, and Folio cannot override that.
      </p>
      </div>
      </div>
    </Screen>
  )
}

/* ------------------------------------------------------------- Signed in */

function SignedIn() {
  const { address } = useFolioWallet()
  const { code, usdToLocal } = useCurrency()

  const balances = useQuery<WalletBalances>({
    queryKey: ['balances', address],
    queryFn: async () => (await fetch(`/api/balances?owner=${address}`)).json(),
    enabled: Boolean(address),
    refetchInterval: 20_000,
  })
  const folios = useQuery<{ owned: FolioView[]; giftsWaiting: FolioView[] }>({
    queryKey: ['folios', address],
    queryFn: async () => (await fetch(`/api/folios?owner=${address}`)).json(),
    enabled: Boolean(address),
    refetchInterval: 30_000,
  })

  if (!address) {
    return (
      <Screen>
        <Kicker>One moment</Kicker>
        <h1 className="t-screen mt-4">
          Setting up your account<Stop />
        </h1>
        <div className="mt-8">
          <Spinner />
        </div>
      </Screen>
    )
  }

  const investable = balances.data?.investableUsd ?? 0
  const owned = folios.data?.owned ?? []
  const waiting = folios.data?.giftsWaiting ?? []
  const invested = owned.reduce((a, f) => a + f.totalUsd, 0)

  return (
    <Screen wide>
      <Reminders />
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-14">
      <div>
      <MonoLabel>Ready to invest</MonoLabel>
      {balances.isLoading ? (
        <div className="mt-2 h-11 w-48 bg-ground-inset" />
      ) : (
        <p className="t-figure-lg mt-2">{formatLocal(usdToLocal(investable), code)}</p>
      )}
      <p className="figure mt-2 text-[11px] text-body-mute">
        {(balances.data?.stablecoins ?? []).map((s) => `${s.units.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${s.symbol}`).join(' · ') ||
          'No stablecoins yet'}
      </p>

      <div className="mt-6 grid grid-cols-2 gap-2 lg:max-w-[440px]">
        <Link href="/deposit" className="btn-secondary no-underline">
          Add money
        </Link>
        <Link href="/create" className="btn-primary no-underline">
          Build a folio
        </Link>
      </div>

      {investable > 0 && (
        <Link href="/withdraw" className="btn-ghost mt-2 block text-center no-underline">
          Send money out
        </Link>
      )}

      {investable === 0 && !balances.isLoading && (
        <div className="mt-5">
          <SideNote>Add stablecoins first. They arrive in your account in seconds and are shown here in {code}.</SideNote>
        </div>
      )}

      <div className="mt-10">
        <div className="flex items-baseline justify-between">
          <p className="t-label">Your folios</p>
          <span className="figure text-[11px] text-body-mute">{folios.isLoading ? '··' : formatLocal(usdToLocal(invested), code)}</span>
        </div>
        <HardRule className="mt-2.5" />
        {folios.isLoading ? (
          <div className="pt-6">
            <div className="h-4 w-40 bg-ground-inset" />
          </div>
        ) : owned.length ? (
          owned.map((f) => <FolioRow key={f.address} folio={f} />)
        ) : (
          <EmptyState />
        )}
      </div>

      </div>

      <div>
      {waiting.length > 0 && (
        <div className="mt-10 lg:mt-0 lg:mb-10">
          <p className="t-label">Gifts you sent, not yet claimed</p>
          <HardRule className="mt-2.5" />
          {waiting.map((f) => (
            <FolioRow key={f.address} folio={f} />
          ))}
        </div>
      )}
      <div className="hidden lg:block">
        <MarketPanel />
      </div>
      </div>
      </div>
    </Screen>
  )
}

/** Desktop only: live prices beside the portfolio. */
function MarketPanel() {
  const { code, usdToLocal, shareUsd, loading } = useCurrency()
  return (
    <div className="border-y border-ink bg-ground-inset px-4 py-4">
      <div className="flex items-baseline justify-between">
        <MonoLabel>Market, per share</MonoLabel>
        <Link href="/markets" className="font-mono text-[10px] uppercase tracking-monolabel text-accent no-underline">
          All →
        </Link>
      </div>
      <div className="mt-3">
        {STOCKS.map((s) => (
          <div key={s.symbol} className="flex items-baseline justify-between border-t border-rule-mid py-2.5 first:border-t-0">
            <span className="font-sans text-[13px] text-ink">{s.display}</span>
            {loading || !shareUsd[s.symbol] ? (
              <span className="h-3 w-14 bg-rule-mid/50" />
            ) : (
              <span className="figure text-[12.5px] text-ink">{formatLocal(usdToLocal(shareUsd[s.symbol]), code)}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

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
        Nothing here yet<Stop />
      </h2>
      <p className="t-body mt-4">
        A folio is a named basket of real US shares, held in your name. You describe it in a
        sentence and it takes about thirty seconds to make.
      </p>
      <HairRule className="mt-8" />
    </div>
  )
}
