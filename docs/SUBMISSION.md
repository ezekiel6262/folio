# Stocklana submission kit

Everything needed to submit before **Friday 25 September, 4:00pm ET**. Copy the text, record
the video, paste the links.

## Links

| Field | Value |
| --- | --- |
| Live app (mainnet prices, Blinks, agents) | https://folio-solana.vercel.app |
| Devnet demo (the program, end to end) | https://folio-solana-demo.vercel.app |
| GitHub | https://github.com/ezekiel6262/folio (Solana work under `solana/`) |
| Program (devnet) | `GJY26YALBaMdimL4Kk4Abo26BNkrSVMrC2wA46TRoXnD` |
| Agents (MCP) | https://folio-solana.vercel.app/api/mcp |
| Example Blink | https://folio-solana.vercel.app/api/actions/basket?s=AAPLx,NVDAx,SPYx |
| Public shelf | https://folio-solana-demo.vercel.app/explore |

## One-liner

Own real US stocks and pre-IPO companies from any currency, without ever feeling like you are
using crypto — and put them to work without leaving the app.

## Short description (for the form)

Folio is a consumer investing app on Solana. You sign up with an email, add stablecoins, and
describe a portfolio in a sentence — "Apple, Nvidia and the S&P 500", or "AI companies before
they go public". Folio buys real tokenized shares into an on-chain vault in your name, shows
everything in your own currency, and pays every network fee so you never hold SOL or see a seed
phrase.

What you own is a **folio**: a named basket you can keep, lock until a date, or give away with a
link that works even if the recipient has never used crypto. Once you own it, your cash can earn
4–5% a year and your shares can back a dollar loan — both inside Folio, without visiting another
protocol.

A folio is private until its owner decides otherwise. Publishing one writes a separate account
holding a single sentence, and the Explore page reads those straight from the chain: the basket,
the sentence, its size, how its companies moved today and when it was made — never the owner's
other holdings, and never what they paid or made. Copying takes the idea, not the person: you get your own folio, bought at today's prices,
in your own name, and nobody is paid for copies. Because a basket carries the hash of the
sentence that made it, the chain itself can say how many folios came from one idea.

Every folio carries its own history, read from the chain rather than from Folio's records, and
each holding shows the dividends already reinvested into it. You can ask to be told when a price
moves, or set an amount to invest on a rhythm; Folio shows both when you open it and never buys
anything you have not confirmed.

It covers listed companies (xStocks) and private ones before IPO (PreStocks), and it is honest
about the parts people usually hide: what your fill costs against the real share price or last
private valuation, the issuer's 1% transfer fee, the dividends reinvested into your share count,
the price at which a loan would liquidate, and the fact that issuers can freeze or move these
tokens.

Folio is also infrastructure: any Solana wallet can buy a basket through a Blink, and any AI
agent can price, build and share one through a remote MCP server. Neither ever hands Folio a key.

## What is live where

Say this plainly in the video and the form; it is the difference between a demo and a lie.

**On mainnet, right now, at the live URL**
- Live prices for 16 companies, with the premium over the real share price or last valuation
- Live lending terms from Kamino's xStocks market and live cash yields from Jupiter Lend
- Blinks, the MCP agent server, the developer page, the eligibility gate
- Every screen, on phone and desktop

**On devnet, deployed and exercised end to end**
- The vault program, with four stand-in companies carrying Apple's real dividend multiplier and
  SpaceX's 5x split
- Making a named folio, locking it, gifting it by link, claiming it from another wallet, and the
  program refusing an early withdrawal
- Publishing a folio to the public shelf, reading it back, and taking it down again — with the
  shelf at /explore showing real listings from real owners

**Not done**
- The mainnet deployment of the program, which needs 1.63 SOL of rent (about $190). Everything
  else is ready for it: `solana/scripts/deploy.sh` and `npm run admin` do it in one sitting.

## Proof on a public cluster (devnet)

