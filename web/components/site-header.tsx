'use client'

import Link from 'next/link'
import { useCurrency } from './currency-context'
import { ConnectButton } from './connect-button'
import { CURRENCIES } from '@/lib/assets'

export function SiteHeader() {
  const { code, setCode, currency } = useCurrency()

  return (
    <header className="sticky top-0 z-20 flex items-center gap-3 bg-paper/85 px-5 py-4 backdrop-blur">
      <Link href="/" className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-ink text-[13px] font-bold text-white">
          F
        </span>
        <span className="text-[15px] font-semibold tracking-tight">Folio</span>
      </Link>

      <div className="ml-auto flex items-center gap-2">
        <div className="relative">
          <select
            value={code}
            onChange={(e) => setCode(e.target.value)}
            aria-label="Display currency"
            className="appearance-none rounded-full border border-black/10 bg-white py-2 pl-3 pr-7 text-xs font-semibold text-ink outline-none focus:border-accent/50"
          >
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.symbol} {c.code}
              </option>
            ))}
          </select>
          <svg
            className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink/40"
            width="9"
            height="9"
            viewBox="0 0 10 6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          >
            <path d="M1 1l4 4 4-4" />
          </svg>
        </div>
        <ConnectButton />
      </div>

      {!currency.tradeable && (
        <span className="sr-only">{currency.code} is a display currency; orders settle in {currency.settlesVia}</span>
      )}
    </header>
  )
}
