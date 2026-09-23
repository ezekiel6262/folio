import { PublicKey } from '@solana/web3.js'
import { basketPolicy, describeNames } from '@/lib/actions'
import { enforceAllowlist, rulesAllocator } from '@/lib/allocator'
import { STOCKS, STOCK_BY_SYMBOL, type Stock } from '@/lib/assets'
import { isBlocked } from '@/lib/eligibility'
import { foliosOwnedBy, giftsWaitingFrom, readFolio } from '@/lib/folio-reader'
import { earnTokens } from '@/lib/earn'
import { lendingTerms } from '@/lib/lending'
import { getMarket } from '@/lib/market'
import { planPurchase } from '@/lib/quote'
import { buildAllSteps } from '@/lib/steps'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Folio as a tool for AI agents: a remote MCP server (Streamable HTTP, stateless JSON).
 * Agents can price companies, turn a sentence into a basket, read portfolios, make buy
 * links, and get unsigned purchase transactions for their own wallet to sign. Folio never
 * sees a key; every purchase still lands in an on-chain vault owned by the signer.
 */

const PROTOCOL = '2025-06-18'
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id',
}

type Json = Record<string, unknown>
const symbolsSchema = { type: 'array', items: { type: 'string', enum: STOCKS.map((s) => s.symbol) }, maxItems: 3 }

const TOOLS = [
  {
    name: 'list_companies',
    description:
      'Every company Folio can hold: listed US stocks (xStocks) and private pre-IPO companies (PreStocks), with the live price per share, the reference it tracks (exchange share price or last private valuation) and the premium over it.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'plan_basket',
    description:
      'Turn a plain-English request ("AI companies before they go public", "Apple and the S&P 500") or explicit symbols into a basket of up to 3 companies, and quote it live: shares per company, fill vs market, guaranteed minimum, fees.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'What to own, in words. Ignored if symbols are given.' },
        symbols: symbolsSchema,
        amount_usd: { type: 'number', minimum: 1, maximum: 250 },
      },
      required: ['amount_usd'],
      additionalProperties: false,
    },
  },
  {
    name: 'build_buy_transactions',
    description:
      'Unsigned Solana transactions that buy a basket into a new Folio vault owned by `owner`, paid in USDC by that wallet (it also pays the network fee). One company per transaction; sign and send them in order within about a minute. Returns the folio address.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Solana address of the wallet that will sign and own the folio' },
        prompt: { type: 'string' },
        symbols: symbolsSchema,
        amount_usd: { type: 'number', minimum: 1, maximum: 250 },
        name: { type: 'string', maxLength: 40 },
        lock_until: { type: 'string', description: 'Optional ISO date; shares cannot be withdrawn before it' },
      },
      required: ['owner', 'amount_usd'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_portfolio',
    description: "A wallet's folios with holdings and value, plus gifts it sent that are not yet claimed.",
    inputSchema: { type: 'object', properties: { owner: { type: 'string' } }, required: ['owner'], additionalProperties: false },
  },
  {
    name: 'get_folio',
    description: 'One folio: owner, lock, holdings in share-equivalents and USD.',
    inputSchema: { type: 'object', properties: { address: { type: 'string' } }, required: ['address'], additionalProperties: false },
  },
  {
    name: 'get_yields',
    description:
      'What idle stablecoins earn through Jupiter Lend, and what each company can back a loan for on the Kamino xStocks market (max loan-to-value and borrow rate).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'make_buy_link',
    description: 'A shareable Blink (works on X, Discord and in Solana wallets) and web link that let anyone buy a basket into their own folio.',
    inputSchema: {
      type: 'object',
      properties: { symbols: { ...symbolsSchema, minItems: 1 }, name: { type: 'string', maxLength: 40 } },
      required: ['symbols'],
      additionalProperties: false,
    },
  },
] as const

function weightsFor(args: Json): { weights: { symbol: string; weightBps: number }[]; interpretation: string } {
  const symbols = Array.isArray(args.symbols) ? (args.symbols as string[]) : []
  if (symbols.length) {
    const each = Math.floor(10_000 / symbols.length)
    const weights = symbols.map((symbol, i) => ({ symbol, weightBps: i === 0 ? 10_000 - each * (symbols.length - 1) : each }))
    enforceAllowlist(Object.fromEntries(weights.map((w) => [w.symbol, w.weightBps])))
    return { weights, interpretation: `Equal weights across ${symbols.join(', ')}.` }
  }
  const a = rulesAllocator.allocate({ prompt: String(args.prompt ?? '') })
  if (!a.lines.length) throw new Error(a.interpretation)
  return { weights: a.lines.map((l) => ({ symbol: l.symbol, weightBps: l.weightBps })), interpretation: a.interpretation }
}

