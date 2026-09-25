# Submission form answers

Paste these straight into the Stocklana form. Counts checked against the field limits.

## One-liner (253 / 280)

Own real US shares and pre-IPO companies from any currency, without ever feeling like you are using crypto: sign up with an email, describe a portfolio in a sentence, and hold it in a vault on Solana in your own name — fees paid, no seed phrase, no SOL.

## Detailed description (4861 / 5000)

Most people outside the US cannot easily own American shares. Their broker does not offer them, or moving the money takes days and costs more than they will earn. Crypto can do it, but it asks people to learn wallets, seed phrases and gas. Folio does not.

HOW IT WORKS

Sign up with an email, phone or Google account — an embedded wallet is created for you, with no seed phrase to write down. Add stablecoins (USDC, USDT, EURC, PYUSD, IDRX and others) on Solana. Then describe what you want in one sentence: "Apple, Nvidia and the S&P 500", or "AI companies before they go public". Folio reads the sentence into companies and weights, quotes each one live through Jupiter, and shows you the fill against the real share price, the issuer's fees, and the guaranteed worst case before you commit. One confirmation buys the basket into an on-chain vault owned by your own address. Folio pays every network fee, so you never hold SOL.

What you own is a folio: a named basket you can keep, hold shut until a date, or give away with a link that works for someone who has never used crypto. A gift arrives as a sealed envelope with the sender's line on it; the claim key travels in the URL fragment, which browsers never send to a server, so Folio cannot claim, read or resend it.

EXPLORE — FOLIOS OTHER PEOPLE MADE

A folio is private until its owner decides otherwise. Publishing one writes a separate on-chain account holding a single sentence, and the Explore page reads those straight from the chain: the basket, the sentence, its size, what its companies did today, whether it is held shut. Never the owner's other holdings, and never what they paid or made. Copying takes the idea, not the person — you get your own folio, bought at today's prices, in your own name, and nobody is paid for copies. Because every basket stores the hash of the sentence that made it, the chain itself counts how many folios came from one idea. No database, no follower graph, no performance fees.

PUT IT TO WORK

Cash that is waiting earns 4-5% a year through Jupiter Lend. Shares can back a dollar loan on Kamino's xStocks market — up to 73% of value for the S&P 500 — so you can raise cash without selling. Both happen inside Folio, and both show the one number that matters: how far the price can fall before some shares are sold to repay.

HONEST BY CONSTRUCTION

Folio shows the things this industry usually hides: what your fill costs against the exchange price or, for a private company, its last funding round; the 1% the pre-IPO issuer takes on every transfer; dividends, which are not paid in cash but reinvested by raising a Token-2022 scaled-UI multiplier, so your share count grows; the worst fill a purchase will accept before it buys nothing at all; and the fact that the issuers can freeze, pause and even move these tokens, which Folio cannot override. When New York is closed, it says so, because the tokens keep trading when the exchange does not. It never claims a return: there is no cost basis on chain, so every price move is labelled as what the companies did, not what you made.

FOLIO IS ALSO A TOOL

Any Solana wallet can buy a basket through a Blink posted on X or Discord. Any AI agent can list companies, price a basket, build unsigned transactions, read a portfolio and browse the public shelf through a remote MCP server (8 tools, Streamable HTTP). Neither ever receives a key — Folio hands back a transaction for their own wallet to sign.

HOW IT IS BUILT

An Anchor program (folio_vault) holds each basket in vaults owned by the user's address; Folio has no authority to move anything. 22 tests run against the real mainnet Token-2022 program and real xStock mints under LiteSVM, including dividends, splits, locks, gifting and refused early withdrawals. The hand-written instruction encoders are checked against the compiled IDL. The key that sponsors users' fees is fail-closed: it may only appear in whitelisted positions of whitelisted programs, with a simulated spend ceiling, and 25 attack tests cover it. Holdings are read from the chain, never from a Folio ledger.

WHAT IS LIVE WHERE

On mainnet, right now: live prices for 16 companies with the premium over what each tracks, live lending and cash-yield terms, Blinks, the agent server, the pre-IPO pages, and every screen on phone and desktop.

On devnet, deployed and exercised end to end: the vault program, with stand-in companies carrying Apple's real dividend multiplier and SpaceX's 5x split — making a folio, locking it, gifting and claiming it, publishing it to the shelf and taking it down again.

Not done: the mainnet deployment of the program, which needs 1.63 SOL of rent. Everything else is ready for it.

Live app: https://folio-solana.vercel.app
Devnet demo: https://folio-solana-demo.vercel.app
Code: https://github.com/ezekiel6262/folio (Solana work under solana/)
