'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCurrency } from '@/components/currency-context'
import { AppHeader, HardRule, Kicker, MonoLabel, Screen, SideNote, Spinner, Stop } from '@/components/ui'
import { formatShares } from '@/lib/assets'
import type { BorrowOption, Loan } from '@/lib/borrow'
import { formatLocal } from '@/lib/currencies'
import { isUserRejection, signAndSubmit } from '@/lib/execute'
import { useFolioWallet } from '@/lib/wallet'
import type { FolioView } from '@/lib/folio-reader'

type BorrowData = { options: BorrowOption[]; loan: Loan | null; error?: string }

const PARTS: [string, number][] = [
  ['A quarter', 0.25],
  ['Half', 0.5],
  ['All of it', 1],
]

/**
 * Cash without selling. The whole feature rests on one sentence a person must believe
 * before they sign: if the price falls this far, part of the shares gets sold to repay.
 * That number leads, the rate follows, and the rest stays out of the way.
 */
export default function BorrowPage() {
  const wallet = useFolioWallet()
  const queryClient = useQueryClient()
  const { code, usdToLocal } = useCurrency()
  const [folioAddress, setFolioAddress] = useState<string | null>(null)
  const [symbol, setSymbol] = useState<string | null>(null)
  const [fraction, setFraction] = useState(0.5)
  const [borrow, setBorrow] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const folios = useQuery<{ owned: FolioView[] }>({
    queryKey: ['folios', wallet.address],
    queryFn: async () => (await fetch(`/api/folios?owner=${wallet.address}`)).json(),
    enabled: Boolean(wallet.address),
  })
  const owned = useMemo(() => (folios.data?.owned ?? []).filter((f) => !f.locked && f.holdings.length), [folios.data])
  useEffect(() => {
    if (!folioAddress && owned.length) setFolioAddress(owned[0].address)
  }, [owned, folioAddress])

  const data = useQuery<BorrowData>({
    queryKey: ['borrow', folioAddress, wallet.address],
    queryFn: async () =>
      (await fetch(`/api/borrow?${new URLSearchParams({ ...(folioAddress ? { folio: folioAddress } : {}), ...(wallet.address ? { owner: wallet.address } : {}) })}`)).json(),
    enabled: Boolean(wallet.address),
    refetchInterval: 60_000,
  })

  const options = data.data?.options ?? []
  const chosen = options.find((o) => o.symbol === (symbol ?? options[0]?.symbol))
  const collateralUsd = chosen ? chosen.valueUsd * fraction : 0
  const maxBorrow = chosen ? collateralUsd * chosen.maxLtv : 0
  const borrowNum = Number(borrow)
  const valid = Boolean(chosen) && Number.isFinite(borrowNum) && borrowNum > 0 && borrowNum <= maxBorrow
  // Kamino liquidates a little above the borrow limit; this is the fall that gets there.
  const liquidationDrop = chosen && borrowNum > 0 ? Math.max(0, (1 - borrowNum / (collateralUsd * Math.min(0.95, chosen.maxLtv + 0.05))) * 100) : 0

  async function submit() {
    if (!chosen || !folioAddress || !valid) return
    setError(null)
    setBusy(true)
    try {
      const res = await fetch('/api/build/borrow', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ owner: wallet.address, folio: folioAddress, symbol: chosen.symbol, fraction, borrowUsdc: borrowNum }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not prepare the loan')
      await signAndSubmit(json.transactions, wallet.signTransaction, { accessToken: wallet.getAccessToken })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['borrow'] }),
        queryClient.invalidateQueries({ queryKey: ['folios', wallet.address] }),
        queryClient.invalidateQueries({ queryKey: ['balances', wallet.address] }),
      ])
      setDone(`${formatLocal(usdToLocal(borrowNum), code)} is in your account. Your ${chosen.display} shares are backing it.`)
      setBorrow('')
    } catch (e) {
      setError(isUserRejection(e) ? 'You cancelled. Nothing was borrowed.' : (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function repay(all: boolean) {
    const loan = data.data?.loan
    if (!loan || !chosen) return
    setError(null)
    setBusy(true)
    try {
      const res = await fetch('/api/build/borrow', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'repay', owner: wallet.address, symbol: chosen.symbol, repayUsdc: loan.debtUsd * 1.001, withdrawAll: all }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not prepare the repayment')
      await signAndSubmit(json.transactions, wallet.signTransaction, { accessToken: wallet.getAccessToken })
      await queryClient.invalidateQueries({ queryKey: ['borrow'] })
      setDone('Repaid. Your shares are back in your account — add them to a folio whenever you like.')
    } catch (e) {
      setError(isUserRejection(e) ? 'You cancelled. The loan is unchanged.' : (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const loan = data.data?.loan

  return (
    <>
      <AppHeader />
      <Screen wide>
        <Kicker>Borrow</Kicker>
        <h1 className="t-screen mt-4">
          Cash without <span className="t-serif text-[34px]">selling</span>
          <Stop />
        </h1>
        <p className="t-body mt-5 max-w-[620px]">
          Put some of a folio&apos;s shares up as security and borrow dollars against them. You keep the shares and
          anything they gain. Pay the loan back whenever you like and take them back.
        </p>

        {!wallet.authenticated ? (
          <button onClick={wallet.login} className="btn-primary mt-7 lg:max-w-[360px]">
            Sign up or sign in
          </button>
        ) : (
          <div className="mt-10 lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-14">
            <div>
              {loan && (
                <div className="mb-8 border-2 border-ink p-4">
                  <MonoLabel>Your loan</MonoLabel>
                  <div className="mt-3 flex flex-wrap items-baseline justify-between gap-4">
                    <span>
                      <span className="figure block text-[26px] font-medium text-ink">{formatLocal(usdToLocal(loan.debtUsd), code)}</span>
                      <span className="t-disclaimer">owed</span>
                    </span>
                    <span className="text-right">
                      <span className="figure block text-[15px] text-ink">{formatLocal(usdToLocal(loan.collateralUsd), code)}</span>
                      <span className="t-disclaimer">shares backing it</span>
                    </span>
                  </div>
                  <div className="mt-4">
                    <div className="h-2 w-full bg-ground-inset">
                      <div
                        className="h-2 bg-accent"
                        style={{ width: `${Math.min(100, Math.max(2, (loan.ltv / (loan.liquidationLtv || 1)) * 100))}%` }}
                      />
                    </div>
                    <p className="t-body-sm mt-2">
                      {loan.headroomPct > 0
                        ? `Prices can fall about ${loan.headroomPct.toFixed(0)}% before any shares are sold to repay.`
                        : 'This loan is at its limit — repay some to protect your shares.'}
                    </p>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <button onClick={() => repay(false)} disabled={busy} className="btn-secondary !min-h-[42px] !text-[11px]">
                      Repay all
                    </button>
                    <button onClick={() => repay(true)} disabled={busy} className="btn-primary !min-h-[42px] !text-[11px]">
                      Repay & take shares back
                    </button>
                  </div>
                </div>
              )}

              <p className="t-label">Which folio</p>
              <HardRule className="mt-2.5" />
              {folios.isLoading ? (
                <div className="pt-5">
                  <Spinner />
                </div>
              ) : owned.length ? (
                owned.map((f) => (
                  <button
                    key={f.address}
                    onClick={() => {
                      setFolioAddress(f.address)
                      setSymbol(null)
                      setDone(null)
                    }}
                    className="flex w-full items-baseline justify-between gap-4 border-b border-rule-hair py-3 text-left"
                  >
                    <span className="flex items-center gap-3">
                      <span aria-hidden="true" className="flex h-4 w-4 items-center justify-center border border-ink bg-white">
                        {folioAddress === f.address && <span className="block h-2 w-2 bg-accent" />}
                      </span>
                      <span className="t-cardtitle">{f.name || 'Untitled'}</span>
                    </span>
                    <span className="figure text-[12px] text-body-soft">{formatLocal(usdToLocal(f.totalUsd), code)}</span>
                  </button>
                ))
              ) : (
                <p className="t-body-sm mt-3">
                  No folio can back a loan yet. <Link href="/create">Build one</Link> — locked folios and pre-IPO
                  companies cannot be used as security.
                </p>
              )}

              {folioAddress && (
                <>
                  <p className="t-label mt-8">Which shares to put up</p>
                  <HardRule className="mt-2.5" />
                  {data.isLoading ? (
                    <div className="pt-5">
                      <Spinner />
                    </div>
                  ) : options.length ? (
                    options.map((o) => (
                      <button
                        key={o.symbol}
                        onClick={() => {
                          setSymbol(o.symbol)
                          setDone(null)
                        }}
                        className="flex w-full items-baseline justify-between gap-4 border-b border-rule-hair py-3 text-left"
                      >
                        <span className="flex items-center gap-3">
                          <span aria-hidden="true" className="flex h-4 w-4 items-center justify-center border border-ink bg-white">
                            {chosen?.symbol === o.symbol && <span className="block h-2 w-2 bg-accent" />}
                          </span>
                          <span>
                            <span className="t-cardtitle block">{o.display}</span>
                            <span className="figure mt-0.5 block text-[10.5px] text-body-mute">{formatShares(o.shares)} sh held</span>
                          </span>
                        </span>
                        <span className="figure shrink-0 text-[11px] text-body-soft">borrow up to {(o.maxLtv * 100).toFixed(0)}%</span>
                      </button>
                    ))
                  ) : (
                    <p className="t-body-sm mt-3">
                      {data.data?.error ?? 'Nothing in this folio can back a loan yet. Pre-IPO companies and thin markets are not accepted.'}
                    </p>
                  )}
                </>
              )}
            </div>

            <div className="mt-10 lg:mt-0">
              <div className="border-2 border-ink p-4">
                <MonoLabel>How much of it to put up</MonoLabel>
                <div className="mt-2 flex gap-1.5">
                  {PARTS.map(([label, v]) => (
                    <button
                      key={label}
                      onClick={() => setFraction(v)}
                      className={`border px-2 py-1 font-mono text-[9.5px] uppercase tracking-monolabel transition-colors ${
                        fraction === v ? 'border-ink bg-ink text-ground' : 'border-rule-mid text-body-soft'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className="mt-5 flex items-baseline justify-between">
                  <MonoLabel>Borrow in USDC</MonoLabel>
                  <button
                    onClick={() => setBorrow(String(Math.floor(maxBorrow * 100) / 100))}
                    className="font-mono text-[10px] uppercase tracking-monolabel text-accent"
                  >
                    Max {maxBorrow.toFixed(2)}
                  </button>
                </div>
                <input
                  type="number"
                  inputMode="decimal"
                  value={borrow}
                  onChange={(e) => {
                    setBorrow(e.target.value)
                    setDone(null)
                  }}
                  placeholder="0"
                  className="field figure mt-2 text-[18px]"
                />

                {chosen && (
                  <div className="mt-4">
                    <Row label="Shares put up" value={`${formatShares(chosen.shares * fraction)} ${chosen.display}`} />
                    <Row label="Worth" value={formatLocal(usdToLocal(collateralUsd), code)} />
                    <Row label="Interest" value={`${chosen.borrowApy.toFixed(1)}% a year, paid as you go`} />
                    <Row label="Network fee" value="Free — Folio pays it" />
                  </div>
                )}

                {borrowNum > 0 && chosen && (
                  <div className="mt-4 border-l-2 border-accent pl-3">
                    <p className="t-body-sm">
                      If {chosen.display} falls more than{' '}
                      <span className="text-ink">{liquidationDrop.toFixed(0)}%</span>, part of these shares is sold to
                      repay the loan. Borrow less to leave more room.
                    </p>
                  </div>
                )}

                {error && (
                  <p className="t-body-sm mt-3">
                    <span className="text-accent">● </span>
                    {error}
                  </p>
                )}
                {done && <p className="t-body-sm mt-3 !text-ink">{done}</p>}

                <button onClick={submit} disabled={!valid || busy} className="btn-primary mt-4 !min-h-[48px]">
                  {busy ? 'Working…' : 'Borrow'}
                </button>
                <p className="t-disclaimer mt-2 text-center">Two confirmations: the shares move, then the loan is made.</p>
              </div>

              <div className="mt-6">
                <SideNote>
                  The loan is made by the Kamino lending market, not by Folio, and the position is yours on-chain.
                  Interest accrues until you repay. If the shares fall far enough, some are sold without warning to
                  cover the debt.
                </SideNote>
              </div>
            </div>
          </div>
        )}
      </Screen>
    </>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-rule-hair py-2 first:border-t-0">
      <span className="t-mono-label">{label}</span>
      <span className="figure text-right text-[11.5px] text-ink">{value}</span>
    </div>
  )
}
