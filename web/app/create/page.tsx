'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAccount, useReadContract } from 'wagmi'
import { useSendCalls, useWaitForCallsStatus } from 'wagmi/experimental'
import { decodeEventLog, erc20Abi, formatUnits, type Address, type Hex } from 'viem'
import { useCurrency } from '@/components/currency-context'
import { ConnectButton } from '@/components/connect-button'
import { AllocationPreview } from '@/components/allocation-preview'
import { GiftOptions, type GiftSettings } from '@/components/gift-options'
import { formatLocal, settlementCurrency } from '@/lib/assets'
import { buildPurchaseBatch, newClaimSecret, folioVaultAbi, ZERO_BYTES32 } from '@/lib/vault'
import { VAULT_ADDRESS, IS_DEPLOYED } from '@/lib/deployment'
import type { Allocation } from '@/lib/allocator'
import type { PurchasePlan } from '@/lib/quote'

type PlanResponse = {
  plan: PurchasePlan
  reference: { usd: number; premiumPct: number; prices: Record<string, number>; stale: string[] }
}

const EXAMPLES = [
  'US tech that builds chips, no ads, for university',
  'Only Apple and Nvidia',
  'Safe large companies, nothing volatile',
  'AI and cloud, aggressive',
]

const PRESETS: Record<string, number[]> = {
  NGN: [20_000, 50_000, 150_000],
  BRL: [50, 150, 500],
  IDR: [200_000, 500_000, 1_500_000],
  EUR: [10, 25, 100],
  USD: [10, 25, 100],
}

