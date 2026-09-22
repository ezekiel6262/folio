'use client'

import { Keypair, VersionedTransaction } from '@solana/web3.js'

/**
 * The browser's whole job in any action: sign its own slot, hand the transaction to the
 * co-signer, and wait for the one answer that matters — landed or not. Transactions are
 * always built on the server; nothing here decides what a transaction does.
 */

export const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
export const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

/** base64url, so a claim key can ride in a URL fragment untouched. */
export const toBase64Url = (bytes: Uint8Array) => toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
export const fromBase64Url = (s: string) =>
  fromBase64(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4))

export type Progress = { step: number; total: number; stage: 'signing' | 'confirming' }

/** Carries how far a multi-transaction action got, so the UI can say exactly that. */
export class SubmitError extends Error {
  completed: number
  total: number
  constructor(message: string, completed: number, total: number) {
    super(message)
    this.name = 'SubmitError'
    this.completed = completed
    this.total = total
  }
}

export async function signAndSubmit(
  transactions: string[],
  sign: (tx: Uint8Array) => Promise<Uint8Array>,
  opts: { extraSigners?: Keypair[]; onProgress?: (p: Progress) => void; accessToken?: () => Promise<string | null> } = {},
): Promise<string[]> {
  const signatures: string[] = []
  for (let i = 0; i < transactions.length; i++) {
    opts.onProgress?.({ step: i + 1, total: transactions.length, stage: 'signing' })
    let bytes = await sign(fromBase64(transactions[i]))

    // Extra signers (a claim link's key) sign after the wallet, so nothing depends on
    // the wallet preserving a signature it did not make.
    if (opts.extraSigners?.length) {
      const tx = VersionedTransaction.deserialize(bytes)
      tx.sign(opts.extraSigners)
      bytes = tx.serialize()
    }

    opts.onProgress?.({ step: i + 1, total: transactions.length, stage: 'confirming' })
    const token = await opts.accessToken?.()
    const res = await fetch('/api/cosign', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ transaction: toBase64(bytes) }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new SubmitError(json.error ?? 'The network did not accept it.', i, transactions.length)
    if (!json.confirmed) throw new SubmitError(json.error ?? 'It was sent but has not confirmed yet.', i, transactions.length)
    signatures.push(json.signature)
  }
  return signatures
}

export function isUserRejection(error: unknown) {
  return /rejected|denied|cancell?ed|closed/i.test((error as Error)?.message ?? '')
}
