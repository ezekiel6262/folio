const { expect } = require('chai')
const hre = require('hardhat')
const { time } = require('@nomicfoundation/hardhat-network-helpers')
const { keccak256, encodePacked, parseUnits, maxUint256, zeroAddress, getAddress } = require('viem')

const DAY = 24 * 60 * 60
const SECRET = keccak256(encodePacked(['string'], ['open-sesame']))
const CLAIM_HASH = keccak256(encodePacked(['bytes32'], [SECRET]))
const POLICY = keccak256(encodePacked(['string'], ['60-nvda-40-aapl']))

// 8 decimals, like the real B20 assets.
const shares = (n) => parseUnits(String(n), 8)

// viem nests the decoded custom error several causes deep, and Hardhat surfaces it on
// `details` rather than `message`, so flatten the whole chain before matching.
function flattenError(e) {
  const parts = []
  let cur = e
  for (let i = 0; cur && i < 10; i++) {
    for (const key of ['shortMessage', 'message', 'details']) {
      if (typeof cur[key] === 'string') parts.push(cur[key])
    }
    cur = cur.cause
  }
  return parts.join(' | ')
}

async function expectRevert(promise, errorName) {
  try {
    await promise
  } catch (e) {
    const text = flattenError(e)
    expect(text, `expected "${errorName}", got: ${text.slice(0, 300)}`).to.include(errorName)
    return
  }
  expect.fail(`expected revert "${errorName}" but the call succeeded`)
}

async function deploy() {
  const [owner, alice, bob, carol] = await hre.viem.getWalletClients()
  const pub = await hre.viem.getPublicClient()

  const aapl = await hre.viem.deployContract('MockB20', ['Apple Inc.', 'AAPLc', 8])
  const nvda = await hre.viem.deployContract('MockB20', ['NVIDIA Corporation', 'NVDAc', 8])
  const rogue = await hre.viem.deployContract('MockB20', ['Rogue', 'RUG', 18])
  const vault = await hre.viem.deployContract('FolioVault', [owner.account.address])

  // Cap each Folio at 5 shares of any allowed name. Deliberately explicit.
  await vault.write.setAssets([[aapl.address, nvda.address], true, [shares(5), shares(5)]])

  for (const who of [alice, bob, carol]) {
    await aapl.write.mint([who.account.address, shares(100)])
    await nvda.write.mint([who.account.address, shares(100)])
    await rogue.write.mint([who.account.address, shares(100)])
  }
  return { owner, alice, bob, carol, pub, aapl, nvda, rogue, vault }
}

// Re-bind a contract instance so writes are sent from a specific wallet.
const as = (contract, wallet) =>
  hre.viem.getContractAt(contract.abi.__name || 'FolioVault', contract.address, { client: { wallet } })

async function contractAs(name, address, wallet) {
  return hre.viem.getContractAt(name, address, { client: { wallet } })
}

async function approve(token, wallet, spender, amount) {
  const t = await contractAs('MockB20', token.address, wallet)
  await t.write.approve([spender, amount])
}

