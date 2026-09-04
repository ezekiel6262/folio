import { keccak256, toHex } from 'viem'
import { STOCKS, ALLOWED_SYMBOLS, type Stock } from './assets'

/**
 * The Brain.
 *
 * Turns a sentence into weights over Coinbase tokenized stocks. The critical property
 * is not intelligence, it is containment: this engine can only ever emit symbols that
 * appear in the onchain allowlist, because it scores that list rather than generating
 * names. Swapping in an LLM later means implementing `Allocator` and running its output
 * through `enforceAllowlist` - the guarantee lives in the interface, not the model.
 */

export type Tilt = 'growth' | 'quality' | 'balanced'

export type Policy = {
  version: 1
  engine: string
  prompt: string
  tilt: Tilt
  maxWeight: number
  /** symbol -> weight in basis points, summing to 10_000 */
  weights: Record<string, number>
  excluded: string[]
}

export type AllocationLine = {
  symbol: string
  display: string
  name: string
  weightBps: number
  reason: string
}

export type Allocation = {
  lines: AllocationLine[]
  excluded: { symbol: string; display: string; reason: string }[]
  interpretation: string
  tilt: Tilt
  policy: Policy
  policyHash: `0x${string}`
}

export interface Allocator {
  allocate(input: { prompt: string; tilt?: Tilt }): Allocation
}

// ---------------------------------------------------------------- vocabulary

/** Theme word -> the asset tags it selects for. */
const THEMES: Record<string, string[]> = {
  ai: ['ai'],
  'artificial intelligence': ['ai'],
  'machine learning': ['ai'],
  chip: ['chips'],
  chips: ['chips'],
  semiconductor: ['chips'],
  semiconductors: ['chips'],
  semis: ['chips'],
  silicon: ['chips'],
  gpu: ['chips'],
  cloud: ['cloud'],
  datacenter: ['cloud'],
  'data center': ['cloud'],
  software: ['software'],
  enterprise: ['software'],
  ad: ['ads'],
  ads: ['ads'],
  advertising: ['ads'],
  adtech: ['ads'],
  social: ['social'],
  'social media': ['social'],
  search: ['search'],
  ev: ['ev'],
  'electric vehicle': ['ev'],
  'electric car': ['ev'],
  cars: ['ev'],
  auto: ['ev'],
  space: ['space'],
  rocket: ['space'],
  aerospace: ['space'],
  satellite: ['space'],
  bitcoin: ['bitcoin'],
  btc: ['bitcoin'],
  crypto: ['bitcoin'],
  storage: ['storage'],
  memory: ['storage'],
  flash: ['storage'],
  retail: ['retail'],
  ecommerce: ['retail'],
  'e-commerce': ['retail'],
  shopping: ['retail'],
  consumer: ['consumer'],
  phone: ['consumer'],
  iphone: ['consumer'],
  hardware: ['hardware'],
  devices: ['hardware'],
}

/** How people actually refer to these companies. */
const ALIASES: Record<string, string> = {
  apple: 'AAPLc',
  aapl: 'AAPLc',
  iphone: 'AAPLc',
  nvidia: 'NVDAc',
  nvda: 'NVDAc',
  microsoft: 'MSFTc',
  msft: 'MSFTc',
  google: 'GOOGLc',
  alphabet: 'GOOGLc',
  googl: 'GOOGLc',
  meta: 'METAc',
  facebook: 'METAc',
  instagram: 'METAc',
  amazon: 'AMZNc',
  amzn: 'AMZNc',
  tesla: 'TSLAc',
  tsla: 'TSLAc',
  microstrategy: 'MSTRc',
  mstr: 'MSTRc',
  strategy: 'MSTRc',
  sandisk: 'SNDKc',
  sndk: 'SNDKc',
  spacex: 'SPCXc',
  spcx: 'SPCXc',
}

const TILT_WORDS: Record<string, Tilt> = {
  growth: 'growth',
  aggressive: 'growth',
  moonshot: 'growth',
  risky: 'growth',
  speculative: 'growth',
  quality: 'quality',
  safe: 'quality',
  safer: 'quality',
  stable: 'quality',
  conservative: 'quality',
  'blue chip': 'quality',
  'low risk': 'quality',
  steady: 'quality',
}

/** Phrases that mean "not this" - everything up to the next clause boundary is negated. */
const NEGATORS =
  /\b(?:no|not|nothing|none|never|without|exclude|excluding|avoid|avoiding|except|excepting|minus|hate|skip|drop)\b/gi

// ------------------------------------------------------------------ helpers

