"use client";

import { useState } from "react";
import Link from "next/link";
import { AppHeader, HardRule, Kicker, MonoLabel, Screen, Stop } from "@/components/ui";
import type { XAllocation, XLine } from "@/lib/xlayer-allocator";

const EXAMPLES = [
  "University fund, mostly safe, a little NVIDIA",
  "Safe large companies",
  "AAA CLOs and treasuries",
  "XDOG",
];

const SLEEVE_LABEL: Record<XLine["sleeve"], string> = {
  stock: "Stocks",
  treasury: "Treasuries",
  credit: "Credit",
  meme: "Meme sleeve, capped",
};

export default function XLayerPage() {
  const [prompt, setPrompt] = useState(EXAMPLES[0]);
  const [locked, setLocked] = useState(true);
  const [plan, setPlan] = useState<XAllocation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function build() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/xlayer/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt, locked }),
      });
      const body = (await res.json()) as { allocation?: XAllocation; error?: string };
      if (!res.ok || !body.allocation) throw new Error(body.error || "The folio could not be built");
      setPlan(body.allocation);
    } catch (e) {
      setPlan(null);
      setError(e instanceof Error ? e.message : "The folio could not be built");
    } finally {
      setBusy(false);
    }
  }

  const groups = plan
    ? (["treasury", "credit", "stock", "meme"] as const)
        .map((sleeve) => ({ sleeve, lines: plan.lines.filter((l) => l.sleeve === sleeve) }))
        .filter((g) => g.lines.length)
    : [];

  return (
    <>
      <AppHeader />
      <Screen>
        <Kicker>X Layer · one folio</Kicker>
        <h1 className="t-display mt-4">
          Stocks, Treasuries,
          <br />
          one <span className="t-serif text-[44px]">envelope</span>
          <Stop />
        </h1>
        <p className="t-body mt-5">
          Describe the basket. A locked gift keeps its cash in Centrifuge US Treasuries. A meme can sit inside,
          capped at 5%, next to the tokenized asset it is paired against. You pay in USDG and you sign. Folio does
          not hold the assets.
        </p>
        <p className="t-disclaimer mt-3">
          <Link href="/">Base folios</Link> stay on Coinbase stocks. This page is the X Layer basket.
        </p>

        <label className="mt-8 block">
          <MonoLabel>The sentence</MonoLabel>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            className="mt-2 w-full border border-ink bg-transparent p-3 font-sans text-[16px] text-ink outline-none"
          />
        </label>
        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              className="border border-ink px-2 py-1 font-mono text-[10px] uppercase tracking-monolabel"
              onClick={() => setPrompt(example)}
            >
              {example}
            </button>
          ))}
        </div>
        <label className="mt-4 flex items-center gap-2 font-sans text-[15px]">
          <input type="checkbox" checked={locked} onChange={(e) => setLocked(e.target.checked)} />
          Lock the gift. Cash sleeve stays in Treasuries.
        </label>
        <button
          type="button"
          className="mt-5 border-2 border-ink bg-ink px-4 py-3 font-sans text-[15px] font-bold uppercase tracking-[0.04em] text-ground"
          disabled={busy}
          onClick={build}
        >
          {busy ? "Building" : "Build the folio"}
        </button>
        {error ? <p className="mt-3 font-sans text-[14px] text-accent">{error}</p> : null}

        {plan ? (
          <div className="mt-8">
            <HardRule />
            <p className="t-body mt-4">{plan.interpretation}</p>
            <p className="t-disclaimer mt-2">Settles in USDG. Policy {plan.policyHash.slice(0, 10)}…</p>
            {groups.map((group) => (
              <section key={group.sleeve} className="mt-6">
                <MonoLabel>{SLEEVE_LABEL[group.sleeve]}</MonoLabel>
                {group.lines.map((line) => (
                  <div key={line.symbol} className="border-t border-rule-mid py-3">
                    <div className="flex items-baseline justify-between gap-4">
                      <strong className="font-sans">{line.display}</strong>
                      <span className="figure">{(line.weightBps / 100).toFixed(2)}%</span>
                    </div>
                    <p className="t-disclaimer mt-1">{line.reason}</p>
                    {line.pairNote ? <p className="t-disclaimer">{line.pairNote}</p> : null}
                  </div>
                ))}
              </section>
            ))}
            <p className="t-disclaimer mt-6">
              Minting the envelope on X Layer needs the Folio vault deployed there. This page builds the basket and
              the policy hash the vault stores. It does not move tokens.
            </p>
          </div>
        ) : null}
      </Screen>
    </>
  );
}
