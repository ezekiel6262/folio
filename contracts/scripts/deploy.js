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

  const vault = await hre.viem.deployContract('FolioVault', [deployer])
  console.log(`\nFolioVault deployed -> ${vault.address}`)

  // Allowlist: the ten Coinbase names, plus the tradeable stablecoins as a cash sleeve.
  const stockAddrs = ASSETS.stocks.map((s) => s.address)
  const stockCaps = ASSETS.stocks.map((s) => parseUnits(STOCK_CAP, s.decimals))
  console.log(`\nAllowlisting ${stockAddrs.length} stocks, cap ${STOCK_CAP} shares each...`)
  let tx = await vault.write.setAssets([stockAddrs, true, stockCaps])
  await pub.waitForTransactionReceipt({ hash: tx })
  console.log(`  ok ${tx}`)

  const stables = ASSETS.currencies.filter((c) => c.tradeable)
  const stableAddrs = stables.map((c) => c.address)
  const stableCaps = stables.map((c) => parseUnits(STABLE_CAP, c.decimals))
  console.log(`\nAllowlisting ${stableAddrs.length} stablecoins, cap ${STABLE_CAP} each...`)
  tx = await vault.write.setAssets([stableAddrs, true, stableCaps])
  await pub.waitForTransactionReceipt({ hash: tx })
  console.log(`  ok ${tx}`)

  // Read the config back so the recorded deployment reflects chain state, not intent.
  const verified = []
  for (const s of ASSETS.stocks) {
    const cfg = await vault.read.assetConfig([s.address])
    verified.push({ symbol: s.symbol, address: s.address, allowed: cfg[0], cap: cfg[1].toString() })
  }
  const bad = verified.filter((v) => !v.allowed)
  if (bad.length) throw new Error(`Allowlist did not stick for: ${bad.map((b) => b.symbol).join(', ')}`)

  // Recorded so the web app can scan Transfer logs from here instead of from genesis.
  const deployedBlock = await pub.getBlockNumber()

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
