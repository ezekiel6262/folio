import { NextResponse } from 'next/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js'
import { PROGRAMS } from '@/lib/assets'
import { demoAssets, isDemo } from '@/lib/demo'
import { connection } from '@/lib/market'

export const dynamic = 'force-dynamic'

/**
 * Hands a demo wallet its test shares, so trying Folio on a test cluster takes one tap
 * instead of a command. It mints stand-in tokens with the demo mint authority, which only
 * exists on this machine — on mainnet this route refuses, and the key is never deployed.
 */

const TOKEN_2022 = new PublicKey(PROGRAMS.token2022)
const ATA_PROGRAM = new PublicKey(PROGRAMS.associatedToken)
const SHARES_EACH = 2
const USDC_EACH = 500

const ata = (owner: PublicKey, mint: PublicKey) =>
  PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN_2022.toBuffer(), mint.toBuffer()], ATA_PROGRAM)[0]

const createAtaIdempotentIx = (payer: PublicKey, owner: PublicKey, mint: PublicKey) =>
  new TransactionInstruction({
    programId: ATA_PROGRAM,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata(owner, mint), isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  })

function mintToIx(mint: PublicKey, destination: PublicKey, authority: PublicKey, amount: bigint) {
  const data = Buffer.alloc(9)
  data.writeUInt8(7, 0) // MintTo
  data.writeBigUInt64LE(amount, 1)
  return new TransactionInstruction({
    programId: TOKEN_2022,
    keys: [
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data,
  })
}

/**
 * The faucet key is a throwaway that can only mint worthless test tokens; the deployer key,
 * which also controls program upgrades, never goes near a server.
 */
function minter(): Keypair {
  const secret = process.env.FOLIO_DEMO_MINTER_SECRET
  const json = secret ?? readFileSync(join(process.cwd(), '..', '.keys', 'demo-minter.json'), 'utf8')
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(json)))
}

export async function POST(req: Request) {
  if (!isDemo()) return NextResponse.json({ error: 'Test shares only exist on the demo cluster' }, { status: 400 })
  const demo = demoAssets()!
  try {
    const owner = new PublicKey(String((await req.json())?.owner))
    const authority = minter()

    const ixs: TransactionInstruction[] = [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 })]
    const usdc = new PublicKey(demo.usdc)
    ixs.push(createAtaIdempotentIx(authority.publicKey, owner, usdc))
    ixs.push(mintToIx(usdc, ata(owner, usdc), authority.publicKey, BigInt(USDC_EACH * 1e6)))
    for (const s of demo.stocks.slice(0, 3)) {
      const mint = new PublicKey(s.mint)
      ixs.push(createAtaIdempotentIx(authority.publicKey, owner, mint))
      ixs.push(mintToIx(mint, ata(owner, mint), authority.publicKey, BigInt(Math.round((SHARES_EACH / s.multiplier) * 10 ** s.decimals))))
    }

    const tx = new Transaction().add(...ixs)
    tx.feePayer = authority.publicKey
    tx.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash
    tx.sign(authority)
    const signature = await connection.sendRawTransaction(tx.serialize())
    await connection.confirmTransaction(signature, 'confirmed')
    return NextResponse.json({ signature, shares: SHARES_EACH, usdc: USDC_EACH })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}
