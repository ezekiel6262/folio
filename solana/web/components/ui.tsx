'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ReactNode } from 'react'
import { DISPLAY_CURRENCIES } from '@/lib/currencies'
import { useCurrency } from './currency-context'

/**
 * Shared marks and chrome. Every mark is drawn — the design ships no images and no icon
 * library, so arrows and bullets are Unicode set in mono.
 */

/**
 * The mark: an ink tile, the f as one stroke, and the crossbar cutting edge to edge.
 * Never rounded, never recoloured; on dark grounds the tile and stroke swap.
 */
export function Logo({ size = 18, onDark = false }: { size?: number; onDark?: boolean }) {
  // Below 20px the strokes thicken so the shape survives.
  const stroke = size < 20 ? 3 : 2.4
  const bar = size < 20 ? 2.8 : 2.2
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label="Folio" fill="none">
      <rect width="24" height="24" fill={onDark ? '#fcfcfc' : '#111111'} />
      <path
        d="M17.4 6.1C16.9 4.7 15.3 4.1 14 4.6C12.8 5.1 12.4 6.4 12.2 7.8L10.6 18.6C10.4 19.9 9.8 20.6 8.6 20.7C7.9 20.8 7.3 20.5 6.9 20"
        stroke={onDark ? '#111111' : '#FCFCFC'}
        strokeWidth={stroke}
        strokeLinecap="butt"
        fill="none"
      />
      <rect x="0" y="10" width="24" height={bar} fill={onDark ? '#1a2fd6' : '#8F9DFF'} />
    </svg>
  )
}

export function Wordmark({ size = 15 }: { size?: number }) {
  return (
    <span className="font-sans font-extrabold uppercase tracking-[0.02em] text-ink" style={{ fontSize: size }}>
      Folio<span className="text-accent">.</span>
    </span>
  )
}

/** Headlines end on an accent period. On dark grounds it lightens for contrast. */
export function Stop({ onDark = false, mark = '.' }: { onDark?: boolean; mark?: string }) {
  return <span className={onDark ? 'text-accent-dark' : 'text-accent'}>{mark}</span>
}

export function Kicker({ children, onDark = false }: { children: ReactNode; onDark?: boolean }) {
  return <p className={`t-kicker ${onDark ? '!text-accent-dark' : ''}`}>{children}</p>
}

export function MonoLabel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`t-mono-label ${className}`}>{children}</p>
}

export function HardRule({ className = '' }: { className?: string }) {
  return <hr className={`border-0 border-t-2 border-ink ${className}`} />
}

export function HairRule({ className = '' }: { className?: string }) {
  return <hr className={`border-0 border-t border-rule-hair ${className}`} />
}

