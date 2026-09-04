'use client'

import { isAddress } from 'viem'

export type GiftSettings = {
  mode: 'keep' | 'gift'
  /** Unix seconds. 0 means no lock. */
  unlockAt: number
  /** Empty means mint into escrow behind a claim link. */
  recipient: string
  /** Unix seconds after which an unclaimed gift returns to the sender. */
  reclaimAfter: number
}

const LOCK_PRESETS = [
  { label: 'No lock', months: 0 },
  { label: '1 year', months: 12 },
  { label: '5 years', months: 60 },
  { label: '18th birthday', months: 0, custom: true },
]

function monthsFromNow(months: number) {
  if (!months) return 0
  const d = new Date()
  d.setMonth(d.getMonth() + months)
  return Math.floor(d.getTime() / 1000)
}

export function GiftOptions({ value, onChange }: { value: GiftSettings; onChange: (v: GiftSettings) => void }) {
  const set = (patch: Partial<GiftSettings>) => onChange({ ...value, ...patch })

  const recipientValid = !value.recipient || isAddress(value.recipient)
  const dateValue = value.unlockAt ? new Date(value.unlockAt * 1000).toISOString().slice(0, 10) : ''

  return (
    <div className="mt-6">
      <p className="label">Who is it for</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Choice active={value.mode === 'keep'} onClick={() => set({ mode: 'keep', recipient: '' })}>
          Keep it
        </Choice>
        <Choice active={value.mode === 'gift'} onClick={() => set({ mode: 'gift' })}>
          Send it
        </Choice>
      </div>

      {value.mode === 'gift' && (
        <div className="mt-3 space-y-3">
          <div>
            <label className="label" htmlFor="recipient">
              Their wallet — or leave blank for a claim link
            </label>
            <input
              id="recipient"
              type="text"
              value={value.recipient}
              onChange={(e) => set({ recipient: e.target.value.trim() })}
              placeholder="0x… or leave empty"
              className={`mt-1.5 font-mono text-[13px] ${!recipientValid ? '!border-loss' : ''}`}
            />
            <p className="mt-1.5 text-[12px] leading-relaxed text-ink/45">
              {value.recipient
                ? recipientValid
                  ? 'They will see the folio immediately, even while it is locked.'
                  : 'That is not a valid address.'
                : 'We will create a link. Whoever opens it claims the folio.'}
            </p>
          </div>

          {!value.recipient && (
            <div>
              <label className="label" htmlFor="reclaim">
                Return to you if unclaimed after
              </label>
              <select
                id="reclaim"
                value={value.reclaimAfter ? 'set' : 'never'}
                onChange={(e) => set({ reclaimAfter: e.target.value === 'never' ? 0 : monthsFromNow(3) })}
                className="mt-1.5 w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-[14px] outline-none focus:border-accent/60"
              >
                <option value="never">Never — it stays claimable</option>
                <option value="set">3 months</option>
              </select>
            </div>
          )}
        </div>
      )}

      <p className="label mt-5">Lock until</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {LOCK_PRESETS.filter((p) => !p.custom).map((p) => (
          <button
            key={p.label}
            onClick={() => set({ unlockAt: monthsFromNow(p.months) })}
            className={`pill border transition ${
              (p.months === 0 && !value.unlockAt) ||
              (p.months > 0 && Math.abs(value.unlockAt - monthsFromNow(p.months)) < 86_400)
                ? 'border-accent bg-accent-soft text-accent'
                : 'border-black/10 bg-white text-ink/60'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <input
        type="date"
        value={dateValue}
        min={new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)}
        onChange={(e) =>
          set({ unlockAt: e.target.value ? Math.floor(new Date(e.target.value).getTime() / 1000) : 0 })
        }
        className="mt-2 text-[14px]"
      />
      {value.unlockAt > 0 && (
        <p className="mt-1.5 text-[12px] leading-relaxed text-ink/45">
          Visible the whole time, spendable from{' '}
          {new Date(value.unlockAt * 1000).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })}
          .
        </p>
      )}
    </div>
  )
}

function Choice({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-xl border px-4 py-3 text-[14px] font-semibold transition ${
        active ? 'border-accent bg-accent-soft text-accent' : 'border-black/10 bg-white text-ink/60'
      }`}
    >
      {children}
    </button>
  )
}
