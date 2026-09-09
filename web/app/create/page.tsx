'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAccount, useReadContract } from 'wagmi'
import {
  decodeEventLog,
  erc20Abi,
  formatUnits,
  type Address,
  type Hex,
  type TransactionReceipt,
} from 'viem'
import { useExecutor, useSponsorship, PartialExecutionError, isUserRejection } from '@/lib/use-executor'
import { useCurrency } from '@/components/currency-context'
import { ConnectButton } from '@/components/connect-button'
import { AllocationPreview } from '@/components/allocation-preview'
import { GiftOptions, type GiftSettings } from '@/components/gift-options'
import { AppHeader, FlowHeader, HardRule, Kicker, MonoLabel, Screen, Spinner, Stop } from '@/components/ui'
import { formatLocal, formatShares, settlementCurrency } from '@/lib/assets'
import { buildPurchaseBatch, newClaimSecret, folioVaultAbi, ZERO_BYTES32, type Call } from '@/lib/vault'
import { VAULT_ADDRESS, IS_DEPLOYED } from '@/lib/deployment'
import type { Allocation } from '@/lib/allocator'
import type { PurchasePlan } from '@/lib/quote'

type PlanResponse = {
  plan: PurchasePlan
  reference: { usd: number; premiumPct: number; prices: Record<string, number>; stale: string[] }
}

const EXAMPLES = [
  'US tech that builds chips, no ads',
  'Only Apple and Nvidia',
  'Safe large companies, nothing volatile',
  'AI and cloud, aggressive',
]

const PRESETS: Record<string, number[]> = {
  BRL: [50, 150, 500, 1000],
  NGN: [20_000, 50_000, 150_000, 500_000],
  IDR: [200_000, 500_000, 1_500_000, 5_000_000],
  EUR: [10, 25, 100, 250],
  USD: [10, 25, 100, 250],
}

type Stage = 'compose' | 'preview' | 'commit' | 'buying'

