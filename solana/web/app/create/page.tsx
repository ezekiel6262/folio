'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Keypair } from '@solana/web3.js'
import { useCurrency } from '@/components/currency-context'
import { AllocationPreview } from '@/components/allocation-preview'
import { GiftOptions, isSolanaAddress, type GiftSettings } from '@/components/gift-options'
import { FlowHeader, HardRule, Kicker, MonoLabel, Screen, Spinner, Stop } from '@/components/ui'
import { formatShares } from '@/lib/assets'
import { formatLocal } from '@/lib/currencies'
import { isUserRejection, signAndSubmit, SubmitError, toBase64Url, type Progress } from '@/lib/execute'
import { useFolioWallet } from '@/lib/wallet'
import type { Allocation } from '@/lib/allocator'
import type { WalletBalances } from '@/lib/balances'
import type { PurchasePlan } from '@/lib/quote'

const EXAMPLES = ['Apple, Nvidia and the S&P 500', 'US tech that builds chips, no ads', 'Safe large companies, nothing volatile', 'Just the S&P 500']
const MIN_ORDER_USD = 1

type Stage = 'compose' | 'preview' | 'commit' | 'buying'

export default function CreatePage() {
  const router = useRouter()
  const wallet = useFolioWallet()
  const { code, currency, fx, usdToLocal, localToUsd, stablecoinUsd } = useCurrency()

  const [stage, setStage] = useState<Stage>('compose')
  const [prompt, setPrompt] = useState('')
  const [amount, setAmount] = useState('')
  const [payWith, setPayWith] = useState<string | null>(null)
  const [allocation, setAllocation] = useState<Allocation | null>(null)
  const [plan, setPlan] = useState<PurchasePlan | null>(null)
  const [name, setName] = useState('')
  const [gift, setGift] = useState<GiftSettings>({ mode: 'keep', recipient: '', unlockAt: 0, reclaimAfter: 0 })
  const [busy, setBusy] = useState<'reading' | 'pricing' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  // Set when adding to a folio the user already owns: no naming or gift step.
  const [topUp, setTopUp] = useState<string | null>(null)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    setTopUp(q.get('folio'))
    // Arriving from Markets or a shared link: start with that company already written in.
    const preset = q.get('prompt')
    if (preset) setPrompt(preset.slice(0, 200))
  }, [])

  const balances = useQuery<WalletBalances>({
    queryKey: ['balances', wallet.address],
    queryFn: async () => (await fetch(`/api/balances?owner=${wallet.address}`)).json(),
    enabled: Boolean(wallet.address),
    refetchInterval: 20_000,
  })

  // Pay with whatever the user holds most of, unless they choose otherwise.
  const held = balances.data?.stablecoins ?? []
  const pay = payWith ?? held[0]?.symbol ?? null
  const payBalance = held.find((s) => s.symbol === pay)

  const amountNum = Number(amount)
  const amountValid = Number.isFinite(amountNum) && amountNum > 0
  const amountUsd = amountValid ? localToUsd(amountNum) : 0
  const minLocal = usdToLocal(MIN_ORDER_USD)
  const belowMin = amountValid && amountUsd < MIN_ORDER_USD
  const aboveBalance = amountValid && payBalance != null && amountUsd > payBalance.usd
  const composeBlocked = !prompt.trim() || !amountValid || belowMin || aboveBalance || !pay || !fx[code]

  const presets = useMemo(() => [10, 25, 100, 250].map((usd) => roundNice(usdToLocal(usd))), [usdToLocal])

  async function readAndPrice() {
    setError(null)
    setBusy('reading')
    try {
      const a = await post<Allocation>('/api/allocate', { prompt })
      if (!a.lines.length) throw new Error(a.interpretation)
      setBusy('pricing')
      const p = await post<{ plan: PurchasePlan }>('/api/plan', {
        displayCode: code,
        amountLocal: amountNum,
        payWith: pay,
        weights: a.lines.map((l) => ({ symbol: l.symbol, weightBps: l.weightBps })),
      })
      setAllocation(a)
      setPlan(p.plan)
      if (!name) setName(suggestName(a))
      setStage('preview')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function buy() {
    if (!allocation || !plan || !wallet.address) return
    setError(null)

    // A claim link's key is made here, in the browser. Only its public half is sent.
    const link = !topUp && gift.mode === 'send' && !gift.recipient ? Keypair.generate() : null

    setStage('buying')
    try {
      const { built } = await post<{ built: { transactions: string[]; folio: string } }>('/api/build/buy', {
        user: wallet.address,
        displayCode: code,
        amountLocal: plan.amountLocal,
        payWith: plan.payWith,
        weights: allocation.lines.map((l) => ({ symbol: l.symbol, weightBps: l.weightBps })),
        reviewedMinShares: Object.fromEntries(plan.legs.map((l) => [l.symbol, l.minShares])),
        folio: topUp
          ? { kind: 'existing', address: topUp }
          : {
              kind: 'new',
              name: name.trim() || 'My folio',
              unlockAt: gift.unlockAt,
              reclaimAfter: link ? gift.reclaimAfter : 0,
              claimKey: link ? link.publicKey.toBase58() : null,
              recipient: gift.mode === 'send' && gift.recipient ? gift.recipient : null,
              policyHashHex: allocation.policyHash,
            },
      })

      await signAndSubmit(built.transactions, wallet.signTransaction, { onProgress: setProgress, accessToken: wallet.getAccessToken })

      // The link's secret travels in the fragment, which the browser never sends to a server.
      router.replace(link ? `/folio/${built.folio}#k=${toBase64Url(link.secretKey)}` : `/folio/${built.folio}?created=1`)
    } catch (e) {
      setProgress(null)
      if (e instanceof SubmitError && e.completed > 0) {
        setError('Your folio was created, but the purchase did not go through. Nothing was spent — you can try again from the folio.')
      } else {
        setError(isUserRejection(e) ? 'You cancelled. Nothing has been charged.' : (e as Error).message)
      }
      setStage(topUp ? 'preview' : 'commit')
    }
  }

  if (wallet.ready && !wallet.authenticated) {
    return (
      <>
        <FlowHeader title="New folio" />
        <Screen>
          <h1 className="t-screen">
            Sign in to make a <span className="t-serif text-[34px]">folio</span>
            <Stop />
          </h1>
          <button onClick={wallet.login} className="btn-primary mt-7">
            Sign up or sign in
          </button>
        </Screen>
      </>
    )
  }

  if (stage === 'buying') {
    return (
      <>
        <FlowHeader title="New folio" />
        <Screen>
          <div className="flex min-h-[70vh] flex-col justify-center">
            <Spinner />
            <p className="mt-7 font-mono text-[10px] uppercase tracking-monolabel text-accent">
              {progress ? `${progress.stage === 'signing' ? 'Signing' : 'Confirming'} · ${progress.step} of ${progress.total}` : 'Preparing'}
            </p>
            <h1 className="t-screen mt-3">
              Buying your folio<Stop />
            </h1>
            <p className="t-body mt-5">
              The purchase lands completely or not at all. If any part fails, nothing is spent. Folio pays the network fee.
            </p>
            <p className="figure mt-6 text-[11px] text-body-mute">
              {plan ? formatLocal(plan.amountLocal, code) : ''} · {name || 'My folio'}
            </p>
          </div>
        </Screen>
      </>
    )
  }

  const step = topUp
    ? stage === 'compose'
      ? '01 / 02 Describe'
      : '02 / 02 Check'
    : stage === 'compose'
      ? '01 / 03 Describe'
      : stage === 'preview'
        ? '02 / 03 Check'
        : '03 / 03 Name'

  return (
    <>
      <FlowHeader
        title={topUp ? 'Add to folio' : 'New folio'}
        step={step}
        at={stage === 'compose' ? 1 : stage === 'preview' ? 2 : 3}
        of={topUp ? 2 : 3}
      />
      <Screen>
        {stage === 'compose' && (
          <div>
            <h1 className="t-screen">
              What should it <span className="t-serif text-[34px]">hold</span>?
            </h1>
            <textarea
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Apple, Nvidia and the S&P 500"
              className="field mt-5 min-h-[96px] resize-none"
            />
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => setPrompt(ex)}
                  className="border border-rule-mid px-2 py-1 font-sans text-[11.5px] text-body-soft transition-colors hover:border-ink hover:bg-ink hover:text-ground"
                >
                  {ex}
                </button>
              ))}
            </div>

            <HardRule className="mt-8" />
            <div className="mt-5 flex items-baseline justify-between">
              <MonoLabel>How much</MonoLabel>
              <span className="figure text-[10px] text-body-mute">min {formatLocal(minLocal, code)}</span>
            </div>
            <div className="mt-3 flex items-baseline gap-2 border-b-2 border-ink pb-2">
              <span className="figure text-[26px] text-body-mute">{currency.symbol}</span>
              <input
                type="number"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className="figure w-full border-0 bg-transparent p-0 text-[38px] font-medium text-ink outline-none focus:outline-none"
              />
            </div>
            <div className="mt-3 grid grid-cols-4 border border-rule-hair">
              {presets.map((p, i) => (
                <button
                  key={p}
                  onClick={() => setAmount(String(p))}
                  className={`py-2.5 font-mono text-[10px] tracking-monolabel text-body-soft transition-colors hover:bg-ink hover:text-ground ${i ? 'border-l border-rule-hair' : ''}`}
                >
                  {formatLocal(p, code)}
                </button>
              ))}
            </div>

            <MonoLabel className="mt-7">Pay with</MonoLabel>
            {balances.isLoading ? (
              <div className="mt-2 h-10 bg-ground-inset" />
            ) : held.length ? (
              <div className="mt-2">
                {held.map((s) => (
                  <button
                    key={s.symbol}
                    onClick={() => setPayWith(s.symbol)}
                    className="flex w-full items-baseline justify-between border-t border-rule-hair py-3 text-left"
                  >
                    <span className="flex items-center gap-3">
                      <span aria-hidden="true" className="flex h-4 w-4 items-center justify-center border border-ink bg-white">
                        {pay === s.symbol && <span className="block h-2 w-2 bg-accent" />}
                      </span>
                      <span className="t-cardtitle">{s.symbol}</span>
                    </span>
                    <span className="figure text-[12px] text-body-soft">{formatLocal(usdToLocal(s.usd), code)}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="mt-3 border border-accent p-3.5">
                <p className="t-body-sm">
                  <span className="text-accent">● </span>
                  Nothing to pay with yet. <Link href="/deposit">Add stablecoins</Link> first.
                </p>
              </div>
            )}

            {belowMin && <Problem>Below the smallest order we can fill. Raise the amount to at least {formatLocal(minLocal, code)}.</Problem>}
            {aboveBalance && payBalance && (
              <Problem>
                You have {formatLocal(usdToLocal(payBalance.usd), code)} in {payBalance.symbol}. Add money or lower the amount.
              </Problem>
            )}
            {error && <Problem>{error}</Problem>}

            <button onClick={readAndPrice} disabled={composeBlocked || busy !== null} className="btn-primary mt-8">
              {busy === 'reading' ? 'Reading…' : busy === 'pricing' ? 'Pricing…' : 'See what it buys'}
            </button>
          </div>
        )}

        {stage === 'preview' && allocation && plan && (
          <div>
            <AllocationPreview allocation={allocation} plan={plan} />
            <button onClick={topUp ? buy : () => setStage('commit')} className="btn-primary mt-8">
              {topUp ? `Buy · ${formatLocal(plan.amountLocal, code)}` : 'This looks right'}
            </button>
            <button onClick={() => setStage('compose')} className="btn-secondary mt-2.5">
              Change the wording
            </button>
          </div>
        )}

        {stage === 'commit' && plan && (
          <div>
            <Kicker>Last step</Kicker>
            <h1 className="t-screen mt-4">
              Give it a <span className="t-serif text-[34px]">name</span>
              <Stop />
            </h1>
            <div className="mt-6 border-b-2 border-ink pb-2">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value.slice(0, 40))}
                placeholder="Ada school"
                className="w-full border-0 bg-transparent p-0 font-sans text-[24px] font-bold uppercase tracking-screen text-ink outline-none focus:outline-none"
              />
            </div>
            <div className="mt-1.5 flex items-baseline justify-between">
              <p className="t-disclaimer">Stored with the basket. It is what they see first.</p>
              <span className="figure text-[10px] text-body-mute">{String(name.length).padStart(2, '0')}/40</span>
            </div>

            <GiftOptions value={gift} onChange={setGift} />

            <div className="mt-9 border border-ink p-4">
              <Row label="You pay" value={formatLocal(plan.amountLocal, code)} />
              <Row label="You get" value={plan.legs.map((l) => `${formatShares(l.shares)} ${l.display}`).join(' · ')} />
              <Row label="Cost to get in" value={`${Math.max(0, plan.totalCostPct).toFixed(2)}%`} />
              <Row label="Network fee" value="Free — Folio pays it" />
            </div>

            {error && <Problem>{error}</Problem>}

            <button
              onClick={buy}
              disabled={gift.mode === 'send' && Boolean(gift.recipient) && !isSolanaAddress(gift.recipient)}
              className="btn-primary mt-6 !min-h-[54px]"
            >
              {gift.mode === 'send' ? 'Buy and send' : 'Buy'} · {formatLocal(plan.amountLocal, code)}
            </button>
            <p className="t-disclaimer mt-3 text-center">One confirmation. Nothing to pay in fees.</p>
          </div>
        )}
      </Screen>
    </>
  )
}

function Problem({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 border border-accent p-3.5">
      <p className="t-body-sm">
        <span className="text-accent">● </span>
        {children}
      </p>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-rule-hair py-2.5 first:border-t-0">
      <span className="t-mono-label">{label}</span>
      <span className="figure max-w-[62%] text-right text-[11.5px] text-ink">{value}</span>
    </div>
  )
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`)
  return json as T
}

/** Presets that look like amounts a person would type, in any currency. */
function roundNice(n: number) {
  if (n < 10) return Math.ceil(n)
  const p = 10 ** Math.floor(Math.log10(n))
  return Math.ceil(n / p) * p
}

function suggestName(a: Allocation) {
  const names = a.lines.map((l) => l.display)
  if (names.length === 1) return `My ${names[0]}`
  if (names.length === 2) return `${names[0]} & ${names[1]}`
  return `${names[0]} mix`
}
