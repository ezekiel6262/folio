// Deploys FolioVault and configures the asset allowlist from the verified address book.
//
//   DEPLOYER_PRIVATE_KEY=0x... npx hardhat run scripts/deploy.js --network base
//
// Caps are deliberately conservative. This code is unaudited, so the contract is
// configured to hold a demonstrable amount of value, not an unbounded one.
const hre = require('hardhat')
const fs = require('fs')
const path = require('path')
const { parseUnits, formatEther } = require('viem')

const ASSETS = require('../../shared/base-assets.json')

// Max units of a single asset one Folio may hold. Roughly $150-200 per stock name.
const STOCK_CAP = process.env.STOCK_CAP_SHARES || '0.5'
const STABLE_CAP = process.env.STABLE_CAP || '500'

/**
 * Public RPCs are a pool of nodes and they do not all see a new deployment at the same
 * instant. Estimating a call against a node that has not caught up prices it as a call
 * to an empty address - about 34k gas - and the transaction then dies out of gas with
 * the allowlist unset. Block until the code is actually visible.
 */
async function waitForCode(pub, address, tries = 30) {
  for (let i = 0; i < tries; i++) {
    const code = await pub.getBytecode({ address })
    if (code && code !== '0x') return true
    await new Promise((r) => setTimeout(r, 2000))
  }
  throw new Error(`No bytecode visible at ${address} after ${tries * 2}s`)
}

/** waitForTransactionReceipt resolves for reverted transactions too. Check the status. */
async function send(pub, label, promise) {
  const hash = await promise
  const receipt = await pub.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') {
    throw new Error(
      `${label} REVERTED (${hash}). gasUsed ${receipt.gasUsed} of limit — if those are equal it ran out of gas.`,
    )
  }
  console.log(`  ok ${hash}  (gas ${receipt.gasUsed})`)
  return receipt
}

async function main() {
  const [wallet] = await hre.viem.getWalletClients()
  const pub = await hre.viem.getPublicClient()
  const chainId = await pub.getChainId()
  const deployer = wallet.account.address
  const balance = await pub.getBalance({ address: deployer })

  console.log(`network   ${hre.network.name} (chainId ${chainId})`)
  console.log(`deployer  ${deployer}`)
  console.log(`balance   ${formatEther(balance)} ETH`)
  if (balance === 0n) throw new Error('Deployer has no ETH on this network.')
  if (chainId !== ASSETS.chainId && hre.network.name === 'base') {
    throw new Error(`Address book is for chain ${ASSETS.chainId}, connected to ${chainId}`)
  }

  // Set FOLIO_VAULT to configure an already-deployed vault instead of deploying a new
  // one. Useful for repairing a partial run without abandoning a live contract.
  const existing = process.env.FOLIO_VAULT
  let vault
  if (existing) {
    vault = await hre.viem.getContractAt('FolioVault', existing)
    console.log(`\nUsing existing FolioVault -> ${vault.address}`)
  } else {
    vault = await hre.viem.deployContract('FolioVault', [deployer])
    console.log(`\nFolioVault deployed -> ${vault.address}`)
  }

  await waitForCode(pub, vault.address)
  console.log('  bytecode confirmed visible')

  // Allowlist: the ten Coinbase names, plus the tradeable stablecoins as a cash sleeve.
  const stockAddrs = ASSETS.stocks.map((s) => s.address)
  const stockCaps = ASSETS.stocks.map((s) => parseUnits(STOCK_CAP, s.decimals))
  console.log(`\nAllowlisting ${stockAddrs.length} stocks, cap ${STOCK_CAP} shares each...`)
  await send(pub, 'stock allowlist', vault.write.setAssets([stockAddrs, true, stockCaps]))

  const stables = ASSETS.currencies.filter((c) => c.tradeable)
  const stableAddrs = stables.map((c) => c.address)
  const stableCaps = stables.map((c) => parseUnits(STABLE_CAP, c.decimals))
  console.log(`\nAllowlisting ${stableAddrs.length} stablecoins, cap ${STABLE_CAP} each...`)
  await send(pub, 'stablecoin allowlist', vault.write.setAssets([stableAddrs, true, stableCaps]))

  // Read the config back so the recorded deployment reflects chain state, not intent.
  // Retry: a just-mined write is not instantly visible on every node in a public RPC
  // pool, and a stale read here would look identical to a genuinely failed allowlist.
  let verified = []
  for (let attempt = 1; attempt <= 6; attempt++) {
    verified = []
    for (const s of ASSETS.stocks) {
      const cfg = await vault.read.assetConfig([s.address])
      verified.push({ symbol: s.symbol, address: s.address, allowed: cfg[0], cap: cfg[1].toString() })
    }
    const bad = verified.filter((v) => !v.allowed)
    if (!bad.length) break
    if (attempt === 6) {
      throw new Error(`Allowlist did not stick for: ${bad.map((b) => b.symbol).join(', ')}`)
    }
    console.log(`  ${bad.length} not visible yet (${bad.map((b) => b.symbol).join(', ')}), re-reading...`)
    await new Promise((r) => setTimeout(r, 3000))
  }

  // Recorded so the web app can scan Transfer logs from here instead of from genesis.
  // When repairing an existing vault, "now" would be after folios already existed, so
  // the real deployment block must be supplied.
  const deployedBlock = process.env.FOLIO_VAULT_BLOCK
    ? BigInt(process.env.FOLIO_VAULT_BLOCK)
    : await pub.getBlockNumber()

  const out = {
    chainId,
    network: hre.network.name,
    folioVault: vault.address,
    deployedBlock: deployedBlock.toString(),
    deployer,
    deployedAt: new Date().toISOString(),
    stockCapShares: STOCK_CAP,
    stableCap: STABLE_CAP,
    assets: verified,
  }
  const file = path.join(__dirname, '..', '..', 'shared', `deployment.${hre.network.name}.json`)
  fs.writeFileSync(file, JSON.stringify(out, null, 2))
  console.log(`\nAll ${verified.length} stocks allowlisted and verified onchain.`)
  console.log(`Wrote ${file}`)
  console.log(`\nVerify:  npx hardhat verify --network ${hre.network.name} ${vault.address} ${deployer}`)
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
