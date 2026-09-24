'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * Watches and standing plans, kept on this device.
 *
 * Folio has no database and no way to message you while the app is closed, so these are
 * stored in the browser and checked whenever you open it. That is a real limit, said
 * plainly in the interface rather than dressed up as notifications.
 */

const KEY = 'folio.plans.v1'

export type Watch = {
  id: string
  kind: 'watch'
  symbol: string
  direction: 'above' | 'below'
  /** The price to watch for, in USD, so it survives a change of display currency. */
  priceUsd: number
  createdAt: number
  /** Set once it has fired, so it stops shouting. */
  firedAt?: number
}

export type Plan = {
  id: string
  kind: 'plan'
  /** What to buy, in the user's own words. */
  prompt: string
  amountLocal: number
  currency: string
  everyDays: number
  /** When the next one is due. */
  dueAt: number
  lastDoneAt?: number
}

export type Entry = Watch | Plan

const read = (): Entry[] => {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Entry[]) : []
  } catch {
    return []
  }
}

const write = (entries: Entry[]) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries))
  } catch {
    /* private browsing: the session still works, nothing is remembered */
  }
  window.dispatchEvent(new Event('folio.plans'))
}

const id = () => Math.random().toString(36).slice(2, 10)
export const DAY_MS = 86_400_000

/** Everything stored on this device, kept in step across screens. */
export function usePlans() {
  const [entries, setEntries] = useState<Entry[]>([])

  useEffect(() => {
    const refresh = () => setEntries(read())
    refresh()
    window.addEventListener('folio.plans', refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener('folio.plans', refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])

  const addWatch = useCallback((w: Omit<Watch, 'id' | 'kind' | 'createdAt'>) => {
    write([...read(), { ...w, id: id(), kind: 'watch', createdAt: Date.now() }])
  }, [])

  const addPlan = useCallback((p: Omit<Plan, 'id' | 'kind' | 'dueAt'>) => {
    // The first one is due now: a plan nobody acts on today is a plan nobody keeps.
    write([...read(), { ...p, id: id(), kind: 'plan', dueAt: Date.now() }])
  }, [])

  const remove = useCallback((entryId: string) => write(read().filter((e) => e.id !== entryId)), [])

  const markFired = useCallback((entryId: string) => {
    write(read().map((e) => (e.id === entryId && e.kind === 'watch' ? { ...e, firedAt: Date.now() } : e)))
  }, [])

  const markDone = useCallback((entryId: string) => {
    write(
      read().map((e) =>
        e.id === entryId && e.kind === 'plan' ? { ...e, lastDoneAt: Date.now(), dueAt: Date.now() + e.everyDays * DAY_MS } : e,
      ),
    )
  }, [])

  const snooze = useCallback((entryId: string) => {
    write(read().map((e) => (e.id === entryId && e.kind === 'plan' ? { ...e, dueAt: Date.now() + DAY_MS } : e)))
  }, [])

  return { entries, addWatch, addPlan, remove, markFired, markDone, snooze }
}

/** Which watches have come true, given today's prices. */
export function triggered(entries: Entry[], shareUsd: Record<string, number>): Watch[] {
  return entries.filter(
    (e): e is Watch =>
      e.kind === 'watch' &&
      !e.firedAt &&
      typeof shareUsd[e.symbol] === 'number' &&
      (e.direction === 'above' ? shareUsd[e.symbol] >= e.priceUsd : shareUsd[e.symbol] <= e.priceUsd),
  )
}

export const due = (entries: Entry[]): Plan[] => entries.filter((e): e is Plan => e.kind === 'plan' && e.dueAt <= Date.now())
