import 'server-only'
import { PrivyClient } from '@privy-io/node'

/**
 * Who is asking. Folio only pays fees for people who signed up: the browser sends its
 * Privy access token, we verify it, and look up the Solana wallets on that account. The
 * co-signer then requires every user signer in the transaction to be one of them.
 */

export class AuthError extends Error {
  status: number
  constructor(message: string, status = 401) {
    super(message)
    this.status = status
  }
}

let client: PrivyClient | null = null
function privy() {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID
  const appSecret = process.env.PRIVY_APP_SECRET
  if (!appId || !appSecret) throw new AuthError('Sign-in is not configured on the server', 503)
  client ??= new PrivyClient({ appId, appSecret })
  return client
}

const WALLET_TTL_MS = 5 * 60_000
const wallets = new Map<string, { at: number; addresses: string[] }>()

export async function authenticate(req: Request): Promise<{ userId: string; wallets: string[] }> {
  const token = req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) throw new AuthError('Sign in first')

  let userId: string
  try {
    userId = (await privy().utils().auth().verifyAccessToken(token)).user_id
  } catch (e) {
    if (e instanceof AuthError) throw e
    throw new AuthError('Your session has expired. Sign in again.')
  }

  const cached = wallets.get(userId)
  if (cached && Date.now() - cached.at < WALLET_TTL_MS) return { userId, wallets: cached.addresses }

  const user = await privy().users()._get(userId)
  const addresses = user.linked_accounts
    .filter((a) => a.type === 'wallet' && 'chain_type' in a && a.chain_type === 'solana')
    .map((a) => (a as { address: string }).address)
  wallets.set(userId, { at: Date.now(), addresses })
  if (wallets.size > 10_000) wallets.clear()
  return { userId, wallets: addresses }
}