describe('FolioVault', function () {
  describe('allowlist and caps', function () {
    it('rejects assets that are not on the allowlist', async function () {
      const { vault, alice, rogue } = await deploy()
      await approve(rogue, alice, vault.address, maxUint256)
      const v = await contractAs('FolioVault', vault.address, alice)
      await expectRevert(
        v.write.createFolio([
          alice.account.address, 'Rug basket', 0n, 0n,
          '0x' + '0'.repeat(64), POLICY,
          [{ token: rogue.address, amount: shares(1) }],
        ]),
        'AssetNotAllowed',
      )
    })

    it('enforces the per-folio cap, including across top-ups', async function () {
      const { vault, alice, aapl } = await deploy()
      await approve(aapl, alice, vault.address, maxUint256)
      const v = await contractAs('FolioVault', vault.address, alice)

      await expectRevert(
        v.write.createFolio([
          alice.account.address, 'Too big', 0n, 0n, '0x' + '0'.repeat(64), POLICY,
          [{ token: aapl.address, amount: shares(6) }],
        ]),
        'AssetCapExceeded',
      )

      await v.write.createFolio([
        alice.account.address, 'Just right', 0n, 0n, '0x' + '0'.repeat(64), POLICY,
        [{ token: aapl.address, amount: shares(4) }],
      ])
      // 4 + 2 would breach the cap of 5.
      await expectRevert(
        v.write.fund([1n, [{ token: aapl.address, amount: shares(2) }]]),
        'AssetCapExceeded',
      )
      await v.write.fund([1n, [{ token: aapl.address, amount: shares(1) }]])
      expect(await vault.read.holdings([1n, aapl.address])).to.equal(shares(5))
    })

    it('credits only what actually arrived for fee-on-transfer tokens', async function () {
      const { vault, alice, owner } = await deploy()
      const fee = await hre.viem.deployContract('FeeOnTransferToken', [])
      await fee.write.mint([alice.account.address, shares(100)])
      await vault.write.setAsset([fee.address, true, maxUint256])

      await approve(fee, alice, vault.address, maxUint256)
      const v = await contractAs('FolioVault', vault.address, alice)
      await v.write.createFolio([
        alice.account.address, 'Lossy', 0n, 0n, '0x' + '0'.repeat(64), POLICY,
        [{ token: fee.address, amount: shares(10) }],
      ])
      // 1% skimmed on transfer, so the vault must record 9.9, not 10.
      expect(await vault.read.holdings([1n, fee.address])).to.equal(shares(9.9))
    })
  })

  describe('creating and holding', function () {
    it('records a multi-asset folio with its name and policy', async function () {
      const { vault, alice, aapl, nvda } = await deploy()
      await approve(aapl, alice, vault.address, maxUint256)
      await approve(nvda, alice, vault.address, maxUint256)
      const v = await contractAs('FolioVault', vault.address, alice)

      await v.write.createFolio([
        alice.account.address, 'Ada school', 0n, 0n, '0x' + '0'.repeat(64), POLICY,
        [
          { token: nvda.address, amount: shares(3) },
          { token: aapl.address, amount: shares(2) },
        ],
      ])

      const [folio, ownerAddr, escrowed] = await vault.read.getFolio([1n])
      expect(folio.name).to.equal('Ada school')
      expect(folio.policyHash).to.equal(POLICY)
      expect(getAddress(ownerAddr)).to.equal(getAddress(alice.account.address))
      expect(escrowed).to.equal(false)

      const [tokens, amounts] = await vault.read.getHoldings([1n])
      expect(tokens.map(getAddress)).to.deep.equal([nvda.address, aapl.address].map(getAddress))
      expect(amounts).to.deep.equal([shares(3), shares(2)])
    })

    it('refuses an empty folio', async function () {
      const { vault, alice } = await deploy()
      const v = await contractAs('FolioVault', vault.address, alice)
      await expectRevert(
        v.write.createFolio([alice.account.address, 'Empty', 0n, 0n, '0x' + '0'.repeat(64), POLICY, []]),
        'NoContributions',
      )
    })
  })

  describe('locking', function () {
    it('blocks withdrawal until the unlock date, then allows it', async function () {
      const { vault, alice, aapl, pub } = await deploy()
      await approve(aapl, alice, vault.address, maxUint256)
      const v = await contractAs('FolioVault', vault.address, alice)
      const unlockAt = BigInt((await time.latest()) + 30 * DAY)

      await v.write.createFolio([
        alice.account.address, 'Locked', unlockAt, 0n, '0x' + '0'.repeat(64), POLICY,
        [{ token: aapl.address, amount: shares(2) }],
      ])

      expect(await vault.read.isUnlocked([1n])).to.equal(false)
      await expectRevert(v.write.withdrawAll([1n, alice.account.address]), 'FolioLocked')

      await time.increaseTo(Number(unlockAt) + 1)
      expect(await vault.read.isUnlocked([1n])).to.equal(true)

      const before = await aapl.read.balanceOf([alice.account.address])
      await v.write.withdrawAll([1n, alice.account.address])
      const after = await aapl.read.balanceOf([alice.account.address])
      expect(after - before).to.equal(shares(2))
      expect(await vault.read.holdings([1n, aapl.address])).to.equal(0n)
    })

    it('lets a lock be pushed out but never pulled in', async function () {
      const { vault, alice, aapl } = await deploy()
      await approve(aapl, alice, vault.address, maxUint256)
      const v = await contractAs('FolioVault', vault.address, alice)
      const unlockAt = BigInt((await time.latest()) + 30 * DAY)
      await v.write.createFolio([
        alice.account.address, 'Locked', unlockAt, 0n, '0x' + '0'.repeat(64), POLICY,
        [{ token: aapl.address, amount: shares(1) }],
      ])

      await expectRevert(v.write.extendLock([1n, unlockAt - BigInt(DAY)]), 'LockNotExtendable')
      await v.write.extendLock([1n, unlockAt + BigInt(DAY)])
      const [folio] = await vault.read.getFolio([1n])
      expect(folio.unlockAt).to.equal(unlockAt + BigInt(DAY))
    })

    it('stops a non-owner from withdrawing', async function () {
      const { vault, alice, bob, aapl } = await deploy()
      await approve(aapl, alice, vault.address, maxUint256)
      const va = await contractAs('FolioVault', vault.address, alice)
      await va.write.createFolio([
        alice.account.address, 'Mine', 0n, 0n, '0x' + '0'.repeat(64), POLICY,
        [{ token: aapl.address, amount: shares(1) }],
      ])
      const vb = await contractAs('FolioVault', vault.address, bob)
      await expectRevert(vb.write.withdrawAll([1n, bob.account.address]), 'NotFolioOwner')
    })
  })

  describe('gifting', function () {
    it('gives a direct gift to the recipient immediately, but locked', async function () {
      const { vault, alice, bob, aapl } = await deploy()
      await approve(aapl, alice, vault.address, maxUint256)
      const va = await contractAs('FolioVault', vault.address, alice)
      const unlockAt = BigInt((await time.latest()) + 365 * DAY)

      await va.write.createFolio([
        bob.account.address, 'Amara 2028', unlockAt, 0n, '0x' + '0'.repeat(64), POLICY,
        [{ token: aapl.address, amount: shares(1) }],
      ])

      // Bob owns it from the moment it is created - that is the point of the gift.
      expect(getAddress(await vault.read.ownerOf([1n]))).to.equal(getAddress(bob.account.address))
      const vb = await contractAs('FolioVault', vault.address, bob)
      await expectRevert(vb.write.withdrawAll([1n, bob.account.address]), 'FolioLocked')
    })

    it('escrows a claim-link gift and releases it only for the right secret', async function () {
      const { vault, alice, bob, carol, aapl } = await deploy()
      await approve(aapl, alice, vault.address, maxUint256)
      const va = await contractAs('FolioVault', vault.address, alice)

      await va.write.createFolio([
        zeroAddress, 'Claim me', 0n, 0n, CLAIM_HASH, POLICY,
        [{ token: aapl.address, amount: shares(1) }],
      ])

      expect(await vault.read.isClaimable([1n])).to.equal(true)
      expect(getAddress(await vault.read.ownerOf([1n]))).to.equal(getAddress(vault.address))

      const vc = await contractAs('FolioVault', vault.address, carol)
      await expectRevert(vc.write.claim([1n, keccak256(encodePacked(['string'], ['wrong']))]), 'BadSecret')

      const vb = await contractAs('FolioVault', vault.address, bob)
      await vb.write.claim([1n, SECRET])
      expect(getAddress(await vault.read.ownerOf([1n]))).to.equal(getAddress(bob.account.address))
      expect(await vault.read.isClaimable([1n])).to.equal(false)

      // The secret is spent; it cannot be replayed.
      await expectRevert(vc.write.claim([1n, SECRET]), 'NotEscrowed')
    })

    it('requires a claim hash when no recipient is given', async function () {
      const { vault, alice, aapl } = await deploy()
      await approve(aapl, alice, vault.address, maxUint256)
      const va = await contractAs('FolioVault', vault.address, alice)
      await expectRevert(
        va.write.createFolio([
          zeroAddress, 'Nowhere', 0n, 0n, '0x' + '0'.repeat(64), POLICY,
          [{ token: aapl.address, amount: shares(1) }],
        ]),
        'InvalidRecipient',
      )
    })

    it('returns an unclaimed gift to its funder after the window, unlocked', async function () {
      const { vault, alice, aapl } = await deploy()
      await approve(aapl, alice, vault.address, maxUint256)
      const va = await contractAs('FolioVault', vault.address, alice)
      const now = await time.latest()
      const reclaimAfter = BigInt(now + 14 * DAY)
      const unlockAt = BigInt(now + 365 * DAY)

      await va.write.createFolio([
        zeroAddress, 'Unclaimed', unlockAt, reclaimAfter, CLAIM_HASH, POLICY,
        [{ token: aapl.address, amount: shares(1) }],
      ])

      await expectRevert(va.write.reclaim([1n]), 'NotReclaimable')
      await time.increaseTo(Number(reclaimAfter) + 1)
      await va.write.reclaim([1n])

      expect(getAddress(await vault.read.ownerOf([1n]))).to.equal(getAddress(alice.account.address))
      // Reclaiming clears the lock, so the funder is not locked out of their own money.
      expect(await vault.read.isUnlocked([1n])).to.equal(true)
      await va.write.withdrawAll([1n, alice.account.address])
    })
  })

  describe('admin controls', function () {
    it('only the owner can configure assets', async function () {
      const { vault, alice, rogue } = await deploy()
      const va = await contractAs('FolioVault', vault.address, alice)
      await expectRevert(va.write.setAsset([rogue.address, true, maxUint256]), 'OwnableUnauthorizedAccount')
    })

    it('pausing stops new folios but never traps existing funds', async function () {
      const { vault, alice, aapl } = await deploy()
      await approve(aapl, alice, vault.address, maxUint256)
      const va = await contractAs('FolioVault', vault.address, alice)
      await va.write.createFolio([
        alice.account.address, 'Before pause', 0n, 0n, '0x' + '0'.repeat(64), POLICY,
        [{ token: aapl.address, amount: shares(1) }],
      ])

      await vault.write.pause()
      await expectRevert(
        va.write.createFolio([
          alice.account.address, 'During pause', 0n, 0n, '0x' + '0'.repeat(64), POLICY,
          [{ token: aapl.address, amount: shares(1) }],
        ]),
        'EnforcedPause',
      )
      // Withdrawal is intentionally not pausable: an admin must not be able to
      // freeze a user's assets inside their own folio.
      await va.write.withdrawAll([1n, alice.account.address])
      expect(await aapl.read.balanceOf([vault.address])).to.equal(0n)
    })
  })
})
