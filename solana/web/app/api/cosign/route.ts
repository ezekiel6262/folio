import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Keypair } from '@solana/web3.js'
import { authenticate, AuthError } from '@/lib/auth'
import { cosignAndSend, loadFeePayer, rateLimit } from '@/lib/cosign'
import { connection } from '@/lib/market'

export const dynamic = 'force-dynamic'

let feePayer: Keypair | null = null

/** In production the secret comes from the environment; locally, from solana/.keys. */
function getFeePayer() {
  if (feePayer) return feePayer
  let secret = process.env.FOLIO_FEE_PAYER_SECRET
  if (!secret && process.env.NODE_ENV !== 'production') {
    try {
      secret = readFileSync(join(process.cwd(), '..', '.keys', 'fee-payer.json'), 'utf8')
    } catch {
      // fall through to the error below
    }
  }
  feePayer = loadFeePayer(secret)
  return feePayer
}

/** The browser gets one answer — landed or not — instead of needing its own RPC to find out. */
async function waitForConfirmation(signature: string, timeoutMs = 45_000) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    const { value } = await connection.getSignatureStatuses([signature])
    const status = value[0]
    if (status?.err) return { confirmed: false, error: JSON.stringify(status.err) }
    if (status && (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized')) {
      return { confirmed: true }
    }
    await new Promise((r) => setTimeout(r, 1500))
  }
  return { confirmed: false, error: 'Not confirmed in time. It may still land; check again shortly.' }
}

export async function POST(req: Request) {
  const h = await headers()
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
  if (!rateLimit(ip)) return NextResponse.json({ error: 'Too many requests. Try again in a minute.' }, { status: 429 })

  let userWallets: string[]
  try {
    const who = await authenticate(req)
    if (!rateLimit(`user:${who.userId}`)) {
      return NextResponse.json({ error: 'Too many requests. Try again in a minute.' }, { status: 429 })
    }
    userWallets = who.wallets
  } catch (e) {
    const status = e instanceof AuthError ? e.status : 401
    return NextResponse.json({ error: (e as Error).message }, { status })
  }

  let body: { transaction?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Malformed request' }, { status: 400 })
  }
  if (typeof body.transaction !== 'string') return NextResponse.json({ error: 'No transaction' }, { status: 400 })

  let signer: Keypair
  try {
    signer = getFeePayer()
  } catch (e) {
    return NextResponse.json({ error: `Sponsorship is not configured: ${(e as Error).message}` }, { status: 503 })
  }

  const verdict = await cosignAndSend(body.transaction, { connection, feePayer: signer, userWallets })
  if (!verdict.ok) {
    console.warn(`[cosign] declined: ${verdict.reason}`)
    return NextResponse.json({ error: verdict.reason, logs: verdict.logs?.slice(-12) }, { status: 422 })
  }
  const confirmation = await waitForConfirmation(verdict.signature)
  return NextResponse.json({ signature: verdict.signature, ...confirmation })
}