export default function CreatePage() {
  const router = useRouter()
  const { address, isConnected } = useAccount()
  const { code, currency } = useCurrency()
  const sponsorship = useSponsorship()
  const { execute, progress } = useExecutor()

  const [stage, setStage] = useState<Stage>('compose')
  const [prompt, setPrompt] = useState('')
  const [amount, setAmount] = useState('')
  const [allocation, setAllocation] = useState<Allocation | null>(null)
  const [planned, setPlanned] = useState<PlanResponse | null>(null)
  const [name, setName] = useState('')
  const [gift, setGift] = useState<GiftSettings>({ mode: 'keep', unlockAt: 0, recipient: '', reclaimAfter: 0 })
  const [busy, setBusy] = useState<'reading' | 'pricing' | 'building' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stopped, setStopped] = useState<PartialExecutionError | null>(null)
  const [claimSecret, setClaimSecret] = useState<Hex | null>(null)
  const [calls, setCalls] = useState<Call[]>([])
  const [receipts, setReceipts] = useState<TransactionReceipt[] | null>(null)

  const presets = PRESETS[code] ?? PRESETS.USD
  const amountNum = Number(amount)
  const amountValid = Number.isFinite(amountNum) && amountNum > 0

  const settle = settlementCurrency(code)
  const { data: balanceRaw } = useReadContract({
    address: settle.address,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address), refetchInterval: 30_000 },
  })
  const settleBalance =
    balanceRaw !== undefined ? Number(formatUnits(balanceRaw as bigint, settle.decimals)) : null

  // Both errors are computed before the quote so Continue can be blocked immediately.
  const minLocal = useMemo(() => {
    const rate = currency.tradeable ? 1 : 0
    return currency.code === 'USD' ? 1 : rate ? 5 : 1500
  }, [currency])
  const belowMin = amountValid && amountNum < minLocal
  const localBalance = settleBalance === null ? null : currency.tradeable ? settleBalance : null
  const aboveBalance = localBalance !== null && amountValid && amountNum > localBalance
  const composeBlocked = !prompt.trim() || !amountValid || belowMin || aboveBalance

  async function readAndPrice() {
    setError(null)
    setBusy('reading')
    try {
      const aRes = await fetch('/api/allocate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      })
      const alloc = await aRes.json()
      if (!aRes.ok) throw new Error(alloc.error ?? 'Could not read that')
      if (!alloc.lines?.length) throw new Error(alloc.interpretation ?? 'Nothing on the list matches that')

      setBusy('pricing')
      const pRes = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currency: code,
          amountLocal: amountNum,
          weights: alloc.lines.map((l: { symbol: string; weightBps: number }) => ({
            symbol: l.symbol,
            weightBps: l.weightBps,
          })),
        }),
      })
      const plan = await pRes.json()
      if (!pRes.ok) throw new Error(plan.error ?? 'Could not price that basket')

      setAllocation(alloc)
      setPlanned(plan)
      if (!name) setName(suggestName(alloc))
      setStage('preview')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function buy() {
    if (!planned || !allocation || !address) return
    setError(null)
    setStopped(null)
    setBusy('building')
    try {
      const bRes = await fetch('/api/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender: address,
          legs: planned.plan.legs,
          slippageBps: planned.plan.slippageBps,
        }),
      })
      const bJson = await bRes.json()
      if (!bRes.ok) throw new Error(bJson.error ?? 'Could not build the transaction')

      const swaps = planned.plan.legs.map((leg) => {
        const built = bJson.swaps.find((s: { symbol: string }) => s.symbol === leg.symbol)
        if (!built) throw new Error(`Missing route for ${leg.display}`)
        return { leg, routerAddress: built.routerAddress as Address, data: built.data as Hex }
      })

      const isLink = gift.mode === 'gift' && !gift.recipient
      const secret = isLink ? newClaimSecret() : null
      if (secret) setClaimSecret(secret.secret)

      const built = buildPurchaseBatch({
        plan: planned.plan,
        swaps,
        vault: VAULT_ADDRESS,
        intent: {
          name: name.trim() || 'My folio',
          to: gift.mode === 'gift' ? (gift.recipient ? (gift.recipient as Address) : null) : address,
          unlockAt: gift.unlockAt,
          reclaimAfter: gift.reclaimAfter,
          claimHash: secret ? secret.claimHash : ZERO_BYTES32,
          policyHash: allocation.policyHash,
        },
      })

      setCalls(built)
      setStage('buying')
      setBusy(null)

      const outcome = await execute(built)
      setReceipts(outcome.receipts)
    } catch (e) {
      setBusy(null)
      if (e instanceof PartialExecutionError) {
        setStopped(e)
      } else {
        setError(friendly(e as Error))
        setStage('commit')
      }
    }
  }

  const newFolioId = useMemo(() => {
    if (!receipts?.length) return null
    for (const r of receipts) {
      for (const log of r.logs ?? []) {
        try {
          const decoded = decodeEventLog({
            abi: folioVaultAbi,
            data: log.data,
            topics: log.topics as [signature: Hex, ...args: Hex[]],
          })
          if (decoded.eventName === 'FolioCreated') {
            return (decoded.args as unknown as { folioId: bigint }).folioId.toString()
          }
        } catch {
          /* not our event */
        }
      }
    }
    return null
  }, [receipts])

  useEffect(() => {
    if (!newFolioId) return
    router.replace(
      claimSecret ? `/folio/${newFolioId}?claim=${claimSecret}` : `/folio/${newFolioId}?created=1`,
    )
  }, [newFolioId, claimSecret, router])

  if (!isConnected) {
    return (
      <>
        <AppHeader />
        <Screen>
          <Kicker>Before you build</Kicker>
          <h1 className="t-screen mt-4">
            Sign in to make a <span className="t-serif text-[34px]">folio</span>
            <Stop />
          </h1>
          <p className="t-body mt-5">
            A passkey takes seconds and there is no seed phrase, or connect a wallet you already
            have.
          </p>
          <div className="mt-7">
            <ConnectButton full />
          </div>
        </Screen>
      </>
    )
  }

  /* ------------------------------------------------------------ 09 Buying */
  if (stage === 'buying') {
    return (
      <>
        <AppHeader right={<span />} />
        <Screen>
          <Buying
            calls={calls}
            progress={progress}
            stopped={stopped}
            amountLabel={formatLocal(amountNum, code)}
            folioName={name.trim() || 'My folio'}
            onLeaveIt={() => router.push('/')}
          />
        </Screen>
      </>
    )
  }

  const stepLabel =
    stage === 'compose' ? '01 / 03 Describe' : stage === 'preview' ? '02 / 03 Check' : '03 / 03 Name'

  return (
    <>
      <FlowHeader title="New folio" step={stepLabel} />
      <Screen>
        {/* --------------------------------------------------- 06 Compose */}
        {stage === 'compose' && (
          <div>
            <h1 className="t-screen">
              What should it <span className="t-serif text-[34px]">hold</span>?
            </h1>

            <textarea
              rows={3}
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value)
                setAllocation(null)
                setPlanned(null)
              }}
              placeholder="US tech that builds chips, no ads"
              className="field mt-5 min-h-[96px] resize-none"
            />

            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => {
                    setPrompt(ex)
                    setPlanned(null)
                  }}
                  className="border border-rule-mid px-2 py-1 font-sans text-[11.5px] text-body-soft transition-colors hover:border-ink hover:bg-ink hover:text-ground"
                >
                  {ex}
                </button>
              ))}
            </div>

            <HardRule className="mt-8" />

            <div className="mt-5 flex items-baseline justify-between">
              <MonoLabel>How much</MonoLabel>
              <span className="figure text-[10px] text-body-mute">
                min {formatLocal(minLocal, code, { compact: true })}
              </span>
            </div>

            <div className="mt-3 flex items-baseline gap-2 border-b-2 border-ink pb-2">
              <span className="figure text-[26px] text-body-mute">{currency.symbol}</span>
              <input
                type="number"
                inputMode="decimal"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value)
                  setPlanned(null)
                }}
                placeholder="0"
                className="figure w-full border-0 bg-transparent p-0 text-[38px] font-medium text-ink outline-none focus:outline-none"
              />
            </div>

            <div className="mt-3 grid grid-cols-4 border border-rule-hair">
              {presets.map((p, i) => (
                <button
                  key={p}
                  onClick={() => {
                    setAmount(String(p))
                    setPlanned(null)
                  }}
                  className={`py-2.5 font-mono text-[10px] tracking-monolabel text-body-soft transition-colors hover:bg-ink hover:text-ground ${
                    i > 0 ? 'border-l border-rule-hair' : ''
                  }`}
                >
                  {formatLocal(p, code, { compact: true })}
                </button>
              ))}
            </div>

            {belowMin && (
              <div className="mt-4 border border-accent p-3.5">
                <p className="t-body-sm">
                  <span className="text-accent">● </span>
                  Below the smallest order we can fill — the network fee would cost more than the
                  shares. Raise the amount to at least {formatLocal(minLocal, code, { compact: true })}.
                </p>
              </div>
            )}
            {aboveBalance && localBalance !== null && (
              <div className="mt-4 border border-accent p-3.5">
                <p className="t-body-sm">
                  <span className="text-accent">● </span>
                  You have {formatLocal(localBalance, code)}. Add money or lower the amount by{' '}
                  {formatLocal(amountNum - localBalance, code)}.
                </p>
              </div>
            )}

            {error && (
              <div className="mt-4 border border-accent p-3.5">
                <p className="t-body-sm">
                  <span className="text-accent">● </span>
                  {error}
                </p>
              </div>
            )}

            <button onClick={readAndPrice} disabled={composeBlocked || busy !== null} className="btn-primary mt-8">
              {busy === 'reading' ? 'Reading…' : busy === 'pricing' ? 'Pricing…' : 'See what it buys'}
            </button>
          </div>
        )}

        {/* --------------------------------------------------- 07 Preview */}
        {stage === 'preview' && allocation && planned && (
          <div>
            <AllocationPreview allocation={allocation} planned={planned} />
            <button onClick={() => setStage('commit')} className="btn-primary mt-8">
              This looks right
            </button>
            <button onClick={() => setStage('compose')} className="btn-secondary mt-2.5">
              Change the wording
            </button>
          </div>
        )}

        {/* ---------------------------------------------------- 08 Commit */}
        {stage === 'commit' && planned && (
          <div>
            <h1 className="t-screen">
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
              <p className="t-disclaimer">Stored on-chain with the basket. It is what they see first.</p>
              <span className="figure text-[10px] text-body-mute">
                {String(name.length).padStart(2, '0')}/40
              </span>
            </div>

            <GiftOptions value={gift} onChange={setGift} />

            <div className="mt-9 border border-ink p-4">
              <Summary label="You pay" value={formatLocal(planned.plan.amountLocal, code)} />
              <Summary
                label="You get"
                value={planned.plan.legs.map((l) => `${formatShares(l.shares)} ${l.display}`).join(' · ')}
              />
              <Summary label="Cost to get in" value={`${Math.abs(planned.plan.totalCostPct).toFixed(2)}%`} />
              <Summary
                label="Network fee"
                value={sponsorship.available ? 'Free' : formatLocal(planned.plan.totalGasUsd * (1 / 1), 'USD')}
              />
            </div>

            {error && (
              <div className="mt-4 border border-accent p-3.5">
                <p className="t-body-sm">
                  <span className="text-accent">● </span>
                  {error}
                </p>
              </div>
            )}

            <button
              onClick={buy}
              disabled={busy !== null || !IS_DEPLOYED}
              className="btn-primary mt-6 !min-h-[54px]"
            >
              {busy === 'building'
                ? 'Preparing…'
                : `${gift.mode === 'gift' ? 'Buy and send' : 'Buy'} · ${formatLocal(amountNum, code)}`}
            </button>
            <p className="t-disclaimer mt-3 text-center">
              {sponsorship.available
                ? 'One signature on this wallet, and we cover the network fee.'
                : `${calls.length || planned.plan.legs.length * 2 + 2} steps — one signature on a smart wallet.`}
            </p>
          </div>
        )}
      </Screen>
    </>
  )
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-rule-hair py-2.5 first:border-t-0">
      <span className="t-mono-label">{label}</span>
      <span className="figure max-w-[62%] text-right text-[11.5px] text-ink">{value}</span>
    </div>
  )
}

