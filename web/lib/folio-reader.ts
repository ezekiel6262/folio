import 'server-only'
import type { Address } from 'viem'
import { publicClient, getStockPrices } from './prices'
import { folioVaultAbi } from './vault-abi'
import { VAULT_ADDRESS } from './deployment'
import { STOCK_BY_ADDRESS, CURRENCIES, toShares } from './assets'

export type HoldingView = {
  symbol: string
  display: string
  address: Address
  rawAmount: string
  shares: number
  priceUsd: number
  valueUsd: number
  /** Share of the folio by value, 0-100. */
  weightPct: number
  isStock: boolean
}

export type FolioView = {
  id: string
  name: string
  owner: Address
  creator: Address
  escrowed: boolean
  createdAt: number
  unlockAt: number
  reclaimAfter: number
  locked: boolean
  policyHash: string
  holdings: HoldingView[]
  totalUsd: number
}

const CURRENCY_BY_ADDRESS = new Map(CURRENCIES.map((c) => [c.address.toLowerCase(), c]))

export async function readFolio(id: bigint): Promise<FolioView | null> {
  if (!VAULT_ADDRESS) return null

  const [folioRes, holdingsRes] = await publicClient.multicall({
    contracts: [
      { address: VAULT_ADDRESS, abi: folioVaultAbi, functionName: 'getFolio', args: [id] },
      { address: VAULT_ADDRESS, abi: folioVaultAbi, functionName: 'getHoldings', args: [id] },
    ],
    allowFailure: true,
  })
  if (folioRes.status !== 'success' || holdingsRes.status !== 'success') return null

  const [folio, owner, escrowed] = folioRes.result as unknown as [
    {
      creator: Address
      createdAt: bigint
      unlockAt: bigint
      reclaimAfter: bigint
      claimHash: string
      policyHash: string
      name: string
    },
    Address,
    boolean,
  ]
  const [tokens, amounts] = holdingsRes.result as unknown as [Address[], bigint[]]

  const prices = await getStockPrices()
  const priceBySymbol = new Map(prices.map((p) => [p.symbol, p]))

  const holdings: HoldingView[] = tokens.map((token, i) => {
    const stock = STOCK_BY_ADDRESS.get(token.toLowerCase())
    const raw = amounts[i]

    if (stock) {
      const p = priceBySymbol.get(stock.symbol)
      const multiplier = p ? BigInt(p.multiplierWad) : 10n ** 18n
      const shares = toShares(raw, stock.decimals, multiplier)
      const priceUsd = p?.usd ?? 0
      return {
        symbol: stock.symbol,
        display: stock.display,
        address: token,
        rawAmount: raw.toString(),
        shares,
        priceUsd,
        valueUsd: shares * priceUsd,
        weightPct: 0,
        isStock: true,
      }
    }

    // A stablecoin sleeve: valued at par, which is the honest approximation here.
    const cur = CURRENCY_BY_ADDRESS.get(token.toLowerCase())
    const units = Number(raw) / 10 ** (cur?.decimals ?? 18)
    return {
      symbol: cur?.token ?? 'UNKNOWN',
      display: cur?.token ?? 'Unknown asset',
      address: token,
      rawAmount: raw.toString(),
      shares: units,
      priceUsd: cur?.code === 'USD' ? 1 : 0,
      valueUsd: cur?.code === 'USD' ? units : 0,
      weightPct: 0,
      isStock: false,
    }
  })

  const totalUsd = holdings.reduce((a, b) => a + b.valueUsd, 0)
  for (const h of holdings) h.weightPct = totalUsd > 0 ? (h.valueUsd / totalUsd) * 100 : 0
  holdings.sort((a, b) => b.valueUsd - a.valueUsd)

  const unlockAt = Number(folio.unlockAt)
  return {
    id: id.toString(),
    name: folio.name,
    owner,
    creator: folio.creator,
    escrowed,
    createdAt: Number(folio.createdAt),
    unlockAt,
    reclaimAfter: Number(folio.reclaimAfter),
    locked: unlockAt > Math.floor(Date.now() / 1000),
    policyHash: folio.policyHash,
    holdings,
    totalUsd,
  }
}

/**
 * The vault is a plain ERC-721, so there is no enumeration onchain.
 *
 * The obvious approach — scanning Transfer logs from the deployment block — does not
 * survive contact with a public RPC: Base's public endpoint caps `eth_getLogs` at a
 * 2,000 block range, and the span since deployment passed 150,000 blocks within days.
 * That is 78 requests and climbing, every time someone opens the home screen.
 *
 * Folio ids are sequential from 1, so reading `nextFolioId` and asking who owns each one
 * is both cheaper and constant with chain age: one multicall, no block ranges, no
 * indexer between a user and their own assets.
 */
const MAX_SCAN = 2_000

export async function listFolioIdsFor(owner: Address): Promise<bigint[]> {
  if (!VAULT_ADDRESS) return []

  const next = (await publicClient.readContract({
    address: VAULT_ADDRESS,
    abi: folioVaultAbi,
    functionName: 'nextFolioId',
  })) as bigint

  const minted = Number(next) - 1
  if (minted <= 0) return []

  // Beyond this the right answer is an indexer, not a bigger multicall.
  const start = Math.max(1, minted - MAX_SCAN + 1)
  const ids = Array.from({ length: minted - start + 1 }, (_, i) => BigInt(start + i))

  const mine: bigint[] = []
  const CHUNK = 200
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK)
    const owners = await publicClient.multicall({
      contracts: slice.map((id) => ({
        address: VAULT_ADDRESS,
        abi: folioVaultAbi,
        functionName: 'ownerOf' as const,
        args: [id] as const,
      })),
      allowFailure: true,
    })
    slice.forEach((id, j) => {
      const r = owners[j]
      if (r.status === 'success' && (r.result as Address).toLowerCase() === owner.toLowerCase()) {
        mine.push(id)
      }
    })
  }

  // Newest first: the home screen sorts by creation date anyway, but this keeps the
  // truncation above meaningful if the cap is ever hit.
  return mine.reverse()
}