export function CurrencyChip() {
  const { code, setCode } = useCurrency()
  return (
    <div className="relative">
      <select
        value={code}
        onChange={(e) => setCode(e.target.value)}
        aria-label="Display currency"
        className="appearance-none border border-ink bg-transparent py-[5px] pl-2.5 pr-6 font-mono text-[10px] uppercase tracking-monolabel text-ink outline-none"
      >
        {DISPLAY_CURRENCIES.map((c) => (
          <option key={c.code} value={c.code}>
            {c.code}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[8px] text-ink">▾</span>
    </div>
  )
}

/** In-app header: logo left, currency and account right, 2px bottom rule. */
export function AppHeader({ right }: { right?: ReactNode }) {
  return (
    <header className="sticky top-0 z-20 border-b-2 border-ink bg-ground lg:hidden">
      <div className="flex items-center justify-between px-5 py-3.5">
        <Link href="/" className="flex items-center gap-2 no-underline">
          <Logo size={16} />
          <Wordmark size={14} />
        </Link>
        <div className="flex items-center gap-2">{right ?? <CurrencyChip />}</div>
      </div>
    </header>
  )
}

/**
 * Flow header: back, title, a step marker on the right, and — when the flow has steps — a
 * bar under it saying how much of the flow is behind you.
 */
export function FlowHeader({ title, step, at, of: total }: { title: string; step?: string; at?: number; of?: number }) {
  const router = useRouter()
  return (
    <header className="sticky top-0 z-20 border-b-2 border-ink bg-ground">
      <div className="mx-auto flex w-full items-center gap-3 px-5 py-3.5 lg:max-w-[760px] lg:px-10">
        <button
          onClick={() => router.back()}
          aria-label="Back"
          className="-ml-2 flex h-11 w-11 items-center justify-center font-mono text-[15px] text-ink transition-colors hover:text-accent"
        >
          ←
        </button>
        <span className="t-cardtitle flex-1">{title}</span>
        {step && <span className="font-mono text-[10px] uppercase tracking-monolabel text-accent">{step}</span>}
      </div>
      {at != null && total != null && total > 1 && (
        <div className="mx-auto flex w-full gap-1 px-5 pb-2 lg:max-w-[760px] lg:px-10">
          {Array.from({ length: total }, (_, i) => (
            <span key={i} className={`h-[3px] flex-1 ${i < at ? 'bg-accent' : 'bg-rule-hair'}`} />
          ))}
        </div>
      )}
    </header>
  )
}

/** Screens enter with a rise. Wraps the scrolling body of every route. */
export function Screen({
  children,
  padded = true,
  void: isVoid = false,
  wide = false,
}: {
  children: ReactNode
  padded?: boolean
  void?: boolean
  /** Two-column pages on desktop; single-purpose flows stay at a readable width. */
  wide?: boolean
}) {
  return (
    <main className={`animate-rise min-h-screen ${isVoid ? 'bg-ink-void' : 'bg-ground'}`}>
      <div
        className={`mx-auto w-full ${wide ? 'lg:max-w-[1180px]' : 'lg:max-w-[760px]'} ${padded ? 'px-5 pb-16 pt-7 lg:px-10 lg:pt-12' : ''}`}
      >
        {children}
      </div>
    </main>
  )
}

export function Spinner() {
  return (
    <span
      className="animate-spin inline-block h-[34px] w-[34px] rounded-none border border-rule-hair"
      style={{ borderTopColor: '#1a2fd6' }}
      aria-hidden="true"
    />
  )
}

/** A bordered note carrying a single point. Accent border for things to act on. */
export function Note({ children, tone = 'accent' }: { children: ReactNode; tone?: 'accent' | 'plain' }) {
  return (
    <div className={`border p-3.5 ${tone === 'accent' ? 'border-accent' : 'border-rule-hair'}`}>
      <p className="t-body-sm flex gap-2">
        <span className={tone === 'accent' ? 'text-accent' : 'text-body-mute'}>●</span>
        <span>{children}</span>
      </p>
    </div>
  )
}

/** A left-bordered aside, used for disclosures that must be read, not skimmed. */
export function SideNote({ children }: { children: ReactNode }) {
  return (
    <div className="border-l-2 border-accent pl-3">
      <p className="t-body-sm">{children}</p>
    </div>
  )
}

/** Mono key/value row, hairline separated. The workhorse of every summary. */
export function DataRow({ label, value, accentValue = false }: { label: string; value: ReactNode; accentValue?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-rule-hair py-2.5 first:border-t-0">
      <span className="t-mono-label">{label}</span>
      <span className={`figure text-[12.5px] ${accentValue ? 'text-accent' : 'text-ink'}`}>{value}</span>
    </div>
  )
}

export function StatusChip({ children, tone = 'outline' }: { children: ReactNode; tone?: 'outline' | 'solid' | 'mute' }) {
  const cls =
    tone === 'solid' ? 'bg-ink text-ground border-ink' : tone === 'mute' ? 'border-rule-mid text-body-soft' : 'border-accent text-accent'
  return (
    <span className={`inline-block border px-2 py-1 font-mono text-[9.5px] uppercase tracking-monolabel ${cls}`}>{children}</span>
  )
}
