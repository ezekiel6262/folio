'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'

const ATTESTED_KEY = 'folio.attested.v1'

type Eligibility = { country: string | null; blocked: boolean; determined: boolean }

/**
 * The wall, as a product surface. Two layers: where the request came from, and what the
 * person says about themselves. Neither is bulletproof on its own and neither pretends
 * to be - but shipping without either would be the actual failure.
 */
export function EligibilityGate({ children }: { children: ReactNode }) {
  const [attested, setAttested] = useState<boolean | null>(null)

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

  if (isLoading || attested === null) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-black/10 border-t-accent" />
      </div>
    )
  }

  if (data?.blocked) return <BlockedScreen country={data.country} />
  if (!attested) return <AttestScreen onAccept={() => {
    try { localStorage.setItem(ATTESTED_KEY, 'true') } catch {}
    setAttested(true)
  }} />

  return <>{children}</>
}

function BlockedScreen({ country }: { country: string | null }) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[440px] flex-col justify-center px-6">
      <div className="card p-7">
        <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-full bg-loss/10 text-loss">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="9" />
            <path d="M6 6l12 12" />
          </svg>
        </div>
        <h1 className="text-xl font-semibold tracking-tight">Folio is not available here</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-ink/60">
          Coinbase tokenized stocks are offered only to eligible persons outside the United States.
          We detected that you are connecting from{' '}
          <span className="font-medium text-ink">{country ?? 'a restricted region'}</span>, so Folio will not
          onboard you or route an order.
        </p>
        <p className="mt-4 text-[13px] leading-relaxed text-ink/45">
          This is a jurisdictional restriction on the underlying assets, not a judgement about you.
        </p>
      </div>
    </div>
  )
}

function AttestScreen({ onAccept }: { onAccept: () => void }) {
  const [checked, setChecked] = useState(false)

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[440px] flex-col justify-center px-6">
      <div className="card p-7">
        <p className="label">Before you start</p>
        <h1 className="mt-2 text-[22px] font-semibold leading-tight tracking-tight">
          Folio is for investors outside the United States
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-ink/60">
          The stocks here are Coinbase tokenized equities on Base. They are available to eligible
          non-US persons. Holding and trading them onchain is permissionless, but this app will not
          knowingly onboard a US person.
        </p>

        <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-xl border border-black/10 p-4 transition hover:bg-black/[0.02]">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 accent-accent"
          />
          <span className="text-[14px] leading-relaxed text-ink/80">
            I confirm I am not a US person and I am not accessing Folio from the United States.
          </span>
        </label>

        <button className="btn-primary mt-5 w-full" disabled={!checked} onClick={onAccept}>
          Continue
        </button>

        <p className="mt-4 text-[12px] leading-relaxed text-ink/40">
          Folio is an interface and a vault. It is not a broker, does not custody your assets on
          your behalf off-chain, and grants no voting or redemption rights beyond what the token
          itself carries.
        </p>
      </div>
    </div>
  )
}
