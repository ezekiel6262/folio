/**
 * Sets up a Folio demo on a test cluster (devnet or a local validator), where the real
 * xStocks and PreStocks do not exist.
 *
 *   npm run demo -- status                 what exists so far
 *   npm run demo -- mints        [--send]  create stand-in stock and USDC mints
 *   npm run demo -- fund <addr>  [--send]  mint test tokens to a wallet
 *   npm run demo -- allow        [--send]  initialise the program and allow the demo mints
 *   npm run demo -- topup        [--send]  move test SOL to the fee payer
 *
 * The mints imitate the real ones: Token-2022, the same decimals, and a scaled-UI
 * multiplier so dividends and splits behave the way they do on mainnet. Their authority is
 * the deployer key, which stays on this machine. Written to web/lib/demo-assets.json.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js'
import assets from '../lib/solana-assets.json'

const root = resolve(__dirname, '../../..')
const envFile = resolve(root, '.env.solana')
if (existsSync(envFile)) process.loadEnvFile(envFile)

const CLUSTER = process.env.DEMO_CLUSTER ?? 'devnet'
const RPC =
  CLUSTER === 'localnet'
    ? 'http://127.0.0.1:8899'
    : process.env.HELIUS_API_KEY
      ? `https://devnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
      : 'https://api.devnet.solana.com'
const connection = new Connection(RPC, 'confirmed')

import { createHash } from 'node:crypto'

const PROGRAM_ID = new PublicKey(assets.programs.folioVault)
const FEE_PAYER = new PublicKey(assets.keys.feePayer)
const disc = (name: string) => createHash('sha256').update(`global:${name}`).digest().subarray(0, 8)
const configPda = PublicKey.findProgramAddressSync([Buffer.from('config')], PROGRAM_ID)[0]
const assetPda = (mint: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from('asset'), mint.toBuffer()], PROGRAM_ID)[0]
/** Generous on a test network: nothing here is worth anything. */
const DEMO_CAP_SHARES = 1_000

const TOKEN_2022 = new PublicKey(assets.programs.token2022)
const ATA_PROGRAM = new PublicKey(assets.programs.associatedToken)
// Public mint addresses only — this file ships with the app so the demo can read it.
const OUT = resolve(root, 'solana/web/lib/demo-assets.json')

/** A handful of companies is enough to show the product; the mainnet list stays the truth. */
const DEMO_STOCKS = ['AAPLx', 'NVDAx', 'SPYx', 'SPACEX'] as const
const DEMO_USDC = { symbol: 'USDC', decimals: 6 }
/** Everyone who tries the demo gets this much play money. */
const FUND_USDC = 500
const FUND_SHARES = 2

function deployer(): Keypair {
  const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(resolve(root, 'solana/.keys/deployer.json'), 'utf8'))))
  if (kp.publicKey.toBase58() !== assets.keys.deployer) throw new Error('deployer.json does not match the address book')
  return kp
}

type DemoAssets = {
  cluster: string
  createdAt: string
  usdc: string
  stocks: { symbol: string; display: string; mint: string; decimals: number; multiplier: number }[]
}

const load = (): DemoAssets | null => (existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : null)

// ---------------------------------------------------------------- Token-2022

const MINT_LEN_BASE = 82
/** Mint with the extensions Folio cares about: scaled UI amount (dividends and splits). */
const EXT_SCALED_UI = 43
const IX_INITIALIZE_MINT2 = 20
const IX_MINT_TO = 7
const IX_SCALED_UI_INIT = 43 // ScaledUiAmountExtension, sub-instruction 0

function scaledUiInitIx(mint: PublicKey, authority: PublicKey, multiplier: number) {
  const data = Buffer.alloc(1 + 1 + 32 + 8)
  data.writeUInt8(IX_SCALED_UI_INIT, 0)
  data.writeUInt8(0, 1) // Initialize
  authority.toBuffer().copy(data, 2)
  data.writeDoubleLE(multiplier, 34)
  return new TransactionInstruction({ programId: TOKEN_2022, keys: [{ pubkey: mint, isSigner: false, isWritable: true }], data })
}

