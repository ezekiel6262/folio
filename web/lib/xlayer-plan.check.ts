import { allocateXLayer } from "./xlayer-allocator";

function weights(prompt: string, locked = false) {
  const plan = allocateXLayer({ prompt, locked });
  const sum = plan.lines.reduce((a, l) => a + l.weightBps, 0);
  if (sum !== 10_000) throw new Error(`${prompt} summed to ${sum}`);
  const meme = plan.lines.filter((l) => l.sleeve === "meme").reduce((a, l) => a + l.weightBps, 0);
  if (meme > 500) throw new Error(`${prompt} meme sleeve ${meme}`);
  return Object.fromEntries(plan.lines.map((l) => [l.symbol, l.weightBps]));
}

function eq(actual: Record<string, number>, expected: Record<string, number>, label: string) {
  const keys = new Set([...Object.keys(actual), ...Object.keys(expected)]);
  for (const key of keys) {
    if ((actual[key] ?? 0) !== (expected[key] ?? 0)) {
      throw new Error(`${label}\n  got ${JSON.stringify(actual)}\n  want ${JSON.stringify(expected)}`);
    }
  }
  console.log("ok", label);
}

eq(weights("University fund, mostly safe, a little NVIDIA", true), { deJTRSY: 7500, wNVDAx: 2500 }, "university satellite");
eq(weights("Only NVIDIA", true), { wNVDAx: 10000 }, "named stock stays whole when locked");
eq(weights("XDOG"), { XDOG: 500, wSPCXx: 9500 }, "meme capped against its RWA pair");
eq(weights("AAA CLOs and treasuries"), { deJAAA: 2000, deJTRSY: 8000 }, "credit and treasury, no stocks");

const safe = weights("Safe large companies");
if (safe.deJTRSY !== 4000) throw new Error(`safe book treasury ${safe.deJTRSY}`);
if (safe.wNVDAx || safe.XDOG) throw new Error(`safe book picked a growth name or a meme ${JSON.stringify(safe)}`);
console.log("ok", "safe large companies keep a treasury sleeve");
console.log("xlayer plan checks passed");
