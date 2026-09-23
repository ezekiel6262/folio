import { keccak256, toHex } from "viem";
import {
  ALLOWED_XLAYER_SYMBOLS,
  MEME_CAP_BPS,
  XASSETS,
  XASSET_BY_SYMBOL,
  type Sleeve,
  type XAsset,
} from "./xlayer-catalog";

/**
 * Turns a sentence into one X Layer folio.
 * Stocks, a Centrifuge sleeve, and a meme sleeve can share the basket.
 * Memes stay inside MEME_CAP_BPS. A locked gift puts its cash sleeve in deJTRSY.
 * The engine only emits symbols from the catalog.
 */

export type XLine = {
  symbol: string;
  display: string;
  name: string;
  sleeve: Sleeve;
  weightBps: number;
  reason: string;
  pairNote?: string;
};

export type XPolicy = {
  version: 1;
  engine: "xlayer-rules-v1";
  prompt: string;
  locked: boolean;
  weights: Record<string, number>;
};

export type XAllocation = {
  lines: XLine[];
  interpretation: string;
  policy: XPolicy;
  policyHash: `0x${string}`;
  settlement: "USDG";
};

const THEMES: Record<string, string[]> = {
  ai: ["ai"],
  chip: ["chips"],
  chips: ["chips"],
  semiconductor: ["chips"],
  ev: ["ev"],
  "electric vehicle": ["ev"],
  space: ["space"],
  rocket: ["space"],
  index: ["index"],
  "s&p": ["index"],
};

const SAFE_WORDS = [
  "safe",
  "safer",
  "mostly safe",
  "university",
  "college",
  "school",
  "treasury",
  "treasuries",
  "conservative",
  "ballast",
];

const CREDIT_WORDS = ["clo", "clos", "credit", "high-yield", "high yield", "corporate bond", "jaaa"];

const NEGATORS =
  /\b(?:no|not|nothing|none|never|without|exclude|excluding|avoid|avoiding|except|minus|skip)\b/gi;

function normalise(text: string) {
  return text.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim();
}

function splitPolarity(text: string) {
  const t = normalise(text);
  const negatives: string[] = [];
  let positive = t;
  for (const m of t.matchAll(NEGATORS)) {
    const start = m.index! + m[0].length;
    const rest = t.slice(start);
    const stop = rest.search(/,|\band\b|\bbut\b|\bwith\b|\bplus\b|\bfor\b|$/);
    const phrase = rest.slice(0, stop === -1 ? undefined : stop).trim();
    if (phrase) negatives.push(phrase);
    positive = positive.replace(t.slice(m.index!, start + phrase.length), " ");
  }
  return { positive: positive.replace(/\s+/g, " ").trim(), negative: negatives.join(" , ") };
}

function hasWord(text: string, word: string) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s/g, "\\s+");
  return new RegExp(`\\b${escaped}\\b`).test(text);
}

function named(text: string, sleeve?: Sleeve) {
  const found = new Set<string>();
  const list = sleeve ? XASSETS.filter((a) => a.sleeve === sleeve) : XASSETS;
  const aliases = list.flatMap((a) => a.aliases.map((alias) => ({ alias, symbol: a.symbol })));
  aliases.sort((a, b) => b.alias.length - a.alias.length);
  for (const { alias, symbol } of aliases) {
    if (hasWord(text, alias)) found.add(symbol);
  }
  return found;
}

function themeTags(text: string) {
  const tags = new Set<string>();
  const keys = Object.keys(THEMES).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (hasWord(text, key)) for (const tag of THEMES[key]) tags.add(tag);
  }
  return tags;
}

function bpsMap(entries: { symbol: string; bps: number }[]) {
  const map = new Map<string, number>();
  for (const e of entries) {
    if (e.bps <= 0) continue;
    map.set(e.symbol, (map.get(e.symbol) ?? 0) + e.bps);
  }
  return map;
}

/** Largest-remainder so integer bps sum to `target`. */
function share(scored: { symbol: string; score: number }[], target: number) {
  const total = scored.reduce((a, b) => a + b.score, 0);
  if (target <= 0 || total <= 0 || !scored.length) return new Map<string, number>();
  const exact = scored.map((s) => ({ symbol: s.symbol, exact: (s.score / total) * target }));
  const floored = exact.map((e) => ({ ...e, bps: Math.floor(e.exact) }));
  let remainder = target - floored.reduce((a, b) => a + b.bps, 0);
  floored
    .map((f, i) => ({ i, frac: f.exact - f.bps }))
    .sort((a, b) => b.frac - a.frac)
    .forEach(({ i }) => {
      if (remainder > 0) {
        floored[i].bps += 1;
        remainder -= 1;
      }
    });
  return bpsMap(floored.map((f) => ({ symbol: f.symbol, bps: f.bps })));
}

