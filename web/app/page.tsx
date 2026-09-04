'use client'

import Link from 'next/link'
import { useAccount } from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import { useCurrency } from '@/components/currency-context'
import { ConnectButton } from '@/components/connect-button'
import { FolioCard, type FolioSummary } from '@/components/folio-card'
import { WalletBalance } from '@/components/wallet-balance'
import { formatLocal, STOCKS } from '@/lib/assets'
import { IS_DEPLOYED } from '@/lib/deployment'

export default function Home() {
  const { address, isConnected } = useAccount()
  const { code, currency, usdToLocal } = useCurrency()

  const { data, isLoading: foliosLoading } = useQuery<{ folios: FolioSummary[] }>({
    queryKey: ['folios', address],
    queryFn: async () => (await fetch(`/api/folios?owner=${address}`)).json(),
    enabled: Boolean(address) && IS_DEPLOYED,
    refetchInterval: 30_000,
  })

  const folios = data?.folios ?? []

  return (
    <div className="pt-2">
      {!isConnected ? (
        <section className="pt-6">
          <h1 className="text-[30px] font-semibold leading-[1.12] tracking-[-0.025em]">
            Pay in {moneyWord(currency.code)}.
            <br />
            Describe the portfolio.
            <br />
            <span className="text-accent">Keep it, lock it, or send it.</span>
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-ink/60">
            A folio is a named basket of real US stocks, held onchain in your name. Build one in a
            sentence, fund it in the currency you already use, and hand it to someone if you want to.
          </p>

          <div className="mt-6">
            <ConnectButton full />
            <p className="mt-3 text-center text-xs text-ink/40">
              Use a passkey, or connect a wallet you already have.
            </p>
          </div>

          <MarketPreview />

          <div className="mt-8 space-y-3">
            <Step n={1} title="Say what you want" body="&ldquo;US tech that builds chips, no ads, for university.&rdquo;" />
            <Step n={2} title="See it in your money" body={`Every line priced in ${code}, with the fill you will actually get.`} />
            <Step n={3} title="Keep it or give it" body="Lock it until a date and send it as a claim link." />
          </div>
        </section>
      ) : (
        <section className="pt-1">
          <WalletBalance />

          <Link href="/create" className="btn-primary mt-4 w-full">
            Build a folio
          </Link>

          {!IS_DEPLOYED && (
            <p className="mt-3 rounded-xl bg-loss/[0.06] px-4 py-3 text-[13px] leading-relaxed text-loss">
              The vault contract is not deployed yet, so folios cannot be created. Run the deploy
              script, then restart the app.
            </p>
          )}

          <div className="mt-8">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-[15px] font-semibold tracking-tight">Your folios</h2>
              {folios.length > 0 && (
                <span className="figure text-[13px] text-ink/50">
                  {formatLocal(usdToLocal(folios.reduce((a, b) => a + b.totalUsd, 0)), code)}
                </span>
              )}
            </div>

            {foliosLoading ? (
              <div className="space-y-3">
                <div className="skeleton h-[104px] rounded-2xl" />
                <div className="skeleton h-[104px] rounded-2xl" />
              </div>
            ) : folios.length ? (
              <div className="space-y-3">
                {folios.map((f) => (
                  <FolioCard key={f.id} folio={f} />
                ))}
              </div>
            ) : (
              <div className="card p-6 text-center">
                <p className="text-[15px] font-medium">Nothing here yet</p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-ink/50">
                  Your first folio takes about thirty seconds. Describe it in your own words.
                </p>
              </div>
            )}
          </div>

          <MarketPreview />
        </section>
      )}
    </div>
  )
}

// The hero names the money the way a person would, not by ISO code.
const MONEY_WORD: Record<string, string> = {
  BRL: 'reais',
  NGN: 'naira',
  IDR: 'rupiah',
  EUR: 'euros',
  USD: 'dollars',
}
function moneyWord(code: string) {
  return MONEY_WORD[code] ?? code
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <div className="flex gap-3.5">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[11px] font-bold text-accent">
        {n}
      </span>
      <div>
        <p className="text-[14px] font-semibold">{title}</p>
        <p className="mt-0.5 text-[13px] leading-relaxed text-ink/55">{body}</p>
      </div>
    </div>
  )
}

function MarketPreview() {
  const { code, usdToLocal, prices, loading } = useCurrency()
  const featured = ['NVDAc', 'AAPLc', 'MSFTc', 'TSLAc']

  return (
    <div className="mt-8">
      <p className="label mb-2.5">Live on Base</p>
      <div className="grid grid-cols-2 gap-2.5">
        {featured.map((symbol) => {
          const s = STOCKS.find((x) => x.symbol === symbol)!
          const usd = prices[symbol]
          return (
            <div key={symbol} className="card px-3.5 py-3">
              <p className="text-[13px] font-semibold">{s.display}</p>
              {loading || !usd ? (
                <div className="skeleton mt-1.5 h-4 w-20 rounded" />
              ) : (
                <p className="figure mt-0.5 text-[15px] font-semibold">
                  {formatLocal(usdToLocal(usd), code, { compact: true })}
                </p>
              )}
              <p className="mt-0.5 text-[11px] text-ink/40">per share</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
