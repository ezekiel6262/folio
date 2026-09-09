# Folio

[![CI](https://github.com/ezekiel6262/folio/actions/workflows/ci.yml/badge.svg)](https://github.com/ezekiel6262/folio/actions/workflows/ci.yml)
[![Vault on Basescan](https://img.shields.io/badge/vault-0x907a187c-0052FF)](https://basescan.org/address/0x907a187c1c6f7478141daa6094c02a9f5142f654)
[![License: MIT](https://img.shields.io/badge/license-MIT-black)](LICENSE)

**Pay in reais. Describe the portfolio. Keep it, lock it, or send it.**

Folio is a consumer brokerage whose unit of value is a *named, personal, giftable basket*
of Coinbase tokenized stocks on Base. A folio is an ERC-721: the assets sit in a vault,
and ownership of the basket is a token you can lock, gift, or hand over with a link.

Built for the [Base Builder Quest: Tokenized Stocks](https://www.base.org/stocks).

---

## What is actually live

Every address in [`shared/base-assets.json`](shared/base-assets.json) was read from Base
mainnet, not copied from documentation. `scripts/verify-onchain.mjs` re-checks it.

| Piece | Status |
| --- | --- |
| 10 Coinbase B20 stock tokens | Verified onchain — 8 decimals, multiplier `1.0`, WAD `1e18` |
| Chainlink equity feeds | All 10 live (AAPL $321.76, NVDA $229.96 at time of writing) |
| Execution | KyberSwap aggregator, keyless. Real calldata, one router for all legs |
| Corridors | **BRZ** (0.10% impact, the default), **IDRX**, **EURC**, **USDC** |
| Wallets | Coinbase Smart Wallet (passkey, one tap), any injected wallet, WalletConnect |
| Vault | Live at [`0x907a187c…f654`](https://basescan.org/address/0x907a187c1c6f7478141daa6094c02a9f5142f654) on Base mainnet — 14 passing tests |

### The look, and why it is not a dashboard

The front end was rebuilt from a ground-up design brief ([docs/DESIGN-BRIEF.md](docs/DESIGN-BRIEF.md))
and its round-one output ([docs/design/HANDOFF.md](docs/design/HANDOFF.md)):
**brutalist editorial, monochromatic, one accent.**

Structure is carried by 1px hairlines and 2px hard rules — cards are borders, never
tinted fills. No shadows, no border radius, no images and no icon library: the logo, the
empty-state passbook and every bar and glyph are drawn or set in mono. Archivo for UI,
Instrument Serif for exactly one word per headline, IBM Plex Mono with tabular numerals
for every figure, so a changing price never makes the layout twitch.

The competition for this quest is a field of identical dark-mode dashboards. This is
deliberately not that — it reads like a passbook, because that is what it is.

Two screens carry most of the weight:

**Preview** is an accordion. Eight disclosures — what we understood, per-leg cost and
share count, live price against a dated reference, the gap, the guaranteed worst case,
thin-pool warnings, exclusions with their reasons, and cost against fee — open one leg at
a time, so the summary stays scannable and nothing is hidden.

**Buying** has three real states, because a non-smart wallet cannot batch. One-tap states
the all-or-nothing promise. Step-by-step names every signature with Done / Signing /
Waiting. Stopped part-way says plainly that the filled shares are in the wallet and not in
a folio, and lists exactly how far it got.

### Wallets, and why the button says different things

Only a smart wallet can batch. With a **Coinbase Smart Wallet** the whole purchase —
approve, one swap per leg, one vault approval per leg, `createFolio` — is a single
EIP-5792 confirmation that either lands completely or not at all.

Every other wallet still works. [`lib/use-executor.ts`](web/lib/use-executor.ts) tries
the batch, detects a wallet that cannot do it, and walks the same calls one at a time
with a progress bar naming each step. That path is genuinely worse and the UI says so:
if a sequential run stops halfway, `PartialExecutionError` reports how far it got, and
the user is told their shares are sitting in their wallet rather than in a folio.

WalletConnect appears only when `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is set — a button
that cannot work is worse than no button. Get a free id at reown.com.

### Gas, which is the part that actually blocks people

A passkey login is not the same as the wallet disappearing. Someone in São Paulo holding
BRZ and no ETH cannot sign anything on Base — they have to go acquire a second asset
nobody told them about first. That, not seed phrases, is the real onboarding wall.

Set `PAYMASTER_URL` to a CDP Paymaster endpoint and it goes away: gas is sponsored, the
order preview says **Network fee: Free**, and the user never touches ETH. CDP includes
free monthly Base gas credits, so a demo costs nothing.

The paymaster URL is a spending authority — anyone holding it can bill your budget — so
it is server-only and never reaches the browser. The client talks to
[`/api/paymaster`](web/app/api/paymaster/route.ts), which forwards to the real service
only after [`lib/paymaster.ts`](web/lib/paymaster.ts) decodes the user operation's
`execute` / `executeBatch` calldata and confirms **every** contract it touches is the
vault, the aggregator router, or a listed token. Undecodable calldata is refused rather
than waved through. `scripts/verify-paymaster.mjs` exercises all six cases.

Sponsorship needs the wallet to support it too, so it is offered only to smart wallets —
another reason that path is the one to recommend.

### Why Brazil leads, and what happened to naira

The original pitch led with *"pay in naira."* **cNGN is live on Base but has no DEX
liquidity** — no route to USDC, WETH, or any stock, at any size (verified
`scripts/verify-corridors.mjs`). Total supply is ~1,000,370.

So the default corridor is **BRL/BRZ**, which fills at roughly 0.10% price impact and
executes natively end to end. Naira is still a first-class display currency: Folio
prices and quotes in it and **settles in USDC**, and says so on the balance card and in
the order preview rather than implying it holds naira. The moment a cNGN pool exists,
flip `tradeable: true` in the address book and the corridor goes live with no other
change.

---

## Architecture

```
shared/base-assets.json     Verified address book. Single source of truth.
contracts/
  contracts/FolioVault.sol  ERC-721 basket + escrow + time lock + allowlist + caps
  test/                     14 tests: caps, locks, claims, reclaims, fee-on-transfer
  scripts/deploy.js         Deploys and configures the allowlist, verifies it stuck
web/
  lib/allocator.ts          The Brain. Sentence -> weights. Allowlist-safe by construction
  lib/quote.ts              The Executor. intent -> quote -> slippage bound -> calldata
  lib/prices.ts             Chainlink reference prices + FX, cached
  lib/vault.ts              Builds the single EIP-5792 batch
  app/                      Door, create flow, folio view, claim card
scripts/verify-*.mjs        Live checks against Base. Run these before trusting anything
```

### Three decisions worth defending

**The allocator cannot name an unlisted asset.** It scores the allowlist rather than
generating tickers, so containment is structural, not a prompt instruction. Swapping in
an LLM means implementing the `Allocator` interface and passing through
`enforceAllowlist` — the guarantee lives in the interface, not the model.

**One tap, one batch.** Coinbase Smart Wallet executes approve → swap → swap → approve →
approve → `createFolio` atomically via EIP-5792. The deposit uses each leg's worst-case
output, which is guaranteed to have arrived; positive slippage stays with the user.

**Share-equivalents, not token counts.** One B20 token is not permanently one share. All
displayed quantities apply the live multiplier, so a dividend or split never silently
changes what a holding means.

---

## Running it

```bash
npm --prefix web install
npm --prefix contracts install
```

Verify the chain data before anything else:

```bash
node scripts/verify-onchain.mjs && node scripts/verify-routing.mjs
```

Deploy the vault (needs a funded Base wallet):

```bash
cp contracts/.env.example contracts/.env   # then put your key in it
cd contracts && npx hardhat run scripts/deploy.js --network base
cd .. && node scripts/sync-assets.mjs
```

Run the app:

```bash
npm --prefix web run dev
```

### Safety rails on the deployment

The contract is unaudited, so the deploy script caps each folio at **0.5 shares per
stock** (~$150) and **500 units per stablecoin**. Raise them with `setAsset` once you
trust it. `pause()` stops new folios but **cannot** block withdrawals — an admin must
never be able to trap a user's assets inside their own folio.

---

## Eligibility

Coinbase tokenized stocks are for eligible persons outside the US. Folio checks the
request country server-side and blocks US regions outright, then asks for an explicit
attestation. It is a screen, not a footer.

Folio is an interface and a vault. It is not an issuer, a broker, or a price oracle, and
grants no voting or redemption rights beyond what the token itself carries.