function asset(symbol: string): XAsset {
  const a = XASSET_BY_SYMBOL.get(symbol);
  if (!a) throw new Error(`${symbol} is not on the X Layer folio list`);
  return a;
}

export function allocateXLayer(input: { prompt: string; locked?: boolean }): XAllocation {
  const locked = Boolean(input.locked);
  const { positive, negative } = splitPolarity(input.prompt || "");
  const banned = named(negative);

  const wantedStocks = [...named(positive, "stock")].filter((s) => !banned.has(s));
  const wantedMemes = [...named(positive, "meme")].filter((s) => !banned.has(s));
  const memeAsked = wantedMemes.length > 0 || (hasWord(positive, "meme") && !hasWord(negative, "meme"));
  const creditAsked =
    named(positive, "credit").size > 0 || CREDIT_WORDS.some((w) => hasWord(positive, w));
  const safeAsked = SAFE_WORDS.some((w) => hasWord(positive, w)) || named(positive, "treasury").size > 0;
  const satellite = /\ba little\b|\ba bit\b|\bsome\b/.test(positive);
  const university = /\buniversity\b|\bcollege\b|\bschool\b/.test(positive);
  const tags = themeTags(positive);
  const explicitStocks = wantedStocks.length > 0;
  const wantsEquity =
    explicitStocks || tags.size > 0 || /\b(stocks?|shares?|companies|equities|index)\b/.test(positive);

  const stockScores: { symbol: string; score: number; reason: string }[] = [];
  if (explicitStocks) {
    for (const symbol of wantedStocks) {
      stockScores.push({ symbol, score: 1, reason: "you asked for it by name" });
    }
  } else if (wantsEquity || (!safeAsked && !creditAsked && !memeAsked)) {
    for (const s of XASSETS.filter((a) => a.sleeve === "stock")) {
      if (banned.has(s.symbol)) continue;
      const hits = s.tags.filter((t) => tags.has(t));
      let score = hits.length;
      if (safeAsked && (s.tags.includes("quality") || s.tags.includes("index"))) score += 1;
      if (score > 0) stockScores.push({ symbol: s.symbol, score, reason: `matches ${hits.join(", ") || "a steady book"}` });
    }
    if (!stockScores.length && !memeAsked && !creditAsked && !safeAsked) {
      const core = XASSETS.find((a) => a.symbol === "wSPYx")!;
      stockScores.push({ symbol: core.symbol, score: 1, reason: "core index holding" });
    }
  }

  let treasuryBps = 0;
  let creditBps = 0;
  let memeBps = 0;

  const singleSatellite = satellite && wantedStocks.length === 1 && safeAsked;
  if (singleSatellite) treasuryBps = 7500;
  else if (safeAsked && university) treasuryBps = 7000;
  else if (safeAsked) treasuryBps = 4000;
  else if (locked && !explicitStocks) treasuryBps = 2000;

  if (creditAsked && !banned.has("deJAAA")) creditBps = 2000;
  if (memeAsked) memeBps = MEME_CAP_BPS;

  let stockBudget = 10_000 - treasuryBps - creditBps - memeBps;
  if (stockBudget < 0) {
    treasuryBps = Math.max(0, treasuryBps + stockBudget);
    stockBudget = 10_000 - treasuryBps - creditBps - memeBps;
  }
  if (!stockScores.length) {
    if (creditBps > 0 && treasuryBps === 0) creditBps += stockBudget;
    else treasuryBps += stockBudget;
    stockBudget = 0;
  }

  const weights = new Map<string, number>();
  if (treasuryBps > 0) weights.set("deJTRSY", treasuryBps);
  if (creditBps > 0) weights.set("deJAAA", creditBps);

  for (const [symbol, bps] of share(
    stockScores.map((s) => ({ symbol: s.symbol, score: s.score })),
    stockBudget,
  )) {
    weights.set(symbol, bps);
  }

  if (memeBps > 0) {
    const memes = wantedMemes.length ? wantedMemes : ["XDOG"];
    for (const [symbol, bps] of share(
      memes.map((symbol) => ({ symbol, score: 1 })),
      memeBps,
    )) {
      weights.set(symbol, (weights.get(symbol) ?? 0) + bps);
    }
  }

  // Meme-only: the uncapped sleeve is the RWA on the other side of the pool.
  const memeSymbols = [...weights.keys()].filter((s) => asset(s).sleeve === "meme");
  const onlyMemeIntent = memeAsked && !explicitStocks && !safeAsked && !creditAsked;
  if (onlyMemeIntent && memeSymbols.length) {
    const rwa = asset(memeSymbols[0]).pair?.rwa;
    if (rwa) {
      for (const symbol of [...weights.keys()]) {
        if (symbol !== rwa && asset(symbol).sleeve !== "meme") weights.delete(symbol);
      }
      const memeSum = memeSymbols.reduce((a, s) => a + (weights.get(s) ?? 0), 0);
      weights.set(rwa, 10_000 - memeSum);
    }
  }

  const memeSum = [...weights.entries()]
    .filter(([s]) => asset(s).sleeve === "meme")
    .reduce((a, [, bps]) => a + bps, 0);
  if (memeSum > MEME_CAP_BPS) throw new Error(`Meme sleeve is ${memeSum} bps, above the ${MEME_CAP_BPS} cap`);

  const reasonFor = new Map(stockScores.map((s) => [s.symbol, s.reason]));
  const lines: XLine[] = [...weights.entries()]
    .filter(([, bps]) => bps > 0)
    .map(([symbol, weightBps]) => {
      const row = asset(symbol);
      let reason = reasonFor.get(symbol) ?? "included";
      let pairNote: string | undefined;
      if (row.sleeve === "treasury") {
        reason = locked
          ? "Locked gifts keep their cash sleeve in Treasuries."
          : "The safe sleeve is Centrifuge US Treasury exposure.";
      }
      if (row.sleeve === "credit") reason = "Centrifuge AAA CLO sleeve, only because you asked for credit.";
      if (row.sleeve === "meme" && row.pair) {
        reason = `Capped meme sleeve. Quoted against ${row.pair.rwaDisplay} on ${row.pair.dex}.`;
        pairNote = `${row.display}/${row.pair.rwaDisplay} · ${row.pair.dex}`;
      }
      if (row.sleeve === "stock" && onlyMemeIntent) {
        reason = `The real-world asset paired with the meme.`;
      }
      return {
        symbol,
        display: row.display,
        name: row.name,
        sleeve: row.sleeve,
        weightBps,
        reason,
        pairNote,
      };
    })
    .sort((a, b) => b.weightBps - a.weightBps);

  const total = lines.reduce((a, l) => a + l.weightBps, 0);
  if (total !== 10_000) throw new Error(`Weights must sum to 10000 bps, got ${total}`);

  const policy: XPolicy = {
    version: 1,
    engine: "xlayer-rules-v1",
    prompt: input.prompt ?? "",
    locked,
    weights: Object.fromEntries(lines.map((l) => [l.symbol, l.weightBps])),
  };
  enforceXLayerAllowlist(policy.weights);

  return {
    lines,
    interpretation: describe(lines, { locked, onlyMemeIntent, safeAsked }),
    policy,
    policyHash: hashXPolicy(policy),
    settlement: "USDG",
  };
}