| Step | Link |
| --- | --- |
| Folio made, locked a year, gifted | https://explorer.solana.com/tx/3YbFY3gBKUK59oJQBWD3V67f21zWQ1EgVNxjrLR46vyZ94PF1QmjwUP3TyEohhzhkDNv482HujGiBbmW4Q2iqXq2?cluster=devnet |
| Claimed by a second wallet | https://explorer.solana.com/tx/3W5yNopGsTgiDRyN1CdHMGe818Mx2i446jWsJBbFyJ7GJdoJiMPCYJftyjTwgWpaMSGPbiwDrHcds6XHB7AHJBuN?cluster=devnet |
| The folio itself | https://explorer.solana.com/address/2uGNDLx6FQBRRJ5yvm3zmMFmbaCcwXxdVj4NgYUPAeJc?cluster=devnet |
| Put on the public shelf | https://explorer.solana.com/tx/VFMDYxWxCKPJkxHobfcTswCBgLJpBPgxn1Kt6EQFmyRaDzGaxruSLeMjAxAUR4htkRYBDat5T1fLWQrqE5ahva8?cluster=devnet |
| The listing account it wrote | https://explorer.solana.com/address/5V3MSjqqmzhA94AgJddEPfheaF8XrbZirEeDot9SF4bU?cluster=devnet |

Re-run any time with `npx tsx --conditions=react-server scripts/demo-run.ts` from `solana/web`,
and the shelf with `scripts/demo-listing.ts` (`NEXT_PUBLIC_CLUSTER=devnet`).

## Video script (three and a half minutes)

Record at 1440x900 with the sidebar visible. Two browser profiles: one as the giver, one as the
receiver. Speak plainly; let the screen do the work.

**0:00–0:20 — The problem.** On https://folio-solana.vercel.app, signed out.
> "Most people outside the US can't easily own American shares. Their broker doesn't offer them,
> or moving money takes days and costs more than they'll earn. Crypto can do it, but it asks
> people to learn wallets and seed phrases. Folio doesn't."

**0:20–0:50 — Markets, and honesty.** Click Markets.
> "Sixteen companies. Listed ones like Apple, and private ones you can't normally touch —
> OpenAI, SpaceX, Anthropic. Every row shows what the token costs and how far that sits from the
> real thing: Apple within a tenth of a percent of its Nasdaq price, SpaceX 30% below its last
> private valuation. Nobody else shows you that."

Point at the dividends line under a listed company.
> "And dividends aren't paid in cash here — they're reinvested, so your share count grows. Apple
> holders are up 0.33% that way."

**0:50–1:40 — Buying in your own words.** Click New folio, type "AI companies before they go
public", amount 30, show the review screen.
> "I describe what I want. Folio picks the companies, prices each one live, and shows the fill
> against the market, the guaranteed minimum I'll receive, and the issuer's 1% fee. Then I name
> it — 'Ada school fund' — and can lock it until she's eighteen, or send it as a gift."

**1:40–2:20 — The gift, on a real cluster.** Switch to https://folio-solana-demo.vercel.app/demo.
> "Here's the same thing running against a public test network, so you can verify it. I make the
> folio, locked for a year, as a gift."

Show the transaction on Solana Explorer, then open the claim link in the second browser profile.
> "My cousin opens the link. She's never used crypto. She signs up with an email, and the folio
> is hers — locked until the date I chose. If she tries to take the shares out early, the
> program refuses."

**2:10–2:20 — Its own history.** Scroll to "What has happened" on the folio page.
> "Every folio keeps its own history, and each line is a transaction anyone can open. Folio is
> not the only witness to what you own."

**2:20–2:40 — Folios other people made.** Click Explore on the demo.
> "Anyone can put a folio on a public shelf with one sentence. You see what is in it and when it
> was made — never what else that person owns. Copy it and you get your own, bought at today's
> prices, in your own name. Nobody is paid for copies, and the chain itself counts how many
> folios came from the same idea."

**2:40–3:00 — Put it to work.** Back on the live app: Earn, then Borrow.
> "Cash that's waiting earns 4.4% a year. And the shares I own can back a dollar loan — up to
> 73% of value for the S&P 500 — so I can get cash without selling. Folio shows the one number
> that matters: how far the price can fall before some shares are sold to repay."

**3:00–3:30 — It's also a tool.** Show the Developers page and a Blink.
> "Any wallet can buy a basket from a link posted on X. Any AI agent can price, build and share
> one through Folio's agent server. Neither ever gets a key — Folio hands back a transaction for
> their own wallet to sign. The vault program has twenty-two tests against the real mainnet
> tokens, and the part that pays users' fees has twenty-five attack tests."

**Close.**
> "Real shares, in your name, from any currency, without ever feeling like crypto."

## Checklist before submitting

- [ ] Register on hackathons.solana.com and click Submit Project
- [ ] Paste the live URL, GitHub link and video
- [ ] Say in the description which parts are mainnet and which are devnet
- [ ] Mention the PreStocks bounty explicitly (pre-IPO companies are first-class in the app)
- [ ] Do not mention any other pre-IPO issuer: using one disqualifies the PreStocks bounty
