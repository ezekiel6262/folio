// Clones the real xStock mint accounts and mainnet's Token-2022 and Associated Token
// programs into tests/fixtures, so the vault is tested against exactly what it will
// hold in production — every issuer extension intact. No dependencies: plain JSON-RPC.
//
//   node solana/scripts/fetch-fixtures.mjs [rpc-url]
import { writeFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RPC = process.argv[2] || process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'programs', 'folio_vault', 'tests', 'fixtures')
const UPGRADEABLE = 'BPFLoaderUpgradeab1e11111111111111111111111'
const PROGRAMDATA_HEADER = 45 // tag u32 + slot u64 + option u8 + authority [u8; 32]

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
function base58(bytes) {
  let n = BigInt('0x' + (Buffer.from(bytes).toString('hex') || '0'))
  let s = ''
  while (n > 0n) { s = ALPHABET[Number(n % 58n)] + s; n /= 58n }
  for (const b of bytes) { if (b === 0) s = '1' + s; else break }
  return s
}
async function account(address) {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAccountInfo', params: [address, { encoding: 'base64' }] }) })
  const j = await r.json()
  if (!j.result || !j.result.value) throw new Error('no account ' + address + ' ' + JSON.stringify(j.error || ''))
  return { owner: j.result.value.owner, data: Buffer.from(j.result.value.data[0], 'base64') }
}
function save(name, data) {
  writeFileSync(join(OUT, name), data)
  console.log('  ' + name.padEnd(24) + String(data.length).padStart(9) + ' bytes  sha256 ' + createHash('sha256').update(data).digest('hex').slice(0, 16))
}

mkdirSync(OUT, { recursive: true })
console.log('cloning from ' + RPC.replace(/api-key=[^&]+/, 'api-key=…'))
for (const [name, mint] of [['aaplx', 'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp'], ['nvdax', 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh'], ['tslax', 'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB']]) {
  const a = await account(mint)
  save(name + '.mint.bin', a.data)
}
for (const [name, id] of [['token_2022.so', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'], ['associated_token.so', 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL']]) {
  const prog = await account(id)
  if (prog.owner === UPGRADEABLE) {
    // The program account only points at its ProgramData; the ELF lives there, after a header.
    const programData = await account(base58(prog.data.subarray(4, 36)))
    save(name, programData.data.subarray(PROGRAMDATA_HEADER))
  } else {
    save(name, prog.data)
  }
}
