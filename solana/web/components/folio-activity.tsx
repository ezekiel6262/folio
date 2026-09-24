'use client'

import { useQuery } from '@tanstack/react-query'
import { HardRule, MonoLabel } from './ui'

type Entry = { at: number; label: string; signature: string; failed: boolean }

const CLUSTER = process.env.NEXT_PUBLIC_CLUSTER === 'devnet' ? '?cluster=devnet' : ''

const when = (ms: number) => {
  const d = new Date(ms)
  const days = Math.floor((Date.now() - ms) / 86_400_000)
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  if (days === 0) return `${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} today`
  if (days === 1) return `${date} · yesterday`
  return date
}

/** Everything that has happened to this folio, each line a transaction anyone can open. */
export function FolioActivity({ folio }: { folio: string }) {
  const { data, isLoading } = useQuery<{ activity: Entry[] }>({
    queryKey: ['activity', folio],
    queryFn: async () => (await fetch(`/api/folio/${folio}/activity`)).json(),
    refetchInterval: 60_000,
  })
  const entries = data?.activity ?? []

  return (
    <div className="mt-9">
      <p className="t-label">What has happened</p>
      <HardRule className="mt-2.5" />
      {isLoading ? (
        <div className="pt-4">
          <div className="h-3 w-40 bg-ground-inset" />
        </div>
      ) : entries.length ? (
        entries.map((e) => (
          <a
            key={`${e.signature}-${e.label}`}
            href={`https://explorer.solana.com/tx/${e.signature}${CLUSTER}`}
            target="_blank"
            rel="noreferrer"
            className="row-hover flex items-baseline justify-between gap-4 border-b border-rule-hair py-2.5 no-underline"
          >
            <span className="font-sans text-[13px] text-ink">
              {e.label}
              {e.failed && <span className="ml-2 font-mono text-[9.5px] uppercase tracking-monolabel text-accent">did not go through</span>}
            </span>
            <span className="figure shrink-0 text-[10.5px] text-body-mute">{when(e.at)} ↗</span>
          </a>
        ))
      ) : (
        <p className="t-body-sm mt-3">Nothing yet.</p>
      )}
      <MonoLabel className="mt-3">Read from the chain, not from Folio&apos;s records.</MonoLabel>
    </div>
  )
}
