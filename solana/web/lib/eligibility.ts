import 'server-only'

/**
 * xStocks and PreStocks are offered only outside the United States. Folio is an interface,
 * not the issuer, but an interface that quietly onboards US persons is not a neutral one.
 */
export const BLOCKED_COUNTRIES = new Set(['US', 'UM', 'AS', 'GU', 'MP', 'PR', 'VI'])

export function countryOf(h: Headers): string | null {
  return h.get('x-vercel-ip-country') ?? h.get('cf-ipcountry') ?? h.get('x-country-code') ?? null
}

export function isBlocked(h: Headers) {
  const c = countryOf(h)
  return c ? BLOCKED_COUNTRIES.has(c.toUpperCase()) : false
}
