'use client'

import { useCallback, useState } from 'react'
import { useAccount, useCapabilities, useConfig, useSendTransaction } from 'wagmi'
import { useSendCalls } from 'wagmi/experimental'
import { useQuery } from '@tanstack/react-query'
import { waitForTransactionReceipt } from '@wagmi/core'
import { waitForCallsStatus } from '@wagmi/core/experimental'
import { base } from 'wagmi/chains'
import type { TransactionReceipt } from 'viem'
import type { Call } from './vault'

/**
 * One interface, two realities.
 *
 * A Coinbase Smart Wallet executes the whole sequence atomically through EIP-5792: the
 * user taps once and either gets the entire folio or nothing. An ordinary EOA wallet
 * cannot do that, so the same calls are sent one at a time.
 *
 * The difference is not cosmetic and is not hidden. In sequential mode a failure part
 * way through leaves real tokens in the user's wallet, and `PartialExecutionError`
 * carries exactly how far it got so the UI can say so.
 */

export type ExecutionMode = 'batch' | 'sequential'

export type ExecutionProgress = {
  mode: ExecutionMode
  /** Index of the step being signed, 0-based. */
  current: number
  total: number
  label: string
}

export class PartialExecutionError extends Error {
  completed: number
  total: number
  lastLabel: string
  constructor(message: string, completed: number, total: number, lastLabel: string) {
    super(message)
    this.name = 'PartialExecutionError'
    this.completed = completed
    this.total = total
    this.lastLabel = lastLabel
  }
}

export function isUserRejection(error: unknown) {
  const m = (error as Error)?.message ?? ''
  return /user rejected|user denied|rejected the request|cancell?ed/i.test(m)
}

/** Signals that a wallet simply cannot batch, as opposed to refusing this batch. */
function cannotBatch(error: unknown) {
  const m = `${(error as Error)?.name ?? ''} ${(error as Error)?.message ?? ''}`
  return (
    /wallet_sendCalls/i.test(m) ||
    /does not support|unsupported|not supported/i.test(m) ||
    /method not found|does not exist|unavailable/i.test(m) ||
    /UnsupportedProviderMethod|MethodNotFound/i.test(m) ||
    /atomic/i.test(m)
  )
}

/**
 * Gas is sponsored only when the app has a paymaster configured AND the connected
 * wallet can actually use one. An EOA cannot, which is another reason the smart wallet
 * path is the one worth recommending.
 */
export function useSponsorship() {
  const { isConnected } = useAccount()
  const { data: capabilities } = useCapabilities({ query: { enabled: isConnected } })

  const { data: appHasPaymaster } = useQuery({
    queryKey: ['paymaster-status'],
    queryFn: async () => {
      const res = await fetch('/api/paymaster')
      if (!res.ok) return false
      return Boolean((await res.json()).sponsorship)
    },
    staleTime: Infinity,
  })

  const walletSupports = Boolean(
    (capabilities as Record<number, { paymasterService?: { supported?: boolean } }> | undefined)?.[base.id]
      ?.paymasterService?.supported,
  )

  return {
    available: Boolean(appHasPaymaster) && walletSupports,
    appHasPaymaster: Boolean(appHasPaymaster),
    walletSupports,
  }
}

export function useExecutor() {
  const config = useConfig()
  const { sendCallsAsync } = useSendCalls()
  const { sendTransactionAsync } = useSendTransaction()
  const sponsorship = useSponsorship()
  const [progress, setProgress] = useState<ExecutionProgress | null>(null)

  const execute = useCallback(
    async (calls: Call[]): Promise<{ receipts: TransactionReceipt[]; mode: ExecutionMode }> => {
      if (!calls.length) throw new Error('Nothing to execute')

      // Preferred path: one signature, all or nothing.
      try {
        setProgress({ mode: 'batch', current: 0, total: calls.length, label: 'Confirming' })
        const result = await sendCallsAsync({
          calls: calls.map(({ to, data, value }) => ({ to, data, value })),
          // Our own proxy, never the paymaster URL itself. The wallet fetches
          // sponsorship data through it and the user pays no gas.
          ...(sponsorship.available
            ? { capabilities: { paymasterService: { url: `${window.location.origin}/api/paymaster` } } }
            : {}),
        })
        const id = typeof result === 'string' ? result : result.id
        const status = await waitForCallsStatus(config, { id, timeout: 180_000 })
        if (status.status !== 'success') {
          throw new Error('The batch did not complete. Nothing was charged.')
        }
        return { receipts: (status.receipts ?? []) as TransactionReceipt[], mode: 'batch' }
      } catch (e) {
        // A refusal is a decision, not a capability gap - never retry it as six prompts.
        if (isUserRejection(e)) {
          setProgress(null)
          throw e
        }
        if (!cannotBatch(e)) {
          setProgress(null)
          throw e
        }
      }

      // Fallback: this wallet cannot batch, so walk the calls one at a time.
      const receipts: TransactionReceipt[] = []
      for (let i = 0; i < calls.length; i++) {
        const call = calls[i]
        setProgress({ mode: 'sequential', current: i, total: calls.length, label: call.label })
        try {
          const hash = await sendTransactionAsync({ to: call.to, data: call.data, value: call.value })
          receipts.push(await waitForTransactionReceipt(config, { hash }))
        } catch (e) {
          setProgress(null)
          if (i === 0) throw e
          throw new PartialExecutionError(
            isUserRejection(e)
              ? `You stopped at step ${i + 1} of ${calls.length}.`
              : `Step ${i + 1} of ${calls.length} failed: ${(e as Error).message}`,
            i,
            calls.length,
            call.label,
          )
        }
      }
      setProgress(null)
      return { receipts, mode: 'sequential' }
    },
    [config, sendCallsAsync, sendTransactionAsync, sponsorship.available],
  )

  return { execute, progress, sponsorship, reset: () => setProgress(null) }
}
