'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useCurrency } from '@/components/currency-context'
import { FolioCard, FolioRow } from '@/components/folio-row'
import { Reminders } from '@/components/reminders'
import { AppHeader, CurrencyChip, HairRule, HardRule, Kicker, MonoLabel, Screen, SideNote, Spinner, Stop } from '@/components/ui'
import { STOCK_BY_SYMBOL, STOCKS } from '@/lib/assets'
import { formatLocal, formatMove, formatUsd } from '@/lib/currencies'
import { AccountButton, useFolioWallet } from '@/lib/wallet'
import type { WalletBalances } from '@/lib/balances'
import type { FolioView } from '@/lib/folio-reader'

type EarnSummary = { earningUsd?: number }

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
  // Cash that is out earning is still the owner's money, so the total has to include it.
  const earning = useQuery<EarnSummary>({
    queryKey: ['earn-summary', address],
    queryFn: async () => (await fetch(`/api/earn?owner=${address}`)).json(),
    enabled: Boolean(address),
    refetchInterval: 60_000,
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
  // Today's move across everything owned, weighted by size. It says what the companies did,
  // never what the owner has made — Folio does not know what anyone paid.
  const movedToday = owned.filter((f) => f.change24hPct != null && f.totalUsd > 0)
  const movedUsd = movedToday.reduce((a, f) => a + f.totalUsd, 0)
  const todayPct = movedUsd > 0 ? movedToday.reduce((a, f) => a + (f.change24hPct as number) * (f.totalUsd / movedUsd), 0) : null
  const earningUsd = earning.data?.earningUsd ?? 0
  const everything = invested + investable + earningUsd
  const share = (usd: number) => (everything > 0 ? (usd / everything) * 100 : 0)

  return (
    <Screen wide>
      <Reminders />
      {waiting.map((f) => (
        <WaitingGift key={f.address} folio={f} />
      ))}
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-14">
      <div>
      <MonoLabel>Everything you have in Folio</MonoLabel>
      {balances.isLoading ? (
        <div className="mt-2 h-11 w-48 bg-ground-inset" />
      ) : (
        <p className="t-figure-lg mt-2">{formatLocal(usdToLocal(everything), code)}</p>
      )}
      <p className="figure mt-2 text-[11px] text-body-mute">
        {formatUsd(everything)}
        {code !== 'USD' && ` · ${code} is what you are shown, never what is held`}
      </p>

      {/* Where the money is: owned shares, cash waiting, cash out earning. */}
      <div className="mt-5 flex h-2.5 w-full lg:max-w-[440px]">
        <div style={{ width: `${share(invested)}%` }} className="bg-ink" />
        <div style={{ width: `${share(investable)}%` }} className="bg-accent" />
        <div style={{ width: `${share(earningUsd)}%` }} className="bg-[#8f9dff]" />
        {everything === 0 && <div className="w-full bg-rule-mid" />}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3 lg:max-w-[440px]">
        {(
          [
            ['Invested', invested, 'bg-ink', '/markets'],
            ['Ready', investable, 'bg-accent', '/create'],
            ['Earning', earningUsd, 'bg-[#8f9dff]', '/earn'],
          ] as [string, number, string, string][]
        ).map(([label, usd, swatch, href]) => (
          <Link key={label} href={href} className="no-underline">
            <span className="flex items-center gap-1.5">
              <span className={`h-2 w-2 ${swatch}`} />
              <span className="t-mono-label">{label}</span>
            </span>
            <span className="figure mt-1 block text-[13px] text-ink">{formatLocal(usdToLocal(usd), code)}</span>
          </Link>
        ))}
      </div>

      <p className="figure mt-3 text-[11px] text-body-mute">
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
          <span className="figure text-[11px] text-body-mute">
            {folios.isLoading ? '··' : formatLocal(usdToLocal(invested), code)}
            {todayPct != null && (
              <span className={todayPct >= 0 ? 'text-accent' : 'text-ink'}> · {formatMove(todayPct)} today</span>
            )}
          </span>
        </div>
        <HardRule className="mt-2.5" />
        {folios.isLoading ? (
          <div className="pt-6">
            <div className="h-4 w-40 bg-ground-inset" />
          </div>
        ) : owned.length ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {owned.map((f) => (
              <FolioCard key={f.address} folio={f} />
            ))}
            <Link
              href="/create"
              className="flex min-h-[132px] items-center justify-center border border-dashed border-rule-mid text-body-soft no-underline transition-colors hover:border-accent hover:text-accent"
            >
              <span className="font-sans text-[13px] font-medium">+ New folio</span>
            </Link>
          </div>
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

/**
 * A gift nobody has opened. It is the one thing in Folio that needs chasing, because the
 * link is the only key and only the sender still has it.
 */
function WaitingGift({ folio }: { folio: FolioView }) {
  const days = Math.max(0, Math.floor((Date.now() / 1000 - folio.createdAt) / 86_400))
  return (
    <div className="-mx-5 mb-6 bg-ink-void px-5 py-4 lg:mx-0">
      <p className="font-sans text-[13px] leading-[1.55] text-body-dark">
        <span className="font-serif text-[15px] italic text-accent-dark">Waiting.</span> Nobody has opened{' '}
        <span className="text-ground">{folio.name || 'your gift'}</span> yet — you sent it{' '}
        {days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`}. The link you saved is the only way in.
      </p>
      <Link href={`/claim/${folio.address}`} className="mt-2 inline-block font-mono text-[10px] uppercase tracking-monolabel text-accent-dark no-underline">
        See what they see →
      </Link>
    </div>
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