function amount(args: Json) {
  const n = Number(args.amount_usd)
  if (!Number.isFinite(n) || n < 1 || n > 250) throw new Error('amount_usd must be between 1 and 250')
  return n
}

async function callTool(name: string, args: Json, req: Request, origin: string): Promise<unknown> {
  switch (name) {
    case 'list_companies': {
      const m = await getMarket()
      return STOCKS.map((s) => ({
        symbol: s.symbol,
        name: s.display,
        kind: s.kind,
        issuer: s.issuer,
        price_usd: m.stocks[s.symbol]?.shareUsd ?? null,
        reference_usd: m.stocks[s.symbol]?.referenceUsd ?? null,
        premium_pct: m.stocks[s.symbol]?.premiumPct ?? null,
        last_valuation_usd: m.valuations[s.symbol]?.markValuation ?? null,
      }))
    }
    case 'plan_basket': {
      const { weights, interpretation } = weightsFor(args)
      const plan = await planPurchase({ displayCode: 'USD', amountLocal: amount(args), payWith: 'USDC', weights, market: await getMarket() })
      return {
        interpretation,
        spend_usd: plan.spendUsd,
        cost_to_get_in_pct: plan.totalCostPct,
        legs: plan.legs.map((l) => ({
          symbol: l.symbol,
          weight_pct: l.weightBps / 100,
          spend_usd: l.spendUsd,
          shares: l.shares,
          guaranteed_min_shares: l.minShares,
          fill_per_share_usd: l.fillShareUsd,
          market_per_share_usd: l.marketShareUsd,
          premium_over_reference_pct: l.premiumPct ?? null,
          issuer_transfer_fee_pct: l.transferFeePct,
        })),
        warnings: plan.warnings,
      }
    }
    case 'build_buy_transactions': {
      if (isBlocked(req.headers)) throw new Error('Folio is not available in the United States.')
      const owner = new PublicKey(String(args.owner))
      const { weights, interpretation } = weightsFor(args)
      const lock = args.lock_until ? Math.floor(new Date(String(args.lock_until)).getTime() / 1000) : 0
      if (Number.isNaN(lock)) throw new Error('lock_until is not a date')
      const stocks = weights.map((w) => STOCK_BY_SYMBOL.get(w.symbol) as Stock)
      const basketName = String(args.name ?? describeNames(stocks)).slice(0, 40)
      const { hash } = basketPolicy({ weights, name: basketName, source: `mcp:${interpretation}` })
      const { folio, steps } = await buildAllSteps({
        owner,
        weights,
        amountUsd: amount(args),
        folio: { kind: 'new', name: basketName, unlockAt: lock, reclaimAfter: 0, claimKey: null, recipient: null, policyHashHex: hash },
      })
      return {
        folio,
        folio_url: `${origin}/folio/${folio}`,
        interpretation,
        how_to_send: 'Each transaction is a base64 v0 transaction with `owner` as fee payer and sole signer. Sign and send them in order; the first creates the folio.',
        transactions: steps.map((s, i) => ({ step: i + 1, symbol: s.symbol, spend_usd: s.usd, shares: s.shares, guaranteed_min_shares: s.minShares, transaction: s.transaction })),
      }
    }
    case 'get_portfolio': {
      const owner = new PublicKey(String(args.owner)).toBase58()
      const [owned, waiting] = await Promise.all([foliosOwnedBy(owner), giftsWaitingFrom(owner)])
      const shape = (f: Awaited<ReturnType<typeof readFolio>>) =>
        f && {
          address: f.address,
          name: f.name,
          total_usd: f.totalUsd,
          locked_until: f.unlockAt ? new Date(f.unlockAt * 1000).toISOString() : null,
          holdings: f.holdings.map((h) => ({ symbol: h.symbol, shares: h.shares, value_usd: h.valueUsd })),
        }
      return { owned: owned.map(shape), gifts_waiting: waiting.map(shape) }
    }
    case 'get_folio': {
      const f = await readFolio(String(args.address))
      if (!f) throw new Error('No folio at that address')
      return {
        ...f,
        url: `${origin}/folio/${f.address}`,
        holdings: f.holdings.map((h) => ({ symbol: h.symbol, shares: h.shares, share_usd: h.shareUsd, value_usd: h.valueUsd })),
      }
    }
    case 'get_yields': {
      const [earn, lending] = await Promise.all([earnTokens(), lendingTerms()])
      return {
        cash: earn.map((t) => ({ symbol: t.symbol, apy_pct: t.apy, liquidity_usd: t.liquidityUsd })),
        collateral: Object.values(lending)
          .filter((t) => STOCK_BY_SYMBOL.has(t.symbol))
          .map((t) => ({ symbol: t.symbol, max_loan_to_value: t.maxLtv, borrow_apy_pct: t.borrowApy })),
        borrow_cost_usdc_apy_pct: lending.USDC?.borrowApy ?? null,
      }
    }
    case 'make_buy_link': {
      const symbols = (args.symbols as string[]) ?? []
      enforceAllowlist(Object.fromEntries(symbols.map((s, i) => [s, i === 0 ? 10_000 - Math.floor(10_000 / symbols.length) * (symbols.length - 1) : Math.floor(10_000 / symbols.length)])))
      const qs = new URLSearchParams({ s: symbols.join(',') })
      if (args.name) qs.set('name', String(args.name).slice(0, 40))
      const action = `${origin}/api/actions/basket?${qs}`
      return { blink: `https://dial.to/?action=${encodeURIComponent(`solana-action:${action}`)}`, web: `${origin}/basket?${qs}`, action }
    }
    default:
      throw Object.assign(new Error(`Unknown tool ${name}`), { code: -32602 })
  }
}

