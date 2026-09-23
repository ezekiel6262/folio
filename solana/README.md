# Folio on Solana

Own real US shares from any currency, without ever feeling on-chain.

Sign up with an email, phone, Google or Apple account and you have an account. Add stablecoins,
describe a portfolio in one sentence ("Apple, Nvidia and the S&P 500"), and own tokenized shares
held in a vault in your name. Everything is shown in your own currency. Keep a folio, lock it
until a date, or give it to someone with a link. Folio pays every network fee, so the account
never needs SOL.

## The loop

| Step | What the user sees | What happens |
| --- | --- | --- |
| Sign up | Email / phone / social | Privy creates an embedded Solana wallet. No seed phrase, no extension. |
| Add money | An address and "Solana network only" | Any of USDC, USDT, PYUSD, USDG, USD1, EURC, IDRX. |
| Buy | A sentence, an amount in their currency, a review screen | Up to three companies bought in one all-or-nothing transaction. |
| Hold | Value in NGN, BRL, INR, EUR… | Vault balances × live Token-2022 multiplier × Jupiter price. |
| Sell | "Sell half for ₦…" | Withdraw from the vault and swap to USDC in one transaction. |
| Send out | An address and an amount | A stablecoin transfer, fee paid by Folio. |
| Earn | "Your cash earns 4.4% while it waits" | Idle stablecoins are lent through Jupiter Lend; the receipt stays in the user's wallet. |
| Borrow | "Get cash without selling" | Shares leave the vault, back a loan on Kamino's xStocks market, and USDC comes back. |
| Give | A name, a date, a link | The folio is escrowed; whoever opens the link claims it. |

## How it is built

```
programs/folio_vault   Anchor 1.2 program: folios, vaults, locks, claim links
web                    Next.js 15 app, Privy embedded wallets, server-built transactions
scripts                Fixture cloner for the on-chain tests
```

**Stocks.** xStocks by Backed: Token-2022, 8 decimals, with a live `scaledUiAmountConfig`
multiplier that is applied everywhere a share count is shown.

**Buying.** For each company, Jupiter swaps the user's stablecoin and pays the output
*straight into the folio's vault* (`destinationTokenAccount`). Then `sync_vault` records what
arrived and enforces the per-asset cap, or the whole transaction reverts. There is no
intermediate balance in the user's wallet and no dust. Creating the folio and buying three
companies fit in one v0 transaction, about 1,140 of 1,232 bytes.

**Folios.** A folio is a PDA holding one vault per stock, with:
- an owner
- an optional unlock date
- an optional claim key
- a policy hash, the sha256 of the allocation the user reviewed

Withdrawals need the owner's signature and a passed lock. Pausing the program stops new money
coming in, but never stops anyone reaching money already there.

**Gifts.** A claim link carries an ephemeral **signing key** in the URL fragment. That key is
generated in the browser and never reaches a server. Claiming needs a signature from that key,
so a validator watching the mempool cannot front-run it. A creator can take back an unclaimed
gift after a date they chose.

**Gasless.** Folio's fee payer co-signs transactions the user has already signed. The
co-signer (`web/lib/cosign.ts`) fails closed and applies these rules:

1. The fee payer is Folio's, and every other signer has already signed.
2. Only allowlisted programs are used. The System program is excluded, so no top-level SOL
   transfers.
3. There are no authority changes, and a token account may be closed only if its deposit
   refunds Folio.
4. The fee payer may appear only as an account-creation funder, as our program's `payer`, or
   as a refund recipient.
5. Priority fees and account creations are capped.
6. Folio simulates the transaction and refuses it if it would cost more than 0.025 SOL,
   whatever the instructions are.

`npm run check:cosign` runs 18 crafted attack and allowed cases against rules 1–5.

**Prices.** Prices come from Jupiter's price API. The app labels them as market prices, not as
an independent reference. Solana has no keyless, independent equity oracle today. Every review
screen shows the fill against the market price and the guaranteed minimum.

## What the issuer can do

Every xStock has a freeze authority, can be paused, and has a **permanent delegate**. That
means Backed can move tokens even out of a Folio vault. The app says so on every folio. Folio
itself cannot move anyone's shares. xStocks are not available to US persons.

## Running it

```bash
# program (WSL / Linux)
cd solana && cargo build-sbf
FOLIO_SO=target/deploy/folio_vault.so cargo test -p folio_vault

# app
cp ../.env.solana.example ../.env.solana   # fill in Privy App ID/Secret and a Helius key
cd web && npm install --legacy-peer-deps && npm run dev   # http://localhost:3020
```

Program: `GJY26YALBaMdimL4Kk4Abo26BNkrSVMrC2wA46TRoXnD`
