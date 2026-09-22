import 'server-only'
import { createHash } from 'node:crypto'
import { ALLOWED_SYMBOLS, MAX_COMPANIES, STOCKS, type Stock } from './assets'

/**
 * The Brain.
 *
 * Turns a sentence into weights over the listed xStocks. The property that matters is
 * containment, not intelligence: this engine scores the allowlist rather than generating
 * names, so it can only ever emit a stock that exists on-chain and that the vault accepts.
 * A future LLM allocator implements `Allocator` and passes through `enforceAllowlist` —
 * the guarantee lives in the interface, not the model.
 *
 * Solana adds one hard limit: a purchase is all-or-nothing only up to MAX_COMPANIES names,
 * because that is what fits in one transaction. The allocator respects it and says so.
 */

export type Tilt = 'growth' | 'quality' | 'balanced'

export type Policy = {
  version: 1
  engine: string
  prompt: string
  tilt: Tilt
  maxWeight: number
  /** symbol -> basis points, summing to 10_000 */
  weights: Record<string, number>
  excluded: string[]
}

export type AllocationLine = { symbol: string; display: string; name: string; weightBps: number; reason: string }

export type Allocation = {
  lines: AllocationLine[]
  excluded: { symbol: string; display: string; reason: string }[]
  interpretation: string
  tilt: Tilt
  policy: Policy
  /** sha256 of the canonical policy, hex. Stored on-chain in the folio as `policy_hash`. */
  policyHash: string
}

export interface Allocator {
  allocate(input: { prompt: string; tilt?: Tilt }): Allocation
}

// ---------------------------------------------------------------- vocabulary

const THEMES: Record<string, string[]> = {
  ai: ['ai'],
  'artificial intelligence': ['ai'],
  'machine learning': ['ai'],
  chip: ['chips'],
  chips: ['chips'],
  semiconductor: ['chips'],
  semiconductors: ['chips'],
  gpu: ['chips'],
  cloud: ['cloud'],
  'data center': ['cloud'],
  datacenter: ['cloud'],
  software: ['software'],
  ad: ['ads'],
  ads: ['ads'],
  advertising: ['ads'],
  social: ['social'],
  'social media': ['social'],
  search: ['search'],
  ev: ['ev'],
  'electric car': ['ev'],
  'electric vehicle': ['ev'],
  cars: ['ev'],
  energy: ['energy'],
  retail: ['retail'],
  shopping: ['retail'],
  ecommerce: ['retail'],
  consumer: ['consumer'],
  phone: ['consumer'],
  hardware: ['hardware'],
  index: ['index'],
  'index fund': ['index'],
  etf: ['index'],
  'the market': ['index'],
  'whole market': ['index'],
  'broad market': ['index'],
  diversified: ['diversified'],
  'spread out': ['diversified'],
  safe: ['quality'],
  'big tech': ['large-cap'],
  tech: ['software', 'hardware', 'cloud'],
  technology: ['software', 'hardware', 'cloud'],
  // Private companies are only ever included when asked for — by name or like this.
  'pre-ipo': ['private'],
  'pre ipo': ['private'],
  preipo: ['private'],
  private: ['private'],
  'private companies': ['private'],
  'private company': ['private'],
  unlisted: ['private'],
  'before they go public': ['private'],
  'before the ipo': ['private'],
  'before ipo': ['private'],
  startups: ['private'],
  space: ['space'],
  rockets: ['space'],
  rocket: ['space'],
  defense: ['defense'],
  defence: ['defense'],
  military: ['defense'],
  robots: ['robotics'],
  robot: ['robotics'],
  robotics: ['robotics'],
  humanoid: ['robotics'],
  'prediction market': ['prediction'],
  'prediction markets': ['prediction'],
  betting: ['prediction'],
  biotech: ['biotech'],
  brain: ['biotech'],
}

