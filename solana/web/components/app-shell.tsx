'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import { CurrencyChip, Logo, Wordmark } from './ui'
import { useFolioWallet } from '@/lib/wallet'

const NAV = [
  { href: '/', label: 'Portfolio', mark: '01', short: 'Yours' },
  { href: '/markets', label: 'Markets', mark: '02', short: 'Markets' },
  { href: '/explore', label: 'Explore folios', mark: '03', short: 'Explore' },
  { href: '/create', label: 'New folio', mark: '04', short: 'New' },
  { href: '/earn', label: 'Earn on cash', mark: '05' },
  { href: '/borrow', label: 'Borrow', mark: '06' },
  { href: '/plans', label: 'Plans & watches', mark: '07' },
  { href: '/deposit', label: 'Add money', mark: '08' },
  { href: '/withdraw', label: 'Send out', mark: '09' },
  { href: '/developers', label: 'Developers & agents', mark: '10' },
]

/** The five a thumb should always reach; everything else lives behind More. */
const TABS = ['/', '/markets', '/create', '/explore'] as const

/**
 * On a phone Folio is a single column, exactly as designed, with a bar along the bottom for
 * the handful of places a thumb should always reach and a sheet for the rest. From laptop
 * width up that bar gives way to a fixed sidebar holding every destination at once, and the
 * pages widen into two columns where they have two things to say.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname()
  const wallet = useFolioWallet()
  // The claim page is a stand-alone certificate for someone who may not have an account.
  const bare = path.startsWith('/claim/')

  if (bare) return <>{children}</>

  return (
    <div className="min-h-screen lg:flex">
      <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:w-64 lg:flex-col lg:border-r-2 lg:border-ink lg:bg-ground">
        <Link href="/" className="flex items-center gap-2 border-b-2 border-ink px-6 py-5 no-underline">
          <Logo size={18} />
          <Wordmark size={15} />
        </Link>
        <nav className="flex-1 px-3 py-5">
          {NAV.map((n) => {
            const active = n.href === '/' ? path === '/' : path.startsWith(n.href)
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-3 px-3 py-2.5 no-underline transition-colors ${
                  active ? 'bg-ink text-ground' : 'text-ink hover:bg-ground-inset'
                }`}
              >
                <span className={`font-mono text-[10px] tracking-monolabel ${active ? 'text-accent-dark' : 'text-accent'}`}>{n.mark}</span>
                <span className="font-sans text-[13.5px] font-medium">{n.label}</span>
              </Link>
            )
          })}
        </nav>
        <div className="border-t border-rule-hair px-6 py-5">
          <p className="t-mono-label">Show values in</p>
          <div className="mt-2">
            <CurrencyChip />
          </div>
          <div className="mt-5">
            {wallet.authenticated ? (
              <>
                <p className="t-mono-label">Signed in</p>
                <p className="figure mt-1 truncate text-[11px] text-ink" title={wallet.address ?? ''}>
                  {wallet.address ? `${wallet.address.slice(0, 6)}…${wallet.address.slice(-6)}` : 'Setting up…'}
                </p>
                <button onClick={() => wallet.logout()} className="mt-2 font-mono text-[10px] uppercase tracking-monolabel text-accent">
                  Sign out
                </button>
              </>
            ) : (
              <button onClick={wallet.login} className="btn-primary !min-h-[42px] !text-[11px]">
                Sign up or sign in
              </button>
            )}
          </div>
        </div>
      </aside>

      <div className="mx-auto min-h-screen w-full max-w-[430px] bg-ground pb-[72px] lg:ml-64 lg:max-w-none lg:pb-0">
        {children}
      </div>

      <MobileBar />
    </div>
  )
}

function MobileBar() {
  const path = usePathname()
  const wallet = useFolioWallet()
  const [more, setMore] = useState(false)

  // A destination chosen from the sheet should not leave the sheet behind it.
  useEffect(() => setMore(false), [path])

  const rest = NAV.filter((n) => !TABS.includes(n.href as (typeof TABS)[number]))
  const tabs = TABS.map((href) => NAV.find((n) => n.href === href)!)

  return (
    <>
      {more && (
        <div className="fixed inset-0 z-30 lg:hidden">
          <button aria-label="Close" onClick={() => setMore(false)} className="absolute inset-0 bg-ink/40" />
          <div className="absolute inset-x-0 bottom-0 border-t-2 border-ink bg-ground pb-[72px]">
            <div className="px-5 py-4">
              {rest.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className="flex items-center gap-3 border-b border-rule-hair py-3 no-underline last:border-b-0"
                >
                  <span className="font-mono text-[10px] tracking-monolabel text-accent">{n.mark}</span>
                  <span className="font-sans text-[15px] font-medium text-ink">{n.label}</span>
                </Link>
              ))}
              <div className="mt-4 flex items-center justify-between gap-3">
                <CurrencyChip />
                {wallet.authenticated ? (
                  <button onClick={() => wallet.logout()} className="font-mono text-[10px] uppercase tracking-monolabel text-accent">
                    Sign out
                  </button>
                ) : (
                  <button onClick={wallet.login} className="font-mono text-[10px] uppercase tracking-monolabel text-accent">
                    Sign up or sign in
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t-2 border-ink bg-ground lg:hidden">
        <div className="mx-auto flex w-full max-w-[430px]">
          {tabs.map((n) => {
            const active = !more && (n.href === '/' ? path === '/' : path.startsWith(n.href))
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? 'page' : undefined}
                className={`flex flex-1 flex-col items-center gap-1 py-2.5 no-underline ${active ? 'text-ink' : 'text-body-mute'}`}
              >
                <span className={`h-1 w-1 ${active ? 'bg-accent' : 'bg-transparent'}`} />
                <span className="font-sans text-[10.5px] font-medium leading-none">{n.short}</span>
              </Link>
            )
          })}
          <button
            onClick={() => setMore((open) => !open)}
            aria-expanded={more}
            className={`flex flex-1 flex-col items-center gap-1 py-2.5 ${more ? 'text-ink' : 'text-body-mute'}`}
          >
            <span className={`h-1 w-1 ${more ? 'bg-accent' : 'bg-transparent'}`} />
            <span className="font-sans text-[10.5px] font-medium leading-none">More</span>
          </button>
        </div>
      </nav>
    </>
  )
}
