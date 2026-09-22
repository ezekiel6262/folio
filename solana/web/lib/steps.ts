import 'server-only'
import { PublicKey } from '@solana/web3.js'
import { buildPurchase, type NewFolio } from './buy'
import { folioPda, newNonce } from './folio-program'
import { getMarket } from './market'
import { planPurchase, type PurchasePlan } from './quote'

/**
 * A purchase paid by the buyer's own wallet, one company per transaction. This is the
 * shape any outside wallet can sign — a Blink, an AI agent, another app — because each
 * piece reliably fits Solana's transaction size, and nothing needs Folio's co-signer.
 * Step 0 creates the folio; later steps buy into it.
 */

export type Step = { symbol: string; usd: number; transaction: string; shares: number; minShares: number; plan: PurchasePlan }

export async function buildStep(a: {
  owner: PublicKey
  symbol: string
  usd: number
  folio: NewFolio | { kind: 'existing'; address: string }
  /** Fix the new folio's address in advance so later steps can target it. */
  nonce?: bigint
}): Promise<Step & { folio: string }> {
  const market = await getMarket()
  let lastError = 'No route for that company right now'
  // Compact routes are tried only if the normal one does not fit.
  for (const maxAccounts of [32, 24, 18]) {
    let plan: PurchasePlan
    try {
      plan = await planPurchase({
        displayCode: 'USD',
        amountLocal: a.usd,
        payWith: 'USDC',
        weights: [{ symbol: a.symbol, weightBps: 10_000 }],
        market,
        maxAccounts,
      })
    } catch (e) {
      lastError = (e as Error).message
      continue
    }
    const built = await buildPurchase({ user: a.owner.toBase58(), legs: plan.legs, selfPaid: true, folio: a.folio, nonce: a.nonce }).catch(
      (e: Error) => {
        lastError = e.message
        return null
      },
    )
    if (built?.transactions.length === 1) {
      const leg = plan.legs[0]
      return { symbol: a.symbol, usd: a.usd, transaction: built.transactions[0], shares: leg.shares, minShares: leg.minShares, plan, folio: built.folio }
    }
  }
  throw new Error(lastError)
}

/** Every step of a basket at once, all targeting the same new folio. Sign and send in order, promptly. */
export async function buildAllSteps(a: {
  owner: PublicKey
  weights: { symbol: string; weightBps: number }[]
  amountUsd: number
  folio: NewFolio
}): Promise<{ folio: string; steps: Step[] }> {
  const nonce = newNonce()
  const address = folioPda(a.owner, nonce).toBase58()
  const steps: Step[] = []
  for (const [i, w] of a.weights.entries()) {
    const usd = (a.amountUsd * w.weightBps) / 10_000
    const s = await buildStep({
      owner: a.owner,
      symbol: w.symbol,
      usd,
      folio: i === 0 ? a.folio : { kind: 'existing', address },
      nonce: i === 0 ? nonce : undefined,
    })
    steps.push(s)
  }
  return { folio: address, steps }
}
