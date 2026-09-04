import 'server-only'
import { parseAbiItem, type Address } from 'viem'
import { publicClient, getStockPrices } from './prices'
import { folioVaultAbi } from './vault-abi'
import { VAULT_ADDRESS, VAULT_DEPLOY_BLOCK } from './deployment'
import { STOCK_BY_ADDRESS, CURRENCIES, toShares } from './assets'

const TRANSFER = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)')

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
 * The vault is a plain ERC-721, so there is no enumeration onchain. Scanning Transfer
 * logs from the deployment block is cheap because the contract is young, and it means
 * no indexer sits between the user and their own assets.
 */
export async function listFolioIdsFor(owner: Address): Promise<bigint[]> {
  if (!VAULT_ADDRESS) return []

  const latest = await publicClient.getBlockNumber()
  const CHUNK = 40_000n
  const ids = new Set<bigint>()

  for (let from = VAULT_DEPLOY_BLOCK; from <= latest; from += CHUNK) {
    const to = from + CHUNK - 1n > latest ? latest : from + CHUNK - 1n
    const logs = await publicClient.getLogs({
      address: VAULT_ADDRESS,
      event: TRANSFER,
      args: { to: owner },
      fromBlock: from,
      toBlock: to,
    })
    for (const log of logs) if (log.args.tokenId !== undefined) ids.add(log.args.tokenId)
  }
  if (!ids.size) return []

  // A folio may have been transferred on again; confirm current ownership.
  const list = [...ids]
  const owners = await publicClient.multicall({
    contracts: list.map((id) => ({
      address: VAULT_ADDRESS,
      abi: folioVaultAbi,
      functionName: 'ownerOf' as const,
      args: [id] as const,
    })),
    allowFailure: true,
  })

  return list.filter(
    (_, i) =>
      owners[i].status === 'success' &&
      (owners[i].result as Address).toLowerCase() === owner.toLowerCase(),
  )
}
