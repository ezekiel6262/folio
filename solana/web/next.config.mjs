import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

// Local secrets live in the repo root's gitignored .env.solana, next to the keys folder.
// On Vercel the same names come from project settings and this file is absent.
const rootEnv = resolve(import.meta.dirname, '../../.env.solana')
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv)

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
