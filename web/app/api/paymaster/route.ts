import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import {
  PAYMASTER_URL,
  SPONSORSHIP_ENABLED,
  checkUserOperation,
  isAllowedMethod,
  rateLimit,
} from '@/lib/paymaster'

export const dynamic = 'force-dynamic'

/** Lets the client learn whether gas is on us without ever seeing the paymaster URL. */
export async function GET() {
  return NextResponse.json({ sponsorship: SPONSORSHIP_ENABLED })
}

export async function POST(req: Request) {
  if (!SPONSORSHIP_ENABLED) {
    return NextResponse.json({ error: 'Gas sponsorship is not configured' }, { status: 503 })
  }

  const h = await headers()
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!rateLimit(ip)) {
    return NextResponse.json({ error: 'Too many sponsorship requests' }, { status: 429 })
  }

  let body: { id?: unknown; method?: unknown; params?: unknown[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Malformed request' }, { status: 400 })
  }

  if (!isAllowedMethod(body.method)) {
    return NextResponse.json({ error: `Method ${String(body.method)} is not proxied` }, { status: 403 })
  }

  // params[0] is the user operation for both paymaster methods.
  const check = checkUserOperation(Array.isArray(body.params) ? body.params[0] : undefined)
  if (!check.ok) {
    // A refusal is a JSON-RPC error, not an HTTP one: the wallet needs to read it and
    // fall back to the user paying their own gas rather than treating this as a crash.
    console.warn(`[paymaster] declined: ${check.reason}`)
    return NextResponse.json({
      jsonrpc: '2.0',
      id: body.id ?? null,
      error: { code: -32001, message: `Not sponsored: ${check.reason}` },
    })
  }

  try {
    const upstream = await fetch(PAYMASTER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: body.id ?? 1, method: body.method, params: body.params }),
      cache: 'no-store',
    })
    const json = await upstream.json()
    return NextResponse.json(json, { status: upstream.ok ? 200 : upstream.status })
  } catch (e) {
    return NextResponse.json(
      { jsonrpc: '2.0', id: body.id ?? null, error: { code: -32000, message: (e as Error).message } },
      { status: 502 },
    )
  }
}
