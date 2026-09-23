import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

// Local secrets live in the repo root's gitignored .env.solana, next to the keys folder.
// On Vercel the same names come from project settings and this file is absent.
const rootEnv = resolve(import.meta.dirname, '../../.env.solana')
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv)

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The Kamino lending SDK ships WebAssembly through its liquidity dependency; bundling it
  // loses the .wasm file, so it is loaded from node_modules at runtime instead.
  // Only the WebAssembly-bearing package is left unbundled (bundling loses the .wasm).
  // The lending SDK itself must stay bundled: unbundled, Node hits a CommonJS/ESM clash
  // inside anchor's rpc-websockets dependency on Vercel.
  serverExternalPackages: ['@kamino-finance/kliquidity-sdk', '@orca-so/whirlpools-core'],
  // Several lockfiles live above this directory; pin tracing to the app itself.
  outputFileTracingRoot: import.meta.dirname,
  webpack: (config, { isServer }) => {
    config.externals.push('pino-pretty', 'lokijs', 'encoding')
    if (isServer) {
      // Privy's documented setup keeps its Solana peer packages out of the server bundle.
      config.externals.push({
        '@solana/kit': 'commonjs @solana/kit',
        '@solana-program/memo': 'commonjs @solana-program/memo',
        '@solana-program/system': 'commonjs @solana-program/system',
        '@solana-program/token': 'commonjs @solana-program/token',
      })
    }
    return config
  },
}
export default nextConfig