function initializeMint2Ix(mint: PublicKey, decimals: number, authority: PublicKey) {
  const data = Buffer.alloc(1 + 1 + 32 + 1 + 32)
  data.writeUInt8(IX_INITIALIZE_MINT2, 0)
  data.writeUInt8(decimals, 1)
  authority.toBuffer().copy(data, 2)
  data.writeUInt8(1, 34) // freeze authority present, mirroring the real issuers
  authority.toBuffer().copy(data, 35)
  return new TransactionInstruction({ programId: TOKEN_2022, keys: [{ pubkey: mint, isSigner: false, isWritable: true }], data })
}

function mintToIx(mint: PublicKey, destination: PublicKey, authority: PublicKey, amount: bigint) {
  const data = Buffer.alloc(9)
  data.writeUInt8(IX_MINT_TO, 0)
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

const ata = (owner: PublicKey, mint: PublicKey) =>
  PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN_2022.toBuffer(), mint.toBuffer()], ATA_PROGRAM)[0]

function createAtaIdempotentIx(payer: PublicKey, owner: PublicKey, mint: PublicKey) {
  return new TransactionInstruction({
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
}

async function send(label: string, ixs: TransactionInstruction[], signers: Keypair[], live: boolean) {
  const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }), ...ixs)
  tx.feePayer = signers[0].publicKey
  tx.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash
  tx.sign(...signers)
  const sim = await connection.simulateTransaction(tx)
  if (sim.value.err) {
    console.log(`${label}: simulation failed ${JSON.stringify(sim.value.err)}`)
    console.log((sim.value.logs ?? []).slice(-8).join('\n'))
    process.exitCode = 1
    return false
  }
  if (!live) {
    console.log(`${label}: simulation OK. Re-run with --send to submit.`)
    return false
  }
  const sig = await connection.sendRawTransaction(tx.serialize())
  await connection.confirmTransaction(sig, 'confirmed')
  console.log(`${label}: ${sig}`)
  return true
}

// -------------------------------------------------------------------- commands

async function status() {
  const admin = deployer().publicKey
  const balance = await connection.getBalance(admin)
  console.log(`cluster    ${CLUSTER} (${RPC.replace(/api-key=.*/, 'api-key=…')})`)
  console.log(`deployer   ${admin.toBase58()}  ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`)
  const program = await connection.getAccountInfo(new PublicKey(assets.programs.folioVault))
  console.log(`program    ${assets.programs.folioVault}  ${program?.executable ? 'deployed' : 'not deployed'}`)
  const demo = load()
  if (!demo) return console.log('demo mints not created yet')
  console.log(`demo USDC  ${demo.usdc}`)
  for (const s of demo.stocks) console.log(`  ${s.symbol.padEnd(8)} ${s.mint}  multiplier ${s.multiplier}`)
}

async function mints(live: boolean) {
  const kp = deployer()
  if ((await connection.getBalance(kp.publicKey)) < 0.2 * LAMPORTS_PER_SOL) {
    throw new Error(`Fund ${kp.publicKey.toBase58()} on ${CLUSTER} first (faucet.solana.com)`)
  }
  const existing = load()
  if (existing && live) throw new Error(`${OUT} already exists; delete it to make new mints`)


  const out: DemoAssets = { cluster: CLUSTER, createdAt: new Date().toISOString(), usdc: '', stocks: [] }

  const make = async (label: string, decimals: number, multiplier: number | null) => {
    const mint = Keypair.generate()
    const rent = await connection.getMinimumBalanceForRentExemption(multiplier == null ? MINT_LEN_BASE : 226)
    // Token-2022 pads a mint to the length of a token account (165) before any extension,
    // then an account-type byte, a 4-byte TLV header and the 56-byte scaled-UI config
    // (authority, multiplier, the next multiplier and when it takes effect).
    const size = multiplier == null ? MINT_LEN_BASE : 165 + 1 + 4 + 56
    const ixs = [
      SystemProgram.createAccount({
        fromPubkey: kp.publicKey,
        newAccountPubkey: mint.publicKey,
        lamports: rent,
        space: size,
        programId: TOKEN_2022,
      }),
      ...(multiplier == null ? [] : [scaledUiInitIx(mint.publicKey, kp.publicKey, multiplier)]),
      initializeMint2Ix(mint.publicKey, decimals, kp.publicKey),
    ]
    const ok = await send(`mint ${label}`, ixs, [kp, mint], live)
    return ok ? mint.publicKey.toBase58() : ''
  }

  out.usdc = await make('USDC (demo)', DEMO_USDC.decimals, null)
  for (const symbol of DEMO_STOCKS) {
    const real = assets.stocks.find((s) => s.symbol === symbol)!
    // Apple carries its real dividend multiplier; SpaceX its 5x split.
    const multiplier = symbol === 'SPACEX' ? 5 : symbol === 'AAPLx' ? 1.0032690125398187 : 1
    const mint = await make(`${symbol} (demo)`, real.decimals, multiplier)
    out.stocks.push({ symbol, display: real.display, mint, decimals: real.decimals, multiplier })
  }

  if (live) {
    writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n')
    console.log(`\nwrote ${OUT}`)
  }
}

