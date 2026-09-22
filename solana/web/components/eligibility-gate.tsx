'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Kicker, Screen, Spinner, Stop } from './ui'

const ATTESTED_KEY = 'folio.attested.v1'

type Eligibility = { country: string | null; blocked: boolean; determined: boolean }

/**
 * The wall, as a product surface. Two layers: where the request came from, and what the
 * person says about themselves. Neither is bulletproof alone and neither pretends to be,
 * but shipping without either would be the actual failure.
 */
export function EligibilityGate({ children }: { children: ReactNode }) {
  const [attested, setAttested] = useState<boolean | null>(null)
  const [showBlocked, setShowBlocked] = useState(false)

  useEffect(() => {
    try {
      setAttested(localStorage.getItem(ATTESTED_KEY) === 'true')
    } catch {
      setAttested(false)
    }
  }, [])

  const { data, isLoading } = useQuery<Eligibility>({
    queryKey: ['eligibility'],
    queryFn: async () => (await fetch('/api/eligibility')).json(),
    staleTime: Infinity,
  })

  // Only the localStorage read gates the first paint, and that is synchronous-ish. A
  // returning user should never watch a spinner while we ask a server where they are —
  // the geo check resolves in the background and takes over only if it says no.
  if (attested === null || (isLoading && !attested)) {
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-[430px] items-center justify-center bg-ground">
        <Spinner />
      </div>
    )
  }

  if (data?.blocked || showBlocked) {
    return <Blocked country={data?.country ?? null} onRetry={() => setShowBlocked(false)} real={Boolean(data?.blocked)} />
  }

  if (!attested) {
    return (
      <Gate
        onAccept={() => {
          try {
            localStorage.setItem(ATTESTED_KEY, 'true')
          } catch {
            /* storage can be unavailable; the session still works */
          }
          setAttested(true)
        }}
        onShowBlocked={() => setShowBlocked(true)}
      />
    )
  }

  return <>{children}</>
}

/* ---------------------------------------------------------------- 01 Gate */

function Gate({ onAccept, onShowBlocked }: { onAccept: () => void; onShowBlocked: () => void }) {
  const [checked, setChecked] = useState(false)

  return (
    <div className="mx-auto min-h-screen w-full max-w-[430px] bg-ground">
      <Screen>
        <div className="px-1 pt-6">
          <Kicker>01 · Before we begin</Kicker>

          <h1 className="t-screen mt-4">
            Who may hold these <span className="t-serif text-[34px]">shares</span>
            <Stop />
          </h1>

          <p className="t-body mt-6">
            The tokenized shares Folio buys are issued for people outside the United States. That is
            a restriction on the asset itself, set by its issuer — not a judgement about you.
          </p>
          <p className="t-body mt-4">Confirm below and we will not ask again on this device.</p>

          {/* The whole row is the hit target, bounded top and bottom by hard rules. */}
          <div className="mt-9 border-y border-ink">
            <label className="flex cursor-pointer items-start gap-3.5 py-4">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
                className="sr-only"
              />
              <span
                aria-hidden="true"
                className="mt-[1px] flex h-5 w-5 shrink-0 items-center justify-center border border-ink bg-white"
              >
                {checked && <span className="block h-2.5 w-2.5 bg-accent" />}
              </span>
              <span className="t-body-sm !text-body">
                I am not a US person and I am not accessing Folio from the United States.
              </span>
            </label>
          </div>

          <button onClick={onAccept} disabled={!checked} className="btn-primary mt-8">
            Continue
          </button>

          <button onClick={onShowBlocked} className="btn-ghost mt-6 block">
            What if I am in the US?
          </button>

          <p className="t-disclaimer mt-10">
            Folio is an interface and a vault. It is not a broker or an issuer, and it grants no
            voting or redemption rights beyond what the token itself carries.
          </p>
        </div>
      </Screen>
    </div>
  )
}

/* ------------------------------------------------------------- 02 Blocked */

function Blocked({
  country,
  onRetry,
  real,
}: {
  country: string | null
  onRetry: () => void
  real: boolean
}) {
  return (
    <div className="mx-auto min-h-screen w-full max-w-[430px] bg-ink-void">
      <Screen void>
        <div className="relative min-h-[80vh] px-1 pt-6">
          {/* Decorative letterform bleeding off the corner. Never read, never selected. */}
          <span
            aria-hidden="true"
            className="ghost-letter pointer-events-none absolute -bottom-6 -right-8 text-[210px]"
          >
            us
          </span>

          <div className="relative">
            <Kicker onDark>Not available here</Kicker>

            <h1 className="t-screen mt-4 text-white">
              This is not for you to hold
              <Stop onDark />
            </h1>

            <p className="mt-6 font-sans text-[14px] leading-[1.6] text-body-dark">
              Coinbase tokenized shares are offered only to eligible people outside the United
              States{country && real ? `, and this request came from ${country}` : ''}. Nothing has
              been charged. No account has been created.
            </p>
            <p className="mt-4 font-sans text-[14px] leading-[1.6] text-body-dark">
              If you are travelling, or a VPN is placing you somewhere you are not, turn it off and
              try again from where you actually are.
            </p>

            <button onClick={onRetry} className="btn-on-void mt-9 w-full">
              Try again
            </button>

            <p className="mt-8 font-sans text-[11px] leading-[1.6] text-body-mute">
              This is a property of the asset, set by its issuer. It is not a judgement about you.
            </p>
          </div>
        </div>
      </Screen>
    </div>
  )
}