export default function CreatePage() {
  const router = useRouter()
  const { address, isConnected } = useAccount()
  const { code, currency } = useCurrency()

  const [prompt, setPrompt] = useState('')
  const [amount, setAmount] = useState<string>('')
  const [allocation, setAllocation] = useState<Allocation | null>(null)
  const [planned, setPlanned] = useState<PlanResponse | null>(null)
  const [name, setName] = useState('')
  const [gift, setGift] = useState<GiftSettings>({ mode: 'keep', unlockAt: 0, recipient: '', reclaimAfter: 0 })
  const [busy, setBusy] = useState<'allocate' | 'plan' | 'execute' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [claimSecret, setClaimSecret] = useState<Hex | null>(null)

  const { sendCallsAsync } = useSendCalls()
  const [callsId, setCallsId] = useState<string | undefined>()
  const { data: callsStatus } = useWaitForCallsStatus({ id: callsId, query: { enabled: Boolean(callsId) } })

  const presets = PRESETS[code] ?? PRESETS.USD
  const amountNum = Number(amount)
  const amountValid = Number.isFinite(amountNum) && amountNum > 0

  // Check the wallet can actually cover the order before offering to place it. Finding
  // out at the confirmation sheet is the worst possible moment.
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
  const needed = planned ? planned.plan.amountSettlementHuman : 0
  const shortfall = settleBalance !== null && planned ? needed - settleBalance : 0
  const canAfford = settleBalance === null || shortfall <= 0

  async function runAllocate() {
    setError(null)
    setBusy('allocate')
    try {
      const res = await fetch('/api/allocate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not read that')
      if (!json.lines?.length) throw new Error(json.interpretation ?? 'Nothing matched that description')
      setAllocation(json)
      if (!name) setName(suggestName(json))
      await runPlan(json)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function runPlan(alloc: Allocation) {
    setBusy('plan')
    try {
      const res = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currency: code,
          amountLocal: amountNum,
          weights: alloc.lines.map((l) => ({ symbol: l.symbol, weightBps: l.weightBps })),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not price that basket')
      setPlanned(json)
    } catch (e) {
      setError((e as Error).message)
      setPlanned(null)
    } finally {
      setBusy(null)
    }
  }

  async function execute() {
    if (!planned || !allocation || !address) return
    setError(null)
    setBusy('execute')
    try {
      const buildRes = await fetch('/api/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender: address,
          legs: planned.plan.legs,
          slippageBps: planned.plan.slippageBps,
        }),
      })
      const buildJson = await buildRes.json()
      if (!buildRes.ok) throw new Error(buildJson.error ?? 'Could not build the transaction')

      const swaps = planned.plan.legs.map((leg) => {
        const built = buildJson.swaps.find((s: { symbol: string }) => s.symbol === leg.symbol)
        if (!built) throw new Error(`Missing route for ${leg.display}`)
        return { leg, routerAddress: built.routerAddress as Address, data: built.data as Hex }
      })

      const isClaimLink = gift.mode === 'gift' && !gift.recipient
      const secret = isClaimLink ? newClaimSecret() : null
      if (secret) setClaimSecret(secret.secret)

      const calls = buildPurchaseBatch({
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

      const result = await sendCallsAsync({ calls })
      setCallsId(typeof result === 'string' ? result : result.id)
    } catch (e) {
      setError(friendlyError(e as Error))
      setBusy(null)
    }
  }

  // Once the batch lands, pull the new folio id out of the FolioCreated log.
  const newFolioId = useMemo(() => {
    const receipts = callsStatus?.receipts
    if (!receipts?.length) return null
    for (const r of receipts) {
      for (const log of r.logs ?? []) {
        try {
          const decoded = decodeEventLog({
            abi: folioVaultAbi,
            data: log.data,
            // Receipt logs type topics as a plain array; decodeEventLog wants the tuple.
            topics: log.topics as [signature: Hex, ...args: Hex[]],
          })
          if (decoded.eventName === 'FolioCreated') {
            return (decoded.args as unknown as { folioId: bigint }).folioId.toString()
          }
        } catch {
          // not our event
        }
      }
    }
    return null
  }, [callsStatus])

  // Navigation is a side effect; doing it during render trips React 19 strict mode.
  useEffect(() => {
    if (!newFolioId) return
    router.replace(
      claimSecret ? `/folio/${newFolioId}?claim=${claimSecret}` : `/folio/${newFolioId}?created=1`,
    )
  }, [newFolioId, claimSecret, router])

  if (!isConnected) {
    return (
      <div className="pt-10">
        <h1 className="text-[24px] font-semibold tracking-tight">Sign in to build a folio</h1>
        <p className="mt-2 text-[15px] text-ink/60">A passkey is all it takes. No seed phrase.</p>
        <div className="mt-6">
          <ConnectButton full />
        </div>
      </div>
    )
  }

  return (
    <div className="pt-2">
      <h1 className="text-[22px] font-semibold tracking-tight">Build a folio</h1>

      {/* 1. What do you want, and how much? */}
      <div className="card mt-4 p-5">
        <label className="label" htmlFor="prompt">
          Describe it
        </label>
        <textarea
          id="prompt"
          rows={3}
          value={prompt}
          onChange={(e) => {
            setPrompt(e.target.value)
            setAllocation(null)
            setPlanned(null)
          }}
          placeholder="US tech that builds chips, no ads, for university"
          className="mt-2 resize-none"
        />
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => {
                setPrompt(ex)
                setAllocation(null)
                setPlanned(null)
              }}
              className="pill border border-black/10 bg-white text-ink/60 transition hover:border-accent/40 hover:text-ink"
            >
              {ex}
            </button>
          ))}
        </div>

        <label className="label mt-6 block" htmlFor="amount">
          How much, in {code}
        </label>
        <div className="relative mt-2">
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink/40">
            {currency.symbol}
          </span>
          <input
            id="amount"
            type="number"
            inputMode="decimal"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value)
              setPlanned(null)
            }}
            placeholder="0"
            className="figure !pl-9 text-[17px] font-semibold"
          />
        </div>
        <div className="mt-2.5 flex gap-1.5">
          {presets.map((p) => (
            <button
              key={p}
              onClick={() => {
                setAmount(String(p))
                setPlanned(null)
              }}
              className="pill flex-1 border border-black/10 bg-white text-ink/70 transition hover:border-accent/40"
            >
              {formatLocal(p, code, { compact: true })}
            </button>
          ))}
        </div>

        <button
          onClick={runAllocate}
          disabled={!prompt.trim() || !amountValid || busy !== null}
          className="btn-primary mt-5 w-full"
        >
          {busy === 'allocate' ? 'Reading…' : busy === 'plan' ? 'Pricing…' : 'Preview the folio'}
        </button>
      </div>

      {error && (
        <p className="mt-3 rounded-xl bg-loss/[0.06] px-4 py-3 text-[13px] leading-relaxed text-loss">{error}</p>
      )}

      {/* 2. What it will cost, line by line. */}
      {allocation && planned && (
        <>
          <AllocationPreview allocation={allocation} planned={planned} />

          <div className="card mt-4 p-5">
            <label className="label" htmlFor="name">
              Name it
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ada school"
              maxLength={40}
              className="mt-2"
            />
            <p className="mt-2 text-[12px] text-ink/40">
              The name is stored onchain with the basket. It is what the recipient sees first.
            </p>

            <GiftOptions value={gift} onChange={setGift} />
          </div>

          {!canAfford && (
            <p className="mt-4 rounded-xl bg-loss/[0.06] px-4 py-3 text-[13px] leading-relaxed text-loss">
              You need {shortfall.toLocaleString(undefined, { maximumFractionDigits: 2 })} more{' '}
              {settle.token} to place this order. Your balance is{' '}
              {settleBalance?.toLocaleString(undefined, { maximumFractionDigits: 2 })} {settle.token}.
            </p>
          )}

          <button
            onClick={execute}
            disabled={busy === 'execute' || Boolean(callsId) || !IS_DEPLOYED || !canAfford}
            className="btn-primary mt-4 w-full"
          >
            {busy === 'execute' || callsId
              ? 'Confirming…'
              : gift.mode === 'gift'
                ? `Send ${formatLocal(amountNum, code, { compact: true })}`
                : `Buy ${formatLocal(amountNum, code, { compact: true })}`}
          </button>
          <p className="mt-2.5 text-center text-[12px] text-ink/40">
            One tap. {planned.plan.legs.length * 2 + 2} calls batched into a single confirmation.
          </p>
        </>
      )}
    </div>
  )
}

function suggestName(alloc: Allocation) {
  const names = alloc.lines.map((l) => l.display)
  if (names.length === 1) return `My ${names[0]}`
  if (names.length === 2) return `${names[0]} & ${names[1]}`
  return `${names[0]} mix`
}

function friendlyError(e: Error) {
  const m = e.message ?? ''
  if (/user rejected|denied/i.test(m)) return 'You cancelled the confirmation.'
  if (/insufficient/i.test(m)) return 'Not enough balance to cover this order and gas.'
  if (/atomic|not supported|5792/i.test(m))
    return 'This wallet cannot batch calls. Folio needs a Coinbase Smart Wallet for the one-tap flow.'
  return m || 'Something went wrong.'
}
