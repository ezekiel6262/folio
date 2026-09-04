'use client'

import { useCallback, useState } from 'react'
import { useConfig, useSendTransaction } from 'wagmi'
import { useSendCalls } from 'wagmi/experimental'
import { waitForTransactionReceipt } from '@wagmi/core'
import { waitForCallsStatus } from '@wagmi/core/experimental'
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

export function useExecutor() {
  const config = useConfig()
  const { sendCallsAsync } = useSendCalls()
  const { sendTransactionAsync } = useSendTransaction()
  const [progress, setProgress] = useState<ExecutionProgress | null>(null)

  const execute = useCallback(
    async (calls: Call[]): Promise<{ receipts: TransactionReceipt[]; mode: ExecutionMode }> => {
      if (!calls.length) throw new Error('Nothing to execute')

      // Preferred path: one signature, all or nothing.
      try {
        setProgress({ mode: 'batch', current: 0, total: calls.length, label: 'Confirming' })
        const result = await sendCallsAsync({
          calls: calls.map(({ to, data, value }) => ({ to, data, value })),
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
    [config, sendCallsAsync, sendTransactionAsync],
  )

  return { execute, progress, reset: () => setProgress(null) }
}
