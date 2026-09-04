require('dotenv').config()
require('@nomicfoundation/hardhat-toolbox-viem')

const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY
const accounts = DEPLOYER_KEY ? [DEPLOYER_KEY.startsWith('0x') ? DEPLOYER_KEY : `0x${DEPLOYER_KEY}`] : []

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: 'cancun',
    },
  },
  networks: {
    base: {
      url: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
      chainId: 8453,
      accounts,
    },
    baseSepolia: {
      url: process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org',
      chainId: 84532,
      accounts,
    },
  },
  etherscan: {
    apiKey: { base: process.env.BASESCAN_API_KEY || '' },
  },
}
