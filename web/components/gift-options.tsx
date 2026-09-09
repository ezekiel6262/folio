'use client'

import { isAddress } from 'viem'
import { MonoLabel } from './ui'

export type GiftSettings = {
  mode: 'keep' | 'gift'
  /** Unix seconds. 0 means no lock. */
  unlockAt: number
  /** Empty means mint into escrow behind a claim link. */
  recipient: string
  /** Unix seconds after which an unclaimed gift returns to the sender. */
  reclaimAfter: number
}

function monthsFromNow(months: number) {
  const d = new Date()
  d.setMonth(d.getMonth() + months)
  return Math.floor(d.getTime() / 1000)
}

/** Screen 08, lower half. Choosing "send" reveals the lock, never the reverse. */
export function GiftOptions({
  value,
  onChange,
}: {
  value: GiftSettings
  onChange: (v: GiftSettings) => void
}) {
  const set = (patch: Partial<GiftSettings>) => onChange({ ...value, ...patch })
  const recipientValid = !value.recipient || isAddress(value.recipient)
  const dateValue = value.unlockAt ? new Date(value.unlockAt * 1000).toISOString().slice(0, 10) : ''

  return (
    <div className="mt-9">
      <MonoLabel>Who is it for</MonoLabel>

      <div className="mt-2">
        <RadioRow
          checked={value.mode === 'keep'}
          onSelect={() => set({ mode: 'keep', recipient: '', unlockAt: 0 })}
          title="Keep it"
          note="It goes into your name and stays there."
        />
        <RadioRow
          checked={value.mode === 'gift'}
          onSelect={() => set({ mode: 'gift' })}
          title="Send it to someone"
          note="They get the whole folio, not a copy of it."
        />
      </div>

      {value.mode === 'gift' && (
        <div className="mt-4 border border-accent bg-ground-inset p-4">
          <MonoLabel>Their wallet — or leave blank for a link</MonoLabel>
          <input
            type="text"
            value={value.recipient}
            onChange={(e) => set({ recipient: e.target.value.trim() })}
            placeholder="0x… or leave empty"
            className={`field mt-2 font-mono text-[12px] ${recipientValid ? '' : '!border-accent'}`}
          />
          <p className="t-body-sm mt-2">
            {value.recipient
              ? recipientValid
                ? 'They will see it immediately, even while it is locked.'
                : 'That is not a valid address.'
              : 'We will make a link. Whoever opens it claims the folio, so send it to one person.'}
          </p>

          <div className="mt-4 border-t border-rule-mid pt-4">
            <MonoLabel>Unlocks on</MonoLabel>
            <input
              type="date"
              value={dateValue}
              min={new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)}
              onChange={(e) =>
                set({ unlockAt: e.target.value ? Math.floor(new Date(e.target.value).getTime() / 1000) : 0 })
              }
              className="field mt-2 font-mono text-[12.5px]"
            />
            <div className="mt-2 flex gap-1.5">
              {[
                { label: 'No lock', months: 0 },
                { label: '1 year', months: 12 },
                { label: '5 years', months: 60 },
              ].map((p) => (
                <button
                  key={p.label}
                  onClick={() => set({ unlockAt: p.months ? monthsFromNow(p.months) : 0 })}
                  className="border border-rule-mid px-2 py-1 font-mono text-[9.5px] uppercase tracking-monolabel text-body-soft transition-colors hover:border-ink hover:bg-ink hover:text-ground"
                >
                  {p.label}
                </button>
              ))}
            </div>
            <p className="t-body-sm mt-3">
              It is theirs from the moment you send it. A lock only holds the taking out, never the
              owning.
            </p>
          </div>

          {!value.recipient && (
            <div className="mt-4 border-t border-rule-mid pt-4">
              <MonoLabel>If nobody claims it</MonoLabel>
              <div className="mt-2 flex gap-1.5">
                {[
                  { label: 'Stays claimable', v: 0 },
                  { label: 'Back to me in 3 months', v: monthsFromNow(3) },
                ].map((o) => (
                  <button
                    key={o.label}
                    onClick={() => set({ reclaimAfter: o.v })}
                    className={`border px-2 py-1 font-mono text-[9.5px] uppercase tracking-monolabel transition-colors ${
                      (value.reclaimAfter === 0) === (o.v === 0)
                        ? 'border-ink bg-ink text-ground'
                        : 'border-rule-mid text-body-soft hover:border-ink'
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function RadioRow({
  checked,
  onSelect,
  title,
  note,
}: {
  checked: boolean
  onSelect: () => void
  title: string
  note: string
}) {
  return (
    <button
      onClick={onSelect}
      className="flex w-full items-start gap-3 border-t border-rule-hair py-3.5 text-left"
      role="radio"
      aria-checked={checked}
    >
      <span
        aria-hidden="true"
        className="mt-[3px] flex h-4 w-4 shrink-0 items-center justify-center border border-ink bg-white"
      >
        {checked && <span className="block h-2 w-2 bg-accent" />}
      </span>
      <span>
        <span className="t-cardtitle block">{title}</span>
        <span className="t-body-sm mt-1 block">{note}</span>
      </span>
    </button>
  )
}
