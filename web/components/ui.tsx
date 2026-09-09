'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ReactNode } from 'react'
import { CURRENCIES } from '@/lib/assets'
import { useCurrency } from './currency-context'

/**
 * Shared marks and chrome. Every mark here is drawn — the handoff ships no images and
 * no icon library, so arrows and bullets are Unicode set in mono.
 */

/** A folio is a folded sheet: two leaves, with an accent spine cutting edge to edge. */
export function Logo({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" role="img" aria-label="Folio" fill="none">
      <rect x="1" y="1" width="18" height="18" stroke="#111111" strokeWidth="2" />
      <rect x="9" y="0" width="2" height="20" fill="#1a2fd6" />
    </svg>
  )
}

export function Wordmark({ size = 15 }: { size?: number }) {
  return (
    <span
      className="font-sans font-bold uppercase tracking-[0.04em] text-ink"
      style={{ fontSize: size }}
    >
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
        {CURRENCIES.map((c) => (
          <option key={c.code} value={c.code}>
            {c.code}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[8px] text-ink">
        ▾
      </span>
    </div>
  )
}

/** In-app header: logo left, currency right, 2px bottom rule. */
export function AppHeader({ right }: { right?: ReactNode }) {
  return (
    <header className="sticky top-0 z-20 border-b-2 border-ink bg-ground">
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

/** Flow header: back, title, and a step marker on the right. */
export function FlowHeader({ title, step }: { title: string; step?: string }) {
  const router = useRouter()
  return (
    <header className="sticky top-0 z-20 border-b-2 border-ink bg-ground">
      <div className="flex items-center gap-3 px-5 py-3.5">
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
    </header>
  )
}

/** Screens enter with a rise. Wraps the scrolling body of every route. */
export function Screen({
  children,
  padded = true,
  void: isVoid = false,
}: {
  children: ReactNode
  padded?: boolean
  void?: boolean
}) {
  return (
    <main
      className={`animate-rise min-h-screen ${isVoid ? 'bg-ink-void' : 'bg-ground'} ${
        padded ? 'px-5 pb-16 pt-7' : ''
      }`}
    >
      {children}
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
export function Note({
  children,
  tone = 'accent',
}: {
  children: ReactNode
  tone?: 'accent' | 'plain'
}) {
  return (
    <div className={`border p-3.5 ${tone === 'accent' ? 'border-accent' : 'border-rule-hair'}`}>
      <p className="t-body-sm flex gap-2">
        <span className={tone === 'accent' ? 'text-accent' : 'text-body-mute'}>●</span>
        <span>{children}</span>
      </p>
    </div>
  )
}

/** A left-bordered aside, used for the settlement disclosure. */
export function SideNote({ children }: { children: ReactNode }) {
  return (
    <div className="border-l-2 border-accent pl-3">
      <p className="t-body-sm">{children}</p>
    </div>
  )
}

/** Mono key/value row, hairline separated. The workhorse of every summary. */
export function DataRow({
  label,
  value,
  accentValue = false,
}: {
  label: string
  value: ReactNode
  accentValue?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-rule-hair py-2.5 first:border-t-0">
      <span className="t-mono-label">{label}</span>
      <span className={`figure text-[12.5px] ${accentValue ? 'text-accent' : 'text-ink'}`}>{value}</span>
    </div>
  )
}

export function StatusChip({
  children,
  tone = 'outline',
}: {
  children: ReactNode
  tone?: 'outline' | 'solid' | 'mute'
}) {
  const cls =
    tone === 'solid'
      ? 'bg-ink text-ground border-ink'
      : tone === 'mute'
        ? 'border-rule-mid text-body-soft'
        : 'border-accent text-accent'
  return (
    <span className={`inline-block border px-2 py-1 font-mono text-[9.5px] uppercase tracking-monolabel ${cls}`}>
      {children}
    </span>
  )
}
