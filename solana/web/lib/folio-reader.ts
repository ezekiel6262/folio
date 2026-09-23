import 'server-only'
import { PublicKey } from '@solana/web3.js'
import { STOCK_BY_MINT, STOCK_BY_SYMBOL, toShares } from './assets'
import { demoSymbolForMint } from './demo'
import { connection, getMarket } from './market'
import { ata, decodeFolio, FOLIO_ACCOUNT_SIZE, PROGRAM_ID, TOKEN_2022, type FolioAccount } from './folio-program'

/**
 * Reads folios straight from the chain. There is no indexer between a user and their
 * own assets: folios are found by a size filter (a Folio account is exactly 503 bytes)
 * plus a byte match on the owner or creator field, and holdings are the vaults' real
 * balances — not a stored running total, which the issuer's permanent delegate could
 * make drift.
 */

export type Holding = {
  symbol: string
  display: string
  mint: string
  vault: string
  rawAmount: string
  shares: number
  shareUsd: number
  /** Percent of this holding that came from reinvested dividends or a split. */
  growthPct: number
  valueUsd: number
  weightPct: number
}

export type FolioView = FolioAccount & {
  locked: boolean
  holdings: Holding[]
  totalUsd: number
}

const OWNER_OFFSET = 8
const CREATOR_OFFSET = 40

async function findFolios(offset: number, key: PublicKey) {
  const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
    filters: [{ dataSize: FOLIO_ACCOUNT_SIZE }, { memcmp: { offset, bytes: key.toBase58() } }],
  })
  return accounts
    .map((a) => decodeFolio(a.pubkey, a.account.data))
    .filter((f): f is FolioAccount => f !== null)
}

async function withHoldings(folios: FolioAccount[]): Promise<FolioView[]> {
  if (!folios.length) return []
  const market = await getMarket()
  const vaults = folios.flatMap((f) => f.assets.map((mint) => ({ folio: f.address, mint, vault: ata(new PublicKey(f.address), new PublicKey(mint), TOKEN_2022) })))
  const infos = vaults.length ? await connection.getMultipleParsedAccounts(vaults.map((v) => v.vault)) : { value: [] }
  const now = Math.floor(Date.now() / 1000)

  return folios
    .map((f) => {
      const holdings: Holding[] = vaults
        .map((v, i) => ({ v, info: infos.value[i] }))
        .filter(({ v }) => v.folio === f.address)
        .map(({ v, info }) => {
          const demoSymbol = demoSymbolForMint(v.mint)
          const s = STOCK_BY_MINT.get(v.mint) ?? (demoSymbol ? STOCK_BY_SYMBOL.get(demoSymbol) : undefined)
          const m = s ? market.stocks[s.symbol] : undefined
          const data = info?.data
          const raw: string = data && 'parsed' in data ? (data.parsed?.info?.tokenAmount?.amount ?? '0') : '0'
          const shares = s && m ? toShares(raw, s.decimals, m.multiplier) : 0
          const shareUsd = m?.shareUsd ?? 0
          return {
            symbol: s?.symbol ?? 'UNKNOWN',
            display: s?.display ?? 'Unknown asset',
            mint: v.mint,
            vault: v.vault.toBase58(),
            rawAmount: raw,
            shares,
            shareUsd,
            growthPct: m?.growthPct ?? 0,
            valueUsd: shares * shareUsd,
            weightPct: 0,
          }
        })
      const totalUsd = holdings.reduce((a, h) => a + h.valueUsd, 0)
      for (const h of holdings) h.weightPct = totalUsd > 0 ? (h.valueUsd / totalUsd) * 100 : 0
      holdings.sort((a, b) => b.valueUsd - a.valueUsd)
      return { ...f, locked: f.unlockAt > now, holdings, totalUsd }
    })
    .sort((a, b) => b.createdAt - a.createdAt)
}

/** Folios this address owns. */
export async function foliosOwnedBy(owner: string) {
  return withHoldings(await findFolios(OWNER_OFFSET, new PublicKey(owner)))
}

/** Gifts this address made that are still waiting to be claimed. */
export async function giftsWaitingFrom(creator: string) {
  const made = await findFolios(CREATOR_OFFSET, new PublicKey(creator))
  return withHoldings(made.filter((f) => f.escrowed))
}

export async function readFolio(address: string): Promise<FolioView | null> {
  const key = new PublicKey(address)
  const info = await connection.getAccountInfo(key)
  if (!info || !info.owner.equals(PROGRAM_ID)) return null
  const folio = decodeFolio(key, info.data)
  if (!folio) return null
  const [view] = await withHoldings([folio])
  return view ?? null
}
