/** @type {import('next').NextConfig} */

// The wagmi connectors barrel reaches the Base Account connector, which pulls in the
// Coinbase CDP SDK, which lazily imports x402 payment adapters we do not install and
// never call. Resolving them to empty modules keeps the bundle honest and the build green.
const UNUSED_OPTIONAL_DEPS = [
  '@x402/core/client',
  '@x402/evm',
  '@x402/evm/exact/client',
  '@x402/evm/upto/client',
  '@x402/svm/exact/client',
  '@react-native-async-storage/async-storage',
]

// Folio offers exactly one way in: Coinbase Smart Wallet. The wagmi connectors barrel
// still drags every other wallet SDK through the compiler, which cost ~2 minutes per
// cold build and megabytes of dead client code. These are the SDKs behind connectors we
// never construct; @coinbase/wallet-sdk is deliberately absent from the list.
// @walletconnect and @coinbase/wallet-sdk are deliberately absent: those connectors are
// actually offered. The MetaMask SDK is stubbed because MetaMask reaches us through the
// generic injected connector (EIP-6963), which needs no SDK at all.
const UNUSED_WALLET_SDKS = ['@metamask/sdk', '@base-org/account', '@coinbase/cdp-sdk', '@gemini-wallet/core', 'porto']

const nextConfig = {
  reactStrictMode: true,
  // Several lockfiles exist above this directory; pin the root so tracing does not
  // wander up to the home directory.
  outputFileTracingRoot: import.meta.dirname,
  webpack: (config) => {
    config.externals.push('pino-pretty', 'lokijs', 'encoding')
    config.resolve.alias = {
      ...config.resolve.alias,
      ...Object.fromEntries([...UNUSED_OPTIONAL_DEPS, ...UNUSED_WALLET_SDKS].map((m) => [m, false])),
    }
    return config
  },
}

export default nextConfig