/** How people actually refer to these. Normalised the same way the prompt is. */
const RAW_ALIASES: Record<string, string> = {
  apple: 'AAPLx',
  aapl: 'AAPLx',
  iphone: 'AAPLx',
  nvidia: 'NVDAx',
  nvda: 'NVDAx',
  microsoft: 'MSFTx',
  msft: 'MSFTx',
  google: 'GOOGLx',
  alphabet: 'GOOGLx',
  googl: 'GOOGLx',
  meta: 'METAx',
  facebook: 'METAx',
  instagram: 'METAx',
  amazon: 'AMZNx',
  amzn: 'AMZNx',
  tesla: 'TSLAx',
  tsla: 'TSLAx',
  's&p 500': 'SPYx',
  's&p500': 'SPYx',
  's&p': 'SPYx',
  'sp 500': 'SPYx',
  sp500: 'SPYx',
  spy: 'SPYx',
  anthropic: 'ANTHROPIC',
  claude: 'ANTHROPIC',
  openai: 'OPENAI',
  'open ai': 'OPENAI',
  chatgpt: 'OPENAI',
  spacex: 'SPACEX',
  'space x': 'SPACEX',
  starlink: 'SPACEX',
  anduril: 'ANDURIL',
  'figure ai': 'FIGUREAI',
  figureai: 'FIGUREAI',
  kalshi: 'KALSHI',
  neuralink: 'NEURALINK',
  polymarket: 'POLYMARKET',
}

const TILT_WORDS: Record<string, Tilt> = {
  growth: 'growth',
  aggressive: 'growth',
  risky: 'growth',
  moonshot: 'growth',
  quality: 'quality',
  safe: 'quality',
  safer: 'quality',
  stable: 'quality',
  steady: 'quality',
  conservative: 'quality',
  'low risk': 'quality',
  'blue chip': 'quality',
}

const NEGATORS = /\b(?:no|not|nothing|none|never|without|exclude|excluding|avoid|avoiding|except|minus|skip|drop)\b/g

/** When nothing matches, a broad and defensible start rather than an empty basket. */
const DEFAULT_BASKET = ['SPYx', 'AAPLx', 'MSFTx']

// ------------------------------------------------------------------ helpers