function describe(lines: XLine[], flags: { locked: boolean; onlyMemeIntent: boolean; safeAsked: boolean }) {
  const stocks = lines.filter((l) => l.sleeve === "stock").map((l) => l.display);
  const treasury = lines.find((l) => l.sleeve === "treasury");
  const credit = lines.find((l) => l.sleeve === "credit");
  const memes = lines.filter((l) => l.sleeve === "meme");
  const parts: string[] = [];
  if (treasury) parts.push(`${(treasury.weightBps / 100).toFixed(0)}% US Treasuries`);
  if (credit) parts.push(`${(credit.weightBps / 100).toFixed(0)}% AAA CLOs`);
  if (stocks.length) parts.push(stocks.join(", "));
  if (memes.length) parts.push(`${memes.map((m) => m.display).join(", ")} capped at 5%`);
  let sentence = `One folio: ${parts.join("; ")}.`;
  if (flags.locked && treasury) sentence += " The lock keeps the cash sleeve in Treasuries.";
  if (flags.onlyMemeIntent) sentence += " The rest is the tokenized asset the meme is paired against.";
  if (flags.safeAsked && treasury) sentence += " You pay in USDG. You sign the folio. Folio does not hold it.";
  else sentence += " You pay in USDG and sign once.";
  return sentence;
}

export function hashXPolicy(policy: XPolicy): `0x${string}` {
  const canonical = JSON.stringify(policy, Object.keys(policy).sort());
  return keccak256(toHex(canonical));
}

export function enforceXLayerAllowlist(weights: Record<string, number>) {
  const illegal = Object.keys(weights).filter((s) => !ALLOWED_XLAYER_SYMBOLS.includes(s));
  if (illegal.length) throw new Error(`Allocation named assets that are not listed: ${illegal.join(", ")}`);
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  if (total !== 10_000) throw new Error(`Weights must sum to 10000 bps, got ${total}`);
  const meme = Object.entries(weights)
    .filter(([s]) => XASSET_BY_SYMBOL.get(s)?.sleeve === "meme")
    .reduce((a, [, bps]) => a + bps, 0);
  if (meme > MEME_CAP_BPS) throw new Error(`Meme sleeve exceeds ${MEME_CAP_BPS} bps`);
  return true;
}