function normalise(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Split a prompt into the part the user wants and the part they are ruling out.
 * "US tech that builds chips, no ads" -> positive: "us tech that builds chips",
 * negative: "ads".
 */
function splitPolarity(text: string): { positive: string; negative: string } {
  const t = normalise(text)
  const negatives: string[] = []
  let positive = t
  const matches = [...t.matchAll(NEGATORS)]

  for (const m of matches) {
    const start = m.index! + m[0].length
    // A negation runs until the next comma, conjunction, or end of sentence.
    const rest = t.slice(start)
    const stop = rest.search(/,|\band\b|\bbut\b|\bwith\b|\bplus\b|\bfor\b|$/)
    const phrase = rest.slice(0, stop === -1 ? undefined : stop).trim()
    if (phrase) negatives.push(phrase)
    positive = positive.replace(t.slice(m.index!, start + phrase.length), ' ')
  }
  return { positive: positive.replace(/\s+/g, ' ').trim(), negative: negatives.join(' , ') }
}

function themeTagsIn(text: string): Set<string> {
  const tags = new Set<string>()
  // Longest phrases first so "electric vehicle" wins over "vehicle".
  const keys = Object.keys(THEMES).sort((a, b) => b.length - a.length)
  for (const key of keys) {
    if (new RegExp(`\\b${key.replace(/[-\s]/g, '[-\\s]')}\\b`).test(text)) {
      for (const tag of THEMES[key]) tags.add(tag)
    }
  }
  return tags
}

function symbolsIn(text: string): Set<string> {
  const found = new Set<string>()
  for (const [alias, symbol] of Object.entries(ALIASES)) {
    if (new RegExp(`\\b${alias}\\b`).test(text)) found.add(symbol)
  }
  return found
}

function detectTilt(text: string): Tilt | null {
  const keys = Object.keys(TILT_WORDS).sort((a, b) => b.length - a.length)
  for (const key of keys) {
    if (new RegExp(`\\b${key.replace(/\s/g, '\\s')}\\b`).test(text)) return TILT_WORDS[key]
  }
  return null
}

/** Round weights to whole basis points that sum to exactly 10,000. */
function normaliseWeights(scored: { stock: Stock; score: number }[], maxWeight: number) {
  const total = scored.reduce((a, b) => a + b.score, 0)
  if (total <= 0) return []

  let raw = scored.map((s) => ({ stock: s.stock, w: s.score / total }))

  // Apply the concentration cap, redistributing the overflow across the rest.
  for (let pass = 0; pass < 6; pass++) {
    const over = raw.filter((r) => r.w > maxWeight)
    if (!over.length) break
    const overflow = over.reduce((a, b) => a + (b.w - maxWeight), 0)
    const under = raw.filter((r) => r.w < maxWeight)
    const underTotal = under.reduce((a, b) => a + b.w, 0)
    if (underTotal <= 0) break
    raw = raw.map((r) =>
      r.w > maxWeight ? { ...r, w: maxWeight } : { ...r, w: r.w + (overflow * r.w) / underTotal },
    )
  }

  // Largest-remainder rounding, so the basis points land on exactly 10,000.
  const exact = raw.map((r) => ({ stock: r.stock, exact: r.w * 10_000 }))
  const floored = exact.map((e) => ({ ...e, bps: Math.floor(e.exact) }))
  let remainder = 10_000 - floored.reduce((a, b) => a + b.bps, 0)
  floored
    .map((f, i) => ({ i, frac: f.exact - f.bps }))
    .sort((a, b) => b.frac - a.frac)
    .forEach(({ i }) => {
      if (remainder > 0) {
        floored[i].bps += 1
        remainder -= 1
      }
    })
  return floored.filter((f) => f.bps > 0)
}

// ------------------------------------------------------------------- engine

export const rulesAllocator: Allocator = {
  allocate({ prompt, tilt: forcedTilt }) {
    const { positive, negative } = splitPolarity(prompt || '')

    const bannedSymbols = symbolsIn(negative)
    const bannedTags = themeTagsIn(negative)
    const wantedSymbols = new Set([...symbolsIn(positive)].filter((s) => !bannedSymbols.has(s)))
    const wantedTags = themeTagsIn(positive)

    const tilt: Tilt = forcedTilt ?? detectTilt(positive) ?? 'balanced'
    const excluded: Allocation['excluded'] = []

    // Named companies win outright. If someone says "only Apple and Nvidia", that is
    // an instruction, not a hint - themes must not dilute it.
    const explicit = wantedSymbols.size > 0

    const scored: { stock: Stock; score: number; reason: string }[] = []
    for (const s of STOCKS) {
      if (bannedSymbols.has(s.symbol)) {
        excluded.push({ symbol: s.symbol, display: s.display, reason: 'you ruled it out by name' })
        continue
      }
      const clashing = s.tags.filter((t) => bannedTags.has(t))
      if (clashing.length) {
        excluded.push({ symbol: s.symbol, display: s.display, reason: `you excluded ${clashing.join(' and ')}` })
        continue
      }

      if (explicit) {
        if (wantedSymbols.has(s.symbol)) scored.push({ stock: s, score: 1, reason: 'you asked for it by name' })
        continue
      }

      const hits = s.tags.filter((t) => wantedTags.has(t))
      let score = hits.length
      if (tilt === 'growth' && s.tags.some((t) => t === 'growth' || t === 'ai')) score += 0.6
      if (tilt === 'quality' && s.tags.some((t) => t === 'quality' || t === 'large-cap')) score += 0.6
      if (tilt === 'quality' && s.tags.includes('volatile')) score -= 0.5

      if (score > 0) {
        scored.push({
          stock: s,
          score,
          reason: hits.length ? `matches ${hits.join(', ')}` : `fits a ${tilt} tilt`,
        })
      }
    }

    // Nothing matched: fall back to the large, liquid names rather than an empty basket.
    let pool = scored
    let fellBack = false
    if (!pool.length) {
      fellBack = true
      pool = STOCKS.filter(
        (s) => s.tags.includes('large-cap') && !bannedSymbols.has(s.symbol) && !s.tags.some((t) => bannedTags.has(t)),
      ).map((s) => ({ stock: s, score: 1, reason: 'core large-cap holding' }))
    }

    // A single named company is allowed to be the whole folio; a theme is not.
    const maxWeight = explicit && pool.length === 1 ? 1 : explicit ? 0.6 : 0.45
    const weighted = normaliseWeights(pool.map((p) => ({ stock: p.stock, score: p.score })), maxWeight)
    const reasonBySymbol = new Map(pool.map((p) => [p.stock.symbol, p.reason]))

    const lines: AllocationLine[] = weighted
      .map((w) => ({
        symbol: w.stock.symbol,
        display: w.stock.display,
        name: w.stock.name,
        weightBps: w.bps,
        reason: reasonBySymbol.get(w.stock.symbol) ?? 'included',
      }))
      .sort((a, b) => b.weightBps - a.weightBps)

    const policy: Policy = {
      version: 1,
      engine: 'rules-v1',
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
      interpretation: describe({ lines, excluded, tilt, explicit, fellBack, wantedTags, bannedTags }),
      policy,
      policyHash: hashPolicy(policy),
    }
  },
}

function describe(args: {
  lines: AllocationLine[]
  excluded: Allocation['excluded']
  tilt: Tilt
  explicit: boolean
  fellBack: boolean
  wantedTags: Set<string>
  bannedTags: Set<string>
}) {
  const { lines, excluded, tilt, explicit, fellBack, wantedTags } = args
  if (!lines.length) return 'Nothing on the Coinbase list matches that. Try naming a company or a theme.'

  const names = lines.map((l) => l.display)
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`

  const themes = [...wantedTags]
  let sentence: string
  if (explicit) sentence = `You named ${list}, so that is the whole folio.`
  else if (fellBack) sentence = `Nothing specific matched, so this is the core large-cap set: ${list}.`
  else if (themes.length) sentence = `Built around ${themes.join(', ')}: ${list}.`
  // A tilt with no theme is a legitimate request ("safe large companies"): say so
  // rather than emitting "Built around : ...".
  else sentence = `A ${tilt} basket: ${list}.`

  if (tilt !== 'balanced' && !explicit && themes.length) sentence += ` Weighted toward ${tilt}.`
  if (excluded.length) sentence += ` Left out ${excluded.map((e) => e.display).join(', ')}.`
  return sentence
}

/** Commitment stored onchain so a folio can always be traced back to what produced it. */
export function hashPolicy(policy: Policy): `0x${string}` {
  const canonical = JSON.stringify(policy, Object.keys(policy).sort())
  return keccak256(toHex(canonical))
}

/**
 * Last line of defence. Any allocator - including a future LLM - must pass through this
 * before its output can reach a transaction.
 */
export function enforceAllowlist(weights: Record<string, number>) {
  const illegal = Object.keys(weights).filter((s) => !ALLOWED_SYMBOLS.includes(s))
  if (illegal.length) throw new Error(`Allocation named assets that are not listed: ${illegal.join(', ')}`)
  const total = Object.values(weights).reduce((a, b) => a + b, 0)
  if (total !== 10_000) throw new Error(`Weights must sum to 10000 bps, got ${total}`)
  return true
}
