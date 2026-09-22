/**
 * Mainnet admin for the Folio vault program. Read-only unless --send is passed.
 *
 *   npm run admin -- status
 *   npm run admin -- init          [--send]   create the config (admin = hard-coded deployer)
 *   npm run admin -- assets        [--send]   allow the 8 stocks with the cap from solana-assets.json
 *   npm run admin -- pause|unpause [--send]
 *
 * Signs with solana/.keys/deployer.json, which never leaves this machine. RPC comes from
 * HELIUS_API_KEY or SOLANA_RPC_URL in the repo-root .env.solana.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'
import assets from '../lib/solana-assets.json'

const root = resolve(__dirname, '../../..')
const envFile = resolve(root, '.env.solana')
if (existsSync(envFile)) process.loadEnvFile(envFile)

const RPC = process.env.HELIUS_API_KEY
  ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
  : process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'
const connection = new Connection(RPC, 'confirmed')

const PROGRAM_ID = new PublicKey(assets.programs.folioVault)
const FEE_PAYER = new PublicKey(assets.keys.feePayer)
const CAP_RAW = BigInt(Math.round(assets.vault.stockCapShares * 1e8))

const disc = (name: string) => createHash('sha256').update(`global:${name}`).digest().subarray(0, 8)
const configPda = PublicKey.findProgramAddressSync([Buffer.from('config')], PROGRAM_ID)[0]
const assetPda = (mint: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from('asset'), mint.toBuffer()], PROGRAM_ID)[0]

function deployer(): Keypair {
  const path = resolve(root, 'solana/.keys/deployer.json')
  const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8'))))
  if (kp.publicKey.toBase58() !== assets.keys.deployer) throw new Error('deployer.json does not match the address book')
  return kp
}

const sol = (lamports: number) => `${(lamports / LAMPORTS_PER_SOL).toFixed(4)} SOL`

async function status() {
  const admin = new PublicKey(assets.keys.deployer)
  const [program, config, adminBal, feeBal] = await Promise.all([
    connection.getAccountInfo(PROGRAM_ID),
    connection.getAccountInfo(configPda),
    connection.getBalance(admin),
    connection.getBalance(FEE_PAYER),
  ])
  console.log(`RPC            ${RPC.replace(/api-key=.*/, 'api-key=…')}`)
  console.log(`program        ${PROGRAM_ID.toBase58()}  ${program?.executable ? 'DEPLOYED' : 'not deployed'}`)
  console.log(`deployer       ${admin.toBase58()}  ${sol(adminBal)}`)
  console.log(`fee payer      ${FEE_PAYER.toBase58()}  ${sol(feeBal)}`)
  if (!config) {
    console.log('config         not initialised')
  } else {
    const d = config.data
    console.log(`config         admin ${new PublicKey(d.subarray(8, 40)).toBase58()}  paused ${d[40] === 1}`)
  }
  const stocks = assets.stocks.map((s) => ({ s, pda: assetPda(new PublicKey(s.mint)) }))
  const infos = await connection.getMultipleAccountsInfo(stocks.map((x) => x.pda))
  stocks.forEach(({ s }, i) => {
    const d = infos[i]?.data
    const line = d ? `allowed ${d[40] === 1}  cap ${Number(d.readBigUInt64LE(41)) / 1e8} shares` : 'not configured'
    console.log(`  ${s.symbol.padEnd(7)} ${line}`)
  })
}

function initializeIx(admin: PublicKey) {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: admin, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: disc('initialize'),
  })
}

function setAssetIx(admin: PublicKey, mint: PublicKey, allowed: boolean, cap: bigint) {
  const data = Buffer.alloc(8 + 1 + 8)
  disc('set_asset').copy(data, 0)
  data[8] = allowed ? 1 : 0
  data.writeBigUInt64LE(cap, 9)
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: configPda, isSigner: false, isWritable: false },
      { pubkey: assetPda(mint), isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: admin, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  })
}

function setPausedIx(admin: PublicKey, paused: boolean) {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: admin, isSigner: true, isWritable: false },
    ],
    data: Buffer.concat([disc('set_paused'), Buffer.from([paused ? 1 : 0])]),
  })
}

async function run(label: string, ixs: TransactionInstruction[], send: boolean) {
  const kp = deployer()
  const { blockhash } = await connection.getLatestBlockhash('confirmed')
  const message = new TransactionMessage({
    payerKey: kp.publicKey,
    recentBlockhash: blockhash,
    instructions: [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }), ...ixs],
  }).compileToV0Message()
  const tx = new VersionedTransaction(message)
  tx.sign([kp])
  const sim = await connection.simulateTransaction(tx, { sigVerify: true })
  if (sim.value.err) {
    console.log(`${label}: simulation failed ${JSON.stringify(sim.value.err)}`)
    console.log((sim.value.logs ?? []).slice(-10).join('\n'))
    process.exitCode = 1
    return
  }
  if (!send) {
    console.log(`${label}: simulation OK (${sim.value.unitsConsumed} CU). Re-run with --send to submit.`)
    return
  }
  const sig = await connection.sendRawTransaction(tx.serialize())
  await connection.confirmTransaction(sig, 'confirmed')
  console.log(`${label}: confirmed ${sig}`)
}

async function main() {
  const [cmd = 'status'] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  const send = process.argv.includes('--send')
  const admin = new PublicKey(assets.keys.deployer)

  if (cmd === 'status') return status()
  if (cmd === 'init') return run('initialize', [initializeIx(admin)], send)
  if (cmd === 'pause' || cmd === 'unpause') return run(cmd, [setPausedIx(admin, cmd === 'pause')], send)
  if (cmd === 'assets') {
    // Four per transaction keeps each well inside the size and compute limits.
    for (let i = 0; i < assets.stocks.length; i += 4) {
      const batch = assets.stocks.slice(i, i + 4)
      await run(
        `set_asset ${batch.map((s) => s.symbol).join(', ')} (cap ${assets.vault.stockCapShares} shares)`,
        batch.map((s) => setAssetIx(admin, new PublicKey(s.mint), true, CAP_RAW)),
        send,
      )
    }
    return
  }
  console.log('usage: status | init | assets | pause | unpause  [--send]')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
