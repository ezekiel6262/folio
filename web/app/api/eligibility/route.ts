import { NextResponse } from 'next/server'
import { headers } from 'next/headers'

export const dynamic = 'force-dynamic'

/**
 * Coinbase tokenized stocks are offered to eligible persons outside the United States.
 * Folio is an interface, not the issuer, but an interface that quietly onboards US
 * persons is not a neutral one. The check is server-side and the block is a screen,
 * not a line of small print.
 */
const BLOCKED = new Set(['US', 'UM', 'AS', 'GU', 'MP', 'PR', 'VI'])

export async function GET() {
  const h = await headers()
  const country =
    h.get('x-vercel-ip-country') ??
    h.get('cf-ipcountry') ??
    h.get('x-country-code') ??
    null

  return NextResponse.json({
    country,
    blocked: country ? BLOCKED.has(country.toUpperCase()) : false,
    // Locally, and behind proxies that strip geo headers, there is nothing to go on.
    determined: Boolean(country),
  })
}
