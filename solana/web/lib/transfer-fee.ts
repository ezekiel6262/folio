import 'server-only'
import { PublicKey, TransactionInstruction } from '@solana/web3.js'
import { connection } from './market'
import { TOKEN_2022 } from './folio-program'

/**
 * Token-2022 transfer fees, read live from the mint. PreStocks charge one on every
 * transfer (1% on 22 Sep 2026): on the way into a vault, on the way out, and when sold.
 * Two consequences the builders handle here:
 *   - an amount sent arrives smaller, so quotes must use what actually lands
 *   - the fee is withheld inside the receiving account, and Token-2022 refuses to close an
 *     account holding withheld fees until they are harvested to the mint (permissionless)
 */

type FeeTier = { epoch: number; basisPoints: number; maximumFee: bigint }
type FeeConfig = { older: FeeTier; newer: FeeTier } | null

const TTL_MS = 10 * 60_000
const cache = new Map<string, { at: number; value: FeeConfig }>()
let epochCache: { at: number; epoch: number } | null = null

async function currentEpoch() {
  if (epochCache && Date.now() - epochCache.at < 60_000) return epochCache.epoch
  const { epoch } = await connection.getEpochInfo('confirmed')
  epochCache = { at: Date.now(), epoch }
  return epoch
}

async function feeConfig(mint: string): Promise<FeeConfig> {
  const hit = cache.get(mint)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value
  const info = await connection.getParsedAccountInfo(new PublicKey(mint), 'confirmed')
  const data = info.value?.data
  const exts = data && 'parsed' in data ? ((data.parsed?.info?.extensions ?? []) as { extension: string; state: any }[]) : []
  const cfg = exts.find((e) => e.extension === 'transferFeeConfig')?.state
  const tier = (t: any): FeeTier => ({
    epoch: Number(t?.epoch ?? 0),
    basisPoints: Number(t?.transferFeeBasisPoints ?? 0),
    maximumFee: BigInt(String(t?.maximumFee ?? 0).split('.')[0].replace(/e\+?\d+$/i, '') || '0') || 2n ** 64n - 1n,
  })
  const value: FeeConfig = cfg ? { older: tier(cfg.olderTransferFee), newer: tier(cfg.newerTransferFee) } : null
  cache.set(mint, { at: Date.now(), value })
  return value
}

/** The fee tier in force now, in basis points; 0 for mints without the extension. */
export async function transferFeeBps(mint: string): Promise<number> {
  const cfg = await feeConfig(mint)
  if (!cfg) return 0
  const epoch = await currentEpoch()
  return (epoch >= cfg.newer.epoch ? cfg.newer : cfg.older).basisPoints
}

/** Exactly what Token-2022 withholds from a transfer of `amount` (ceil, capped). */
export async function transferFee(mint: string, amount: bigint): Promise<bigint> {
  const cfg = await feeConfig(mint)
  if (!cfg || amount === 0n) return 0n
  const epoch = await currentEpoch()
  const t = epoch >= cfg.newer.epoch ? cfg.newer : cfg.older
  if (!t.basisPoints) return 0n
  const fee = (amount * BigInt(t.basisPoints) + 9_999n) / 10_000n
  return fee > t.maximumFee ? t.maximumFee : fee
}

/** Moves withheld fees out of `sources` into the mint so those accounts can be closed. */
export function harvestWithheldIx(mint: PublicKey, sources: PublicKey[]) {
  return new TransactionInstruction({
    programId: TOKEN_2022,
    keys: [
      { pubkey: mint, isSigner: false, isWritable: true },
      ...sources.map((pubkey) => ({ pubkey, isSigner: false, isWritable: true })),
    ],
    // TransferFeeExtension (26) / HarvestWithheldTokensToMint (4)
    data: Buffer.from([26, 4]),
  })
}