function normalise(text: string) {
  return text
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const ALIASES = Object.entries(RAW_ALIASES)
  .map(([alias, symbol]) => [normalise(alias), symbol] as const)
  // Longest first so "s p 500" wins over "s p".
  .sort((a, b) => b[0].length - a[0].length)

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')

function splitPolarity(text: string): { positive: string; negative: string } {
  const t = normalise(text)
  const negatives: string[] = []
  let positive = t
  for (const m of t.matchAll(NEGATORS)) {
    const start = (m.index ?? 0) + m[0].length
    const rest = t.slice(start)
    const stop = rest.search(/\band\b|\bbut\b|\bwith\b|\bplus\b|\bfor\b|$/)
    const phrase = rest.slice(0, stop === -1 ? undefined : stop).trim()
    if (phrase) negatives.push(phrase)
    positive = positive.replace(t.slice(m.index ?? 0, start + phrase.length), ' ')
  }
  return { positive: positive.replace(/\s+/g, ' ').trim(), negative: negatives.join(' , ') }
}

function tagsIn(text: string): Set<string> {
  const tags = new Set<string>()
  for (const key of Object.keys(THEMES).sort((a, b) => b.length - a.length)) {
    if (new RegExp(`\\b${escape(normalise(key))}\\b`).test(text)) THEMES[key].forEach((t) => tags.add(t))
  }
  return tags
}

/** Named stocks, in the order the user named them. */
function symbolsIn(text: string): string[] {
  const hits: { symbol: string; at: number }[] = []
  let scan = text
  for (const [alias, symbol] of ALIASES) {
    const re = new RegExp(`\\b${escape(alias)}\\b`)
    const m = re.exec(scan)
    if (!m) continue
    if (!hits.some((h) => h.symbol === symbol)) hits.push({ symbol, at: m.index })
    // Blank it out so "s p" does not also match inside an already-matched "s p 500".
    scan = scan.slice(0, m.index) + ' '.repeat(m[0].length) + scan.slice(m.index + m[0].length)
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.symbol)
}

function detectTilt(text: string): Tilt | null {
  for (const key of Object.keys(TILT_WORDS).sort((a, b) => b.length - a.length)) {
    if (new RegExp(`\\b${escape(key)}\\b`).test(text)) return TILT_WORDS[key]
  }
  return null
}

/** Largest-remainder rounding to exactly 10_000 bps, with a concentration cap. */
function toWeights(scored: { stock: Stock; score: number }[], maxWeight: number) {
  const total = scored.reduce((a, b) => a + b.score, 0)
  if (total <= 0) return []
  let w = scored.map((s) => ({ stock: s.stock, w: s.score / total }))
  for (let pass = 0; pass < 6; pass++) {
    const over = w.filter((x) => x.w > maxWeight)
    if (!over.length) break
    const overflow = over.reduce((a, b) => a + (b.w - maxWeight), 0)
    const underTotal = w.filter((x) => x.w < maxWeight).reduce((a, b) => a + b.w, 0)
    if (underTotal <= 0) break
    w = w.map((x) => (x.w > maxWeight ? { ...x, w: maxWeight } : { ...x, w: x.w + (overflow * x.w) / underTotal }))
  }
  const exact = w.map((x) => ({ stock: x.stock, exact: x.w * 10_000, bps: Math.floor(x.w * 10_000) }))
  let remainder = 10_000 - exact.reduce((a, b) => a + b.bps, 0)
  exact
    .map((e, i) => ({ i, frac: e.exact - e.bps }))
    .sort((a, b) => b.frac - a.frac)
    .forEach(({ i }) => {
      if (remainder > 0) {
        exact[i].bps += 1
        remainder -= 1
      }
    })
  return exact.filter((e) => e.bps > 0)
}

// ------------------------------------------------------------------- engine

export const rulesAllocator: Allocator = {
  allocate({ prompt, tilt: forcedTilt }) {
    const { positive, negative } = splitPolarity(prompt || '')
    const banned = new Set(symbolsIn(negative))
    const bannedTags = tagsIn(negative)
    const named = symbolsIn(positive).filter((s) => !banned.has(s))
    const wantedTags = tagsIn(positive)
    const tilt: Tilt = forcedTilt ?? detectTilt(positive) ?? 'balanced'

    const excluded: Allocation['excluded'] = []
    const wantsPrivate = wantedTags.has('private')
    const alsoListed = /\b(?:public and private|private and public|listed|and public|plus public)\b/.test(normalise(positive))
    // With a real theme alongside, "private" narrows the field rather than scoring a match.
    const themeTags = new Set([...wantedTags].filter((t) => t !== 'private' || wantedTags.size === 1))
    const eligible = STOCKS.filter((s) => {
      // A private company never slips into a basket by theme alone; it has to be asked for.
      if (s.kind === 'private' && !wantsPrivate && !named.includes(s.symbol)) return false
      // "Before they go public" means private companies, unless listed ones are asked for too.
      if (s.kind === 'listed' && wantsPrivate && !alsoListed && !named.includes(s.symbol)) return false
      if (banned.has(s.symbol)) {
        excluded.push({ symbol: s.symbol, display: s.display, reason: 'you ruled it out by name' })
        return false
      }
      const clash = s.tags.filter((t) => bannedTags.has(t))
      if (clash.length) {
        excluded.push({ symbol: s.symbol, display: s.display, reason: `you excluded ${clash.join(' and ')}` })
        return false
      }
      return true
    })

    let pool: { stock: Stock; score: number; reason: string }[]
    let mode: 'named' | 'themed' | 'default'
    let truncated = false

    if (named.length) {
      mode = 'named'
      truncated = named.length > MAX_COMPANIES
      pool = named
        .slice(0, MAX_COMPANIES)
        .map((symbol) => eligible.find((s) => s.symbol === symbol))
        .filter((s): s is Stock => Boolean(s))
        .map((s) => ({ stock: s, score: 1, reason: 'you asked for it by name' }))
    } else {
      mode = 'themed'
      pool = eligible
        .map((s) => {
          const hits = s.tags.filter((t) => themeTags.has(t))
          let score = hits.length
          if (tilt === 'growth' && s.tags.some((t) => t === 'growth' || t === 'ai')) score += 0.6
          if (tilt === 'quality' && s.tags.some((t) => t === 'quality' || t === 'large-cap')) score += 0.6
          if (tilt === 'quality' && s.tags.includes('volatile')) score -= 0.5
          return { stock: s, score, reason: hits.length ? `matches ${hits.join(', ')}` : `fits a ${tilt} tilt` }
        })
        .filter((p) => p.score > 0)
        .sort((a, b) => b.score - a.score)
      // Asked for both kinds: alternate them, best first, so the basket really is a mix.
      if (wantsPrivate && alsoListed) {
        const listed = pool.filter((p) => p.stock.kind === 'listed')
        const priv = pool.filter((p) => p.stock.kind === 'private')
        pool = Array.from({ length: Math.max(listed.length, priv.length) }, (_, i) => [listed[i], priv[i]])
          .flat()
          .filter((p): p is (typeof pool)[number] => Boolean(p))
      }
      truncated = pool.length > MAX_COMPANIES
      pool = pool.slice(0, MAX_COMPANIES)
      if (!pool.length) {
        mode = 'default'
        pool = DEFAULT_BASKET.map((symbol) => eligible.find((s) => s.symbol === symbol))
          .filter((s): s is Stock => Boolean(s))
          .map((s) => ({ stock: s, score: 1, reason: s.symbol === 'SPYx' ? 'the broad US market' : 'a large, steady company' }))
      }
    }

    const maxWeight = pool.length === 1 ? 1 : mode === 'named' ? 0.6 : 0.5
    const weighted = toWeights(pool.map((p) => ({ stock: p.stock, score: p.score })), maxWeight)
    const reasons = new Map(pool.map((p) => [p.stock.symbol, p.reason]))

    const lines: AllocationLine[] = weighted
      .map((w) => ({
        symbol: w.stock.symbol,
        display: w.stock.display,
        name: w.stock.name,
        weightBps: w.bps,
        reason: reasons.get(w.stock.symbol) ?? 'included',
      }))
      .sort((a, b) => b.weightBps - a.weightBps)

    const policy: Policy = {
      version: 1,
      engine: 'rules-v1-solana',
      prompt: prompt ?? '',
      tilt,
      maxWeight,
      weights: Object.fromEntries(lines.map((l) => [l.symbol, l.weightBps])),
      excluded: excluded.map((e) => e.symbol),
    }

    return {
      lines,
      excluded,
      tilt,
      interpretation: describe(lines, excluded, mode, tilt, wantedTags, truncated),
      policy,
      policyHash: hashPolicy(policy),
    }
  },
}

function describe(
  lines: AllocationLine[],
  excluded: Allocation['excluded'],
  mode: 'named' | 'themed' | 'default',
  tilt: Tilt,
  themes: Set<string>,
  truncated: boolean,
) {
  if (!lines.length) return 'Nothing on the list fits that. Try naming a company or a theme.'
  const names = lines.map((l) => l.display)
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`

  let s =
    mode === 'named'
      ? `You named ${list}, so that is the whole folio.`
      : mode === 'default'
        ? `Nothing specific matched, so this is a broad start: ${list}.`
        : themes.size
          ? `Built around ${[...themes].join(', ')}: ${list}.`
          : `A ${tilt} basket: ${list}.`
  if (mode === 'themed' && themes.size && tilt !== 'balanced') s += ` Weighted toward ${tilt}.`
  if (truncated) s += ` Folio buys up to ${MAX_COMPANIES} companies at a time, so it kept the strongest ${MAX_COMPANIES}.`
  if (excluded.length) s += ` Left out ${excluded.map((e) => e.display).join(', ')}.`
  return s
}

/** Canonical JSON, sha256, hex. The same 32 bytes go on-chain as the folio's policy_hash. */
export function hashPolicy(policy: Policy): string {
  const canonical = JSON.stringify(policy, Object.keys(policy).sort())
  return createHash('sha256').update(canonical).digest('hex')
}

/** Last line of defence for any allocator, including a future model. */
export function enforceAllowlist(weights: Record<string, number>) {
  const illegal = Object.keys(weights).filter((s) => !ALLOWED_SYMBOLS.includes(s))
  if (illegal.length) throw new Error(`Allocation named unlisted assets: ${illegal.join(', ')}`)
  if (Object.keys(weights).length > MAX_COMPANIES) throw new Error(`At most ${MAX_COMPANIES} companies per purchase`)
  const total = Object.values(weights).reduce((a, b) => a + b, 0)
  if (total !== 10_000) throw new Error(`Weights must sum to 10000 bps, got ${total}`)
  return true
}
