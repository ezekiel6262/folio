'use client'

import { useState } from 'react'
import { useCurrency } from '@/components/currency-context'
import { AppHeader, HardRule, Kicker, MonoLabel, Screen, SideNote, Stop } from '@/components/ui'
import { STOCKS, STOCK_BY_SYMBOL } from '@/lib/assets'
import { formatLocal, formatUsd } from '@/lib/currencies'
import { usePlans } from '@/lib/plans'

const EVERY: [string, number][] = [
  ['Every week', 7],
  ['Every month', 30],
  ['Every 3 months', 91],
]

/**
 * Standing plans and price watches. Both live on this device: Folio checks them when you
 * open it, which is worth saying twice rather than implying a notification that never comes.
 */
export default function PlansPage() {
  const { code, currency, usdToLocal, localToUsd, shareUsd } = useCurrency()
  const { entries, addWatch, addPlan, remove } = usePlans()

  const [symbol, setSymbol] = useState(STOCKS[0].symbol)
  const [direction, setDirection] = useState<'above' | 'below'>('below')
  const [price, setPrice] = useState('')

  const [prompt, setPrompt] = useState('Apple, Nvidia and the S&P 500')
  const [amount, setAmount] = useState('')
  const [everyDays, setEveryDays] = useState(30)

  const watches = entries.filter((e) => e.kind === 'watch')
  const plans = entries.filter((e) => e.kind === 'plan')
  const priceNum = Number(price)
  const amountNum = Number(amount)

  return (
    <>
      <AppHeader />
      <Screen wide>
        <Kicker>Plans and watches</Kicker>
        <h1 className="t-screen mt-4">
          Keep an eye on it <span className="t-serif text-[34px]">for me</span>
          <Stop />
        </h1>
        <p className="t-body mt-5 max-w-[620px]">
          Ask to be told when a price moves, or set an amount to invest on a rhythm. Folio shows both the
          moment you open it.
        </p>

        <div className="mt-10 lg:grid lg:grid-cols-2 lg:gap-14">
          <section>
            <p className="t-label">Tell me when a price moves</p>
            <HardRule className="mt-2.5" />
            <div className="mt-4 border-2 border-ink p-4">
              <MonoLabel>Company</MonoLabel>
              <select value={symbol} onChange={(e) => setSymbol(e.target.value)} className="field mt-2 !text-[14px]">
                {STOCKS.map((s) => (
                  <option key={s.symbol} value={s.symbol}>
                    {s.display}
                  </option>
                ))}
              </select>

              <div className="mt-4 flex gap-1.5">
                {(['below', 'above'] as const).map((d) => (
                  <button
                    key={d}
                    onClick={() => setDirection(d)}
                    className={`border px-2.5 py-1 font-mono text-[9.5px] uppercase tracking-monolabel transition-colors ${
                      direction === d ? 'border-ink bg-ink text-ground' : 'border-rule-mid text-body-soft'
                    }`}
                  >
                    Goes {d}
                  </button>
                ))}
              </div>

              <div className="mt-4 flex items-baseline justify-between">
                <MonoLabel>Price in {code}</MonoLabel>
                {shareUsd[symbol] && (
                  <button
                    onClick={() => setPrice(String(Math.round(usdToLocal(shareUsd[symbol]))))}
                    className="font-mono text-[10px] uppercase tracking-monolabel text-accent"
                  >
                    now {formatLocal(usdToLocal(shareUsd[symbol]), code)}
                  </button>
                )}
              </div>
              <input
                type="number"
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder={`${currency.symbol}0`}
                className="field figure mt-2 text-[16px]"
              />

              <button
                onClick={() => {
                  addWatch({ symbol, direction, priceUsd: localToUsd(priceNum) })
                  setPrice('')
                }}
                disabled={!(priceNum > 0)}
                className="btn-primary mt-4 !min-h-[44px]"
              >
                Watch it
              </button>
            </div>

            <div className="mt-6">
              {watches.map((w) =>
                w.kind === 'watch' ? (
                  <div key={w.id} className="flex items-baseline justify-between gap-4 border-b border-rule-hair py-3">
                    <span>
                      <span className="t-cardtitle block">{STOCK_BY_SYMBOL.get(w.symbol)?.display ?? w.symbol}</span>
                      <span className="figure mt-0.5 block text-[10.5px] text-body-mute">
                        when it goes {w.direction} {formatLocal(usdToLocal(w.priceUsd), code)} · {formatUsd(w.priceUsd)}
                        {w.firedAt && ' · already told you'}
                      </span>
                    </span>
                    <button onClick={() => remove(w.id)} className="font-mono text-[10px] uppercase tracking-monolabel text-accent">
                      Remove
                    </button>
                  </div>
                ) : null,
              )}
              {!watches.length && <p className="t-body-sm">No watches yet.</p>}
            </div>
          </section>

          <section className="mt-12 lg:mt-0">
            <p className="t-label">Invest on a rhythm</p>
            <HardRule className="mt-2.5" />
            <div className="mt-4 border-2 border-ink p-4">
              <MonoLabel>What to buy</MonoLabel>
              <input value={prompt} onChange={(e) => setPrompt(e.target.value.slice(0, 120))} className="field mt-2 !text-[14px]" />

              <MonoLabel className="mt-4">How much, in {code}</MonoLabel>
              <input
                type="number"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={`${currency.symbol}0`}
                className="field figure mt-2 text-[16px]"
              />

              <MonoLabel className="mt-4">How often</MonoLabel>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {EVERY.map(([label, days]) => (
                  <button
                    key={days}
                    onClick={() => setEveryDays(days)}
                    className={`border px-2.5 py-1 font-mono text-[9.5px] uppercase tracking-monolabel transition-colors ${
                      everyDays === days ? 'border-ink bg-ink text-ground' : 'border-rule-mid text-body-soft'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <button
                onClick={() => {
                  addPlan({ prompt: prompt.trim(), amountLocal: amountNum, currency: code, everyDays })
                  setAmount('')
                }}
                disabled={!(amountNum > 0) || !prompt.trim()}
                className="btn-primary mt-4 !min-h-[44px]"
              >
                Set the plan
              </button>
              <p className="t-disclaimer mt-2">
                Folio will ask you to confirm each one. Nothing is bought without you.
              </p>
            </div>

            <div className="mt-6">
              {plans.map((p) =>
                p.kind === 'plan' ? (
                  <div key={p.id} className="flex items-baseline justify-between gap-4 border-b border-rule-hair py-3">
                    <span className="min-w-0">
                      <span className="t-cardtitle block truncate">{p.prompt}</span>
                      <span className="figure mt-0.5 block text-[10.5px] text-body-mute">
                        {formatLocal(p.amountLocal, p.currency)} · {p.everyDays === 7 ? 'weekly' : p.everyDays === 30 ? 'monthly' : 'quarterly'} ·
                        next {new Date(p.dueAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                      </span>
                    </span>
                    <button onClick={() => remove(p.id)} className="font-mono text-[10px] uppercase tracking-monolabel text-accent">
                      Remove
                    </button>
                  </div>
                ) : null,
              )}
              {!plans.length && <p className="t-body-sm">No plans yet.</p>}
            </div>
          </section>
        </div>

        <div className="mt-10 max-w-[680px]">
          <SideNote>
            These live on this device, in this browser. Folio has no way to message you while it is closed
            and never moves money on its own: every purchase is one you confirm. Clearing your browser data
            clears them.
          </SideNote>
        </div>
      </Screen>
    </>
  )
}