async function handle(msg: Json, req: Request, origin: string): Promise<Json | null> {
  const id = msg.id as string | number | undefined
  const method = String(msg.method ?? '')
  const params = (msg.params ?? {}) as Json
  if (id === undefined) return null // notification

  const ok = (result: unknown) => ({ jsonrpc: '2.0', id, result })
  try {
    switch (method) {
      case 'initialize':
        return ok({
          protocolVersion: typeof params.protocolVersion === 'string' ? params.protocolVersion : PROTOCOL,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'folio', title: 'Folio — US stocks and pre-IPO companies on Solana', version: '0.1.0' },
          instructions:
            'Folio buys tokenized US stocks (xStocks) and pre-IPO companies (PreStocks) into on-chain vaults owned by the signer. Use plan_basket to quote, build_buy_transactions for unsigned transactions your wallet signs, and make_buy_link to share. Not available to US persons.',
        })
      case 'ping':
        return ok({})
      case 'tools/list':
        return ok({ tools: TOOLS })
      case 'tools/call': {
        const name = String(params.name)
        try {
          const result = await callTool(name, (params.arguments ?? {}) as Json, req, origin)
          return ok({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: Array.isArray(result) ? { items: result } : result, isError: false })
        } catch (e) {
          if ((e as { code?: number }).code === -32602) throw e
          return ok({ content: [{ type: 'text', text: (e as Error).message }], isError: true })
        }
      }
      default:
        return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } }
    }
  } catch (e) {
    return { jsonrpc: '2.0', id, error: { code: (e as { code?: number }).code ?? -32603, message: (e as Error).message } }
  }
}

export async function POST(req: Request) {
  const origin = new URL(req.url).origin
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, { status: 400, headers: CORS })
  }
  const batch = Array.isArray(body)
  const messages = (batch ? body : [body]) as Json[]
  const replies = (await Promise.all(messages.map((m) => handle(m, req, origin)))).filter(Boolean)
  if (!replies.length) return new Response(null, { status: 202, headers: CORS })
  return Response.json(batch ? replies : replies[0], { headers: { ...CORS, 'Mcp-Protocol-Version': PROTOCOL } })
}

/** No server-initiated stream: this server only answers requests. */
export async function GET() {
  return new Response('Folio MCP server. POST JSON-RPC to this URL.', { status: 405, headers: { ...CORS, Allow: 'POST, OPTIONS' } })
}

export async function OPTIONS() {
  return new Response(null, { headers: CORS })
}
