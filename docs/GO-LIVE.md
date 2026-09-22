# Folio on Solana: go-live checklist

This is everything needed to run Folio live on Solana mainnet. For each item it says who does
it, whether it's secret, and where it goes.

**Never paste a secret into chat.** Secrets go in the gitignored `folio/.env.solana` file
locally, and in Vercel project settings once the app is deployed.

## 1. Accounts and keys you need to get

| # | What | Where to get it | Secret? | Goes in |
|---|------|-----------------|---------|---------|
| 1 | **Privy App ID** | dashboard.privy.io → create app "Folio" → Settings | No, it's public | `NEXT_PUBLIC_PRIVY_APP_ID` |
| 2 | **Privy App Secret** | Same page | **Yes** | `PRIVY_APP_SECRET` |
| 3 | **Helius API key** | dashboard.helius.dev → API Keys. The free tier works to start; move to a paid plan as traffic grows | **Yes** | `HELIUS_API_KEY` |
| 4 | **Vercel project** | vercel.com → New Project → import `ezekiel6262/folio` → Root Directory `solana/web` | No | n/a |
| 5 | **Domain** (optional) | Any registrar, then add it in Vercel | No | Vercel |
| 6 | **Pyth Pro access** (for the independent price feature) | pyth.network → Pyth Pro. The hackathon bounty includes 3 months | **Yes** | `PYTH_API_KEY` |

### Privy dashboard settings

- **Login methods:** Email, SMS, Google, Apple.
- **Embedded wallets:** Solana on, "create on login" for all users, Ethereum off.
- **Allowed origins:** `http://localhost:3020` and your Vercel URL or domain.
- **Wallet UIs:** you can leave these on. Folio hides Privy's transaction pop-up itself, since Folio's review screen is the confirmation.

## 2. SOL to send (you send it; I never move funds)

Send on the **Solana network** only.

| Wallet | Address | Amount | What it pays for |
|--------|---------|--------|------------------|
| **Deployer** (program owner and admin; its key stays on your PC) | `D3agrnhRwhHuni37ujsHCcmQHGznN8UxwtWwLzZQKq9G` | **2 SOL** | Program rent 1.843 SOL, which comes back if the program is ever closed. Plus about 0.03 SOL for deploy transactions and setting up the 8 stocks |
| **Fee payer** (pays users' network fees and account deposits; the only key on the server) | `J8pwRZ6VjxJ6MWrEVUSK9ThKxkfYP7M9HDqfm2jN1iM5` | **0.5 SOL** to start | About 50 new three-company folios. Top it up as usage grows |

**What each user costs Folio in SOL:**

| Action | Cost | Comes back? |
|--------|------|-------------|
| New folio account | 0.0032 SOL | Yes, when the folio is closed |
| Each stock vault in a folio | about 0.002 SOL | Yes, when the vault is emptied |
| A new three-company folio, all in | about 0.0096 SOL | Mostly, when emptied and closed |
| A sale or withdrawal | about 0.00005 SOL | No, network fee |

## 3. Launch parameters (already set in code; change them before launch if you want)

| Parameter | Value | Where |
|-----------|-------|-------|
| Per-folio cap per stock | 0.5 shares, to limit risk while young | `shared/solana-assets.json`: `vault.stockCapShares` |
| Companies per purchase | 3, so a purchase is one all-or-nothing transaction | `vault.maxCompaniesPerPurchase` |
| Minimum order | $1 | `solana/web/lib/quote.ts` |
| Slippage tolerance | 1% | `lib/quote.ts` `DEFAULT_SLIPPAGE_BPS` |
| Warn when fill is off market by more than | 2.5% | `lib/quote.ts` |
| Most a single sponsored transaction may cost Folio | 0.025 SOL | `lib/cosign.ts` |
| Co-signer rate limit | 12 per minute per IP, and 12 per minute per user | `lib/cosign.ts` |
| Minimum send-out | $1, or $5 to an address new to that coin | `lib/send-out.ts` |
| Region block | United States (xStocks terms) | `app/api/eligibility` |
| Stablecoins accepted | USDC, USDT, PYUSD, USDG, USD1, EURC, IDRX | `shared/solana-assets.json` |
| Stocks | AAPLx, NVDAx, MSFTx, GOOGLx, METAx, AMZNx, TSLAx, SPYx | `shared/solana-assets.json` |

## 4. Launch sequence

| Step | Who | Command or action |
|------|-----|-------------------|
| 1 | You | Get keys 1–3 and put them in `folio/.env.solana` (copy `.env.solana.example`) |
| 2 | You | Send 2 SOL to the deployer and 0.5 SOL to the fee payer |
| 3 | Claude | `bash solana/scripts/deploy.sh`: a preflight check |
| 4 | Claude, **after your go-ahead** | `bash solana/scripts/deploy.sh --send`: deploys the program |
| 5 | Claude | `npm run admin -- init --send`, then `npm run admin -- assets --send` |
| 6 | Claude | `npm run admin -- status`: confirms the program is deployed, set up, not paused, and all 8 stocks are allowed |
| 7 | Claude | Run the app locally against mainnet. First real purchase: about $2 of one stock |
| 8 | You | Push the code (repo is public), create the Vercel project, add the four env vars below |
| 9 | Claude | Real end-to-end run on the live URL: buy, sell, gift, claim, send out |

### Vercel environment variables

- `NEXT_PUBLIC_PRIVY_APP_ID`
- `PRIVY_APP_SECRET`
- `HELIUS_API_KEY`
- `FOLIO_FEE_PAYER_SECRET`: the JSON array from `solana/.keys/fee-payer.json`. Set it as **Sensitive**, and never commit it.

## 5. Emergency controls

- **Pause new money:** `npm run admin -- pause --send`. Buying and new folios stop; withdrawals, sales and claims keep working.
- **Stop fee sponsorship:** remove `FOLIO_FEE_PAYER_SECRET` in Vercel and redeploy.
- **Remove a stock:** set `allowed = false` with `set_asset`. Holdings can still be withdrawn.
