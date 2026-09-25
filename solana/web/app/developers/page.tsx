'use client'

import { useEffect, useState } from 'react'
import { AppHeader, HardRule, Kicker, MonoLabel, Screen, SideNote, Stop } from '@/components/ui'

const TOOLS: [string, string][] = [
  ['list_companies', 'Every listed and pre-IPO company, with price, reference price and premium.'],
  ['plan_basket', 'A sentence or symbols → up to 3 companies, quoted live with guaranteed minimums.'],
  ['build_buy_transactions', "Unsigned transactions that buy the basket into a new folio owned by the agent's wallet."],
  ['get_portfolio', "A wallet's folios, holdings and gifts waiting to be claimed."],
  ['get_folio', 'One folio: owner, lock, holdings.'],
  ['list_public_folios', 'The public shelf: what people published, what it holds and how it moved today.'],
  ['get_yields', 'What cash earns, and what each company can back a loan for.'],
  ['make_buy_link', 'A Blink and web link anyone can use to buy the same basket.'],
]

/**
 * Folio is also infrastructure: the same vaults, prices and basket logic the app uses are
 * open to AI agents (MCP), to any Solana wallet (Blinks) and to other apps (HTTP). None of
 * them hand Folio a key; each returns transactions for the caller's own wallet to sign.
 */
export default function DevelopersPage() {
  const [origin, setOrigin] = useState('https://folio-solana.vercel.app')
  useEffect(() => setOrigin(window.location.origin), [])

  return (
    <>
      <AppHeader />
      <Screen wide>
        <Kicker>Developers & agents</Kicker>
        <h1 className="t-screen mt-4">
          Folio as a <span className="t-serif text-[34px]">tool</span>
          <Stop />
        </h1>
        <p className="t-body mt-5 max-w-[680px]">
          The vaults, live prices and basket builder behind the app are open to AI agents, to any Solana wallet and to
          other apps. Nothing asks for a key: every purchase comes back as a transaction for the caller&apos;s own wallet
          to sign, and lands in an on-chain vault that wallet owns.
        </p>

        <div className="mt-10 lg:grid lg:grid-cols-2 lg:gap-14">
          <section>
            <p className="t-label">01 · AI agents (MCP)</p>
            <HardRule className="mt-2.5" />
            <p className="t-body-sm mt-4">
              Add Folio to Claude, ChatGPT, Cursor or a Clawpump agent as a remote MCP server:
            </p>
            <Code>{`${origin}/api/mcp`}</Code>
            <div className="mt-4">
              {TOOLS.map(([name, what]) => (
                <div key={name} className="border-t border-rule-hair py-2.5 first:border-t-0">
                  <p className="figure text-[12px] text-ink">{name}</p>
                  <p className="t-body-sm mt-0.5">{what}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="mt-12 lg:mt-0">
            <p className="t-label">02 · Blinks</p>
            <HardRule className="mt-2.5" />
            <p className="t-body-sm mt-4">
              A buy button for any basket, on X, Discord and in Solana wallets. Up to three companies by symbol, or copy an
              existing folio:
            </p>
            <Code>{`${origin}/api/actions/basket?s=AAPLx,NVDAx,SPYx&name=Big%20three`}</Code>
            <Code>{`${origin}/api/actions/basket?folio=<folio address>`}</Code>
            <p className="t-body-sm mt-3">
              Wrapped for sharing: <span className="figure text-[11px]">https://dial.to/?action=solana-action:&lt;url above&gt;</span>
            </p>

            <p className="t-label mt-10">03 · HTTP</p>
            <HardRule className="mt-2.5" />
            <div className="mt-2">
              {[
                ['GET /api/market', 'prices, reference prices, premiums, FX, lending terms'],
                ['GET /api/earn', 'what each stablecoin pays, and a wallet’s earning positions'],
                ['GET /api/borrow?folio=&owner=', 'what a folio can back a loan with, and the wallet’s loan'],
                ['POST /api/allocate', '{ prompt } → basket'],
                ['POST /api/plan', '{ displayCode, amountLocal, payWith, weights } → quote'],
                ['GET /api/folio/:address', 'one folio'],
                ['GET /api/folios?owner=', "a wallet's folios"],
              ].map(([route, what]) => (
                <div key={route} className="flex flex-wrap items-baseline justify-between gap-x-4 border-t border-rule-hair py-2.5 first:border-t-0">
                  <span className="figure text-[11.5px] text-ink">{route}</span>
                  <span className="t-body-sm">{what}</span>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="mt-10 max-w-[680px]">
          <SideNote>
            Tokenized stocks and pre-IPO tokens are not available to US persons, and requests from the US are refused.
            Purchases through agents and Blinks use the same allowlist, caps and on-chain vault as the app.
          </SideNote>
        </div>
      </Screen>
    </>
  )
}

function Code({ children }: { children: string }) {
  return (
    <div className="mt-3 bg-ink-void px-4 py-3">
      <MonoLabel className="!text-body-dark">
        <span className="break-all">{children}</span>
      </MonoLabel>
    </div>
  )
}