async function fund(target: string, live: boolean) {
  const demo = load()
  if (!demo) throw new Error('Run `mints --send` first')
  const kp = deployer()
  const owner = new PublicKey(target)
  const ixs: TransactionInstruction[] = []

  const usdc = new PublicKey(demo.usdc)
  ixs.push(createAtaIdempotentIx(kp.publicKey, owner, usdc))
  ixs.push(mintToIx(usdc, ata(owner, usdc), kp.publicKey, BigInt(FUND_USDC * 10 ** DEMO_USDC.decimals)))

  for (const s of demo.stocks.slice(0, 2)) {
    const mint = new PublicKey(s.mint)
    ixs.push(createAtaIdempotentIx(kp.publicKey, owner, mint))
    // Raw units, so what the holder sees is this times the multiplier.
    ixs.push(mintToIx(mint, ata(owner, mint), kp.publicKey, BigInt(Math.round((FUND_SHARES / s.multiplier) * 10 ** s.decimals))))
  }

  await send(`fund ${target.slice(0, 6)}… with ${FUND_USDC} demo USDC and ${FUND_SHARES} shares each of two companies`, ixs, [kp], live)
}

/** Same instructions as mainnet admin, pointed at the demo mints. */
async function allow(live: boolean) {
  const demo = load()
  if (!demo) throw new Error('Run `mints --send` first')
  const kp = deployer()
  const ixs: TransactionInstruction[] = []

  if (!(await connection.getAccountInfo(configPda))) {
    ixs.push(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: configPda, isSigner: false, isWritable: true },
          { pubkey: kp.publicKey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: disc('initialize'),
      }),
    )
  }

  for (const s of demo.stocks) {
    const mint = new PublicKey(s.mint)
    const cap = BigInt(Math.round((DEMO_CAP_SHARES / s.multiplier) * 10 ** s.decimals))
    const data = Buffer.alloc(17)
    disc('set_asset').copy(data, 0)
    data.writeUInt8(1, 8)
    data.writeBigUInt64LE(cap, 9)
    ixs.push(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: configPda, isSigner: false, isWritable: false },
          { pubkey: assetPda(mint), isSigner: false, isWritable: true },
          { pubkey: mint, isSigner: false, isWritable: false },
          { pubkey: kp.publicKey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data,
      }),
    )
  }
  await send(`initialise and allow ${demo.stocks.map((s) => s.symbol).join(', ')}`, ixs, [kp], live)
}

/** The fee payer sponsors every demo transaction, so it needs test SOL of its own. */
async function topup(live: boolean) {
  const kp = deployer()
  const have = await connection.getBalance(FEE_PAYER)
  if (have > 0.4 * LAMPORTS_PER_SOL) return console.log(`fee payer already has ${(have / LAMPORTS_PER_SOL).toFixed(3)} SOL`)
  await send(
    `top up the fee payer to about 0.5 test SOL`,
    [SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: FEE_PAYER, lamports: 0.5 * LAMPORTS_PER_SOL - have })],
    [kp],
    live,
  )
}

async function main() {
  const args = process.argv.slice(2)
  const live = args.includes('--send')
  const [cmd = 'status', arg] = args.filter((a) => !a.startsWith('--'))
  if (cmd === 'status') return status()
  if (cmd === 'mints') return mints(live)
  if (cmd === 'allow') return allow(live)
  if (cmd === 'topup') return topup(live)
  if (cmd === 'fund') {
    if (!arg) throw new Error('Give the wallet address to fund')
    return fund(arg, live)
  }
  console.log('usage: status | mints | allow | topup | fund <address>  [--send]')
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