/* ------------------------------------------------------------- 09 Buying */

function Buying({
  calls,
  progress,
  stopped,
  amountLabel,
  folioName,
  onLeaveIt,
}: {
  calls: Call[]
  progress: { mode: 'batch' | 'sequential'; current: number; total: number; label: string } | null
  stopped: PartialExecutionError | null
  amountLabel: string
  folioName: string
  onLeaveIt: () => void
}) {
  // Stopped part-way: the filled legs are real and the shares are in the wallet.
  if (stopped) {
    return (
      <div>
        <Kicker>Stopped part way</Kicker>
        <h1 className="t-screen mt-4">
          {spellOut(stopped.completed)} of the {spellOut(stopped.total)} steps went through
          <Stop />
        </h1>
        <p className="t-body mt-5">
          The part that filled is real. Those shares are in your wallet right now — they are not in
          a folio, because the folio is only created by the final step.
        </p>

        <div className="mt-6 border border-ink p-4">
          <MonoLabel>Where things stand</MonoLabel>
          <div className="mt-2">
            {calls.slice(0, stopped.completed).map((c, i) => (
              <div key={i} className="flex items-baseline justify-between gap-4 border-t border-rule-hair py-2 first:border-t-0">
                <span className="font-sans text-[12.5px] text-ink">{c.label}</span>
                <span className="figure text-[10px] text-body-mute">Done</span>
              </div>
            ))}
            <div className="flex items-baseline justify-between gap-4 border-t border-rule-hair py-2">
              <span className="font-sans text-[12.5px] text-body-soft">{stopped.lastLabel}</span>
              <span className="figure text-[10px] text-accent">Stopped</span>
            </div>
          </div>
        </div>

        <p className="t-body-sm mt-5">
          Nothing was lost and nothing was taken twice. You can start again with the shares you
          already hold, or leave it and sort it out later.
        </p>

        <button onClick={onLeaveIt} className="btn-secondary mt-7">
          Leave it for now
        </button>
      </div>
    )
  }

  // Step-by-step: a wallet that cannot batch signs every call.
  if (progress?.mode === 'sequential') {
    return (
      <div>
        <p className="font-mono text-[10px] uppercase tracking-monolabel text-accent">
          Step {String(progress.current + 1).padStart(2, '0')} of{' '}
          {String(progress.total).padStart(2, '0')}
        </p>
        <h1 className="t-screen mt-4">
          {progress.label}
          <Stop />
        </h1>

        <div className="mt-7">
          {calls.map((c, i) => {
            const state = i < progress.current ? 'done' : i === progress.current ? 'now' : 'wait'
            return (
              <div key={i} className="flex items-baseline gap-3 border-t border-rule-hair py-3">
                <span
                  className={`figure text-[10px] ${
                    state === 'now' ? 'text-accent' : state === 'done' ? 'text-ink' : 'text-body-mute'
                  }`}
                >
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span
                  className={`flex-1 font-sans text-[12.5px] ${
                    state === 'wait' ? 'text-body-mute' : 'text-ink'
                  }`}
                >
                  {c.label}
                </span>
                <span
                  className={`figure text-[9.5px] uppercase tracking-monolabel ${
                    state === 'now' ? 'text-accent' : state === 'done' ? 'text-ink' : 'text-body-mute'
                  }`}
                >
                  {state === 'done' ? 'Done' : state === 'now' ? 'Signing' : 'Waiting'}
                </span>
              </div>
            )
          })}
        </div>

        <p className="t-disclaimer mt-6">
          A smart wallet would do all {progress.total} of these in one signature. Keep confirming
          until the folio is made.
        </p>
      </div>
    )
  }

  // One tap: all or nothing.
  return (
    <div className="flex min-h-[70vh] flex-col justify-center">
      <Spinner />
      <h1 className="t-screen mt-7">
        Buying your folio
        <Stop />
      </h1>
      <p className="t-body mt-5">
        This lands completely or not at all. If any part of it fails, nothing is charged and no
        folio is made.
      </p>
      <p className="figure mt-6 text-[11px] text-body-mute">
        {amountLabel} · {folioName}
      </p>
    </div>
  )
}

function spellOut(n: number) {
  return ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'][n] ?? String(n)
}

function suggestName(alloc: Allocation) {
  const names = alloc.lines.map((l) => l.display)
  if (names.length === 1) return `My ${names[0]}`
  if (names.length === 2) return `${names[0]} & ${names[1]}`
  return `${names[0]} mix`
}

function friendly(e: Error) {
  const m = e.message ?? ''
  if (isUserRejection(e)) return 'You cancelled the confirmation. Nothing has been charged.'
  if (/insufficient/i.test(m)) return 'Not enough balance to cover this order and the network fee.'
  return m || 'Something went wrong. Nothing has been charged.'
}
