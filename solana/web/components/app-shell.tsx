'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { CurrencyChip, Logo, Wordmark } from './ui'
import { useFolioWallet } from '@/lib/wallet'

const NAV = [
  { href: '/', label: 'Portfolio', mark: '01' },
  { href: '/markets', label: 'Markets', mark: '02' },
  { href: '/create', label: 'New folio', mark: '03' },
  { href: '/deposit', label: 'Add money', mark: '04' },
  { href: '/withdraw', label: 'Send out', mark: '05' },
]

/**
 * On a phone Folio is a single column, exactly as designed. From laptop width up it gains
 * a fixed sidebar — the same destinations the phone reaches through its buttons — and the
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

      <div className="mx-auto min-h-screen w-full max-w-[430px] bg-ground lg:ml-64 lg:max-w-none">{children}</div>
    </div>
  )
}
