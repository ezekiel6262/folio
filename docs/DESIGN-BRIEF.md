# Folio — design brief

**For:** a ground-up redesign of the entire UI and front end.
**Status of the current build:** working, deployed, deliberately plain. Treat every visual
decision in it as a placeholder, not a constraint.

**The graphics direction is yours to decide.** This brief tells you what must be true,
what must be visible, and what the product means. It does not tell you what it should
look like. Colour, type, grid, motion, illustration, iconography, density, texture,
naming of UI elements — all open.

---

## 1. What the product is

Folio is a consumer brokerage for people who were never given a US brokerage account.

The unit of value is a **folio**: a named, personal, giftable basket of real US stocks,
held onchain in the user's name. You describe a portfolio in a sentence, fund it in the
currency you already live in, and then keep it, lock it until a date, or hand it to
someone else.

> Pay in reais. Describe the portfolio. Keep it, lock it, or send it.

Technically a folio is an ERC-721 — the assets sit in a vault and ownership of the basket
is a token. **The user must never need to know that.** They own "Apple and Nvidia", not
`AAPLc` and `NVDAc`.

The three surfaces are the same object seen from different angles:
- **Buy** — build a folio for yourself.
- **Gift** — build one for someone else, optionally time-locked.
- **Hold** — watch it, add to it, eventually take the assets out.

---

## 2. The one job the design has to do

**Make an unfamiliar financial product feel like an account, not a contract.**

The people this is for have used mobile money and banking apps. They have not used a DEX
and should not have to learn one. If the interface reads as "crypto", the product fails
on its own terms — the pitch is explicitly *not* DeFi, it is *your US stock envelope*.

Two consequences worth designing around:

- **Local currency is the primary number.** Not USD, not token amounts. A Brazilian user
  thinks in reais; the reais figure is the headline and everything else is secondary.
- **A gift must look like a gift.** The claim screen is the growth loop. If it looks like
  a transaction receipt, nobody shares it. It should feel closer to opening an envelope
  than confirming a transfer.

---

## 3. Who is looking at it

| | Who | What they need from the screen |
| --- | --- | --- |
| **Investor** | First-time global investor in São Paulo, Jakarta, Lagos, Mexico City. Wants US stocks, does not want a US brokerage or a ticker screen. | To understand what they are buying and what it costs, in their own money, before committing. |
| **Sender** | A parent, partner or friend funding someone's future. Often older, less technical. | To feel the gift is real and meaningful, and to hand it over in one action. |
| **Recipient** | Receives a link, may have no wallet and no idea what Base is. | To understand what they have been given before they understand anything else. |
| **Merchant** *(roadmap)* | A café replacing loyalty points with a sliver of a real company. | A campaign dashboard. Not in scope now — but the system should not make it awkward later. |

Mobile-first is not a preference here. Assume a mid-range Android phone on a patchy
connection is the primary device.

---

## 4. Screens to design

The information architecture below is proven and worth keeping. Everything about how it
looks and how it is arranged is open.

### 4.1 Eligibility gate — first thing anyone sees
Coinbase tokenized stocks are only for eligible non-US persons. Two states:
- **Attestation** — a checkbox confirming the user is not a US person, and a continue
  action. This is a real screen, not a footer or a cookie banner.
- **Blocked** — shown when the request comes from a US region. Firm, not punitive. It is
  a jurisdictional restriction on the asset, not a judgement about the person.

### 4.2 Door — signed out
Hero, the value proposition, a sign-in action, a live price strip, and a short
how-it-works. This is the only marketing surface; it also has to load fast.

### 4.3 Wallet picker
A sheet offering: **Coinbase Smart Wallet** (passkey, no seed phrase, one-tap purchases),
**any installed browser wallet** (auto-discovered, arrives with its own name and icon —
design for a variable-length list), and **WalletConnect** (only appears when configured).

The smart wallet is meaningfully better — it is the only one that can do the purchase in a
single confirmation and the only one eligible for sponsored gas. It should be visibly the
recommended path without making the others feel broken.

### 4.4 Home — signed in
- **Balance**, in local currency, as the dominant element.
- **Primary action**: build a folio.
- **The user's folios** — each showing name, value in local currency, what is inside, and
  lock/claim status.
- Empty state matters: most users will see it first.

### 4.5 Create — the core flow
Three moments, currently on one scrolling page. Whether that stays one page, a wizard, or
something else is your call.

1. **Compose** — a free-text field ("US tech that builds chips, no ads, for university"),
   example prompts, and an amount with quick-pick presets in the local currency.
2. **Preview** — the most important screen in the product. See §6.
3. **Commit** — name the folio, choose keep vs send, set an optional unlock date, and buy.

### 4.6 Folio detail
Name, total value, lock state, holdings with **share-equivalents**, and — if it was just
created as a claim-link gift — the shareable link, which must be impossible to miss
because the link contains the only key.

### 4.7 Claim card — the gift, received
A recipient lands here from a link, possibly having never used a wallet. They should
understand what they have been given *before* being asked to sign in. Shows the folio
name, its value in their currency, what is inside, and — if locked — that it is already
theirs but unlocks on a specific date.

### 4.8 Roadmap surfaces — do not design, but do not preclude
Recurring/allowance buys, portfolio drift with one-tap rebalance, merchant campaign
dashboards, public folios others can copy. The system you build should have room for these.

---

## 5. Real data to design against

Use these. They are live values, not invented ones. Designing against realistic magnitudes
matters: share counts are small decimals and local-currency figures are large integers, and
both have to sit in the same layout without looking broken.

**Prices** (Chainlink, per share)

| | USD | BRL | NGN | IDR |
| --- | --- | --- | --- | --- |
| Apple | $320.08 | R$ 1,639 | ₦ 423,138 | Rp 5,651,000 |
| NVIDIA | $229.96 | R$ 1,178 | ₦ 304,003 | Rp 4,060,000 |
| Tesla | $353.33 | R$ 1,810 | ₦ 467,092 | Rp 6,238,000 |
| Alphabet | $338.71 | R$ 1,735 | ₦ 447,764 | Rp 5,980,000 |

FX at time of writing: 1 USD = 5.12 BRL = 1,322 NGN = 17,655 IDR.

**A real order.** R$ 150 into a two-name basket produces:
- NVIDIA — 50% — **0.063227 shares** — worst case 0.062594
- SanDisk — 50% — **0.008652 shares** — worst case 0.008566
- Cost to get in 1.82%, network fee about R$ 0.06

Note the shape of that: **people buy fractions**. A holding is `0.0632 shares`, not `12
shares`. Four decimal places is normal and the design must make that feel like ownership
rather than a rounding error.

**Names users give folios:** "Ada school", "Amara 2028", "Shop Regulars", "My first
Apple". Real names, often a person and a year. Design for 2–40 characters.

**Available companies (10 total):** Apple, NVIDIA, Microsoft, Alphabet, Meta, Amazon,
Tesla, MicroStrategy, SanDisk, SpaceX. A folio holds between 1 and 12 of them; typical is
2–7.

**Currencies:** BRL (default), IDR, NGN, EUR, USD.

---

## 6. The preview screen, in detail

This screen is where the product earns trust, and it is the hardest layout problem. It has
to carry all of the following without becoming a spreadsheet:

- **What we understood** — a plain-language restatement of the prompt, e.g. *"Built around
  chips: NVIDIA and SanDisk. Left out Alphabet, Meta."*
- **Each line** — company, why it is there, percentage, cost in local currency, and
  approximate share count.
- **What was excluded and why** — e.g. *"Alphabet — you excluded ads."* This is a feature,
  not an error. It proves the app listened.
- **Cost to get in**, as a percentage.
- **Fill versus reference price** — what the DEX will actually give you compared to the
  Chainlink reference. Users must be able to see they are paying above or below.
- **Network fee** — or "Free" when gas is sponsored.
- **Worst case** — the share count guaranteed if the market moves against them.

A number the user cannot check is a number they should not have to accept. But eight
disclosures stacked in a list is also a failure. Solving this is the central design task.

---

## 7. Non-negotiables

These are correctness requirements. They are not stylistic and cannot be designed away.

1. **Share-equivalents, never raw token counts.** One B20 token is not permanently one
   share — the multiplier moves on dividends and splits. Every quantity shown is
   multiplier-adjusted.

2. **Naira must never look like it is held.** cNGN exists on Base but has zero liquidity,
   so naira is a *display and quoting* currency that settles in USDC. The interface says
   so, plainly, on the balance and in the preview. Do not hide it and do not bury it in
   fine print.

3. **Stale prices must be visible.** Equity feeds freeze on weekends, holidays and during
   corporate actions. **As of writing they are 69 hours stale** — this state will appear in
   a demo. It needs a real design, not an afterthought.

4. **Locked folios are visible the whole time.** A recipient sees "you have R$ x of Apple
   waiting" from day one. The lock is a state, not a hidden object.

5. **The claim link is the only key.** If the sender loses it, the gift is unrecoverable
   until it expires back to them. The moment it is shown deserves real weight.

6. **Two purchase modes.** A smart wallet does the whole thing in one confirmation. Every
   other wallet signs each step — six or more — and needs a progress state naming the
   current step. **A run that stops halfway leaves real tokens in the user's wallet**, and
   that error state must say so clearly and without panic. Design all three: one-tap,
   step-by-step in progress, and stopped halfway.

7. **Eligibility is a screen.** See §4.1.

8. **Not an issuer.** Folio is an interface and a vault. Nothing may imply voting rights,
   redemption rights, guaranteed returns, or brokerage-of-record status.

---

## 8. Copy principles

- Local currency first, USD second, token amounts last or never.
- Company names, never tickers. "Apple", not "AAPLc".
- Plain verbs: *buy, send, keep, claim, unlock*. Not *execute, mint, approve, deposit*.
- Say what happened, not what the system did. "You own Apple and Nvidia" beats
  "Transaction confirmed".
- Errors name the next action. "You need 12 more BRZ to place this order" beats
  "Insufficient balance".
- No exclamation marks in money contexts.

---

## 9. Technical constraints

- **Next.js (App Router) + React + Tailwind.** The redesign must be implementable in this
  stack; a design that needs a different one is out of scope.
- **Mobile-first**, ~375px baseline. Must remain usable up to desktop widths, but phone is
  the design target.
- **No external asset hosting.** Images must be inline SVG, CSS, or embedded data. Web
  fonts are acceptable if self-hosted or from Google Fonts.
- **Light and dark** should both be considered. The current build is light-only; that is
  not a constraint.
- **Accessibility**: real focus states, ≥4.5:1 text contrast, hit targets ≥44px, and no
  meaning carried by colour alone — particularly for gain/loss and lock states.
- **The API surface stays as is.** The redesign changes presentation, not endpoints:
  - `GET /api/prices` — prices, FX, multipliers, staleness
  - `POST /api/allocate` — prompt → weights, exclusions, plain-language interpretation
  - `POST /api/plan` — amount + weights → per-leg costs, shares, fill vs reference
  - `POST /api/build` → `GET /api/folios` → `GET /api/folio/[id]` → `GET /api/paymaster`

---

## 10. Every state that needs designing

Not just the happy path. In rough order of how often users will hit them:

- Loading — prices, folios, a folio, a quote
- Empty — no folios yet, no balance yet
- Prompt matched nothing / matched only one company
- Amount below the minimum (about R$ 5)
- Insufficient balance, with the shortfall named
- Price feed stale
- Thin liquidity warning on a specific line
- Purchase in progress — one-tap versus step-by-step
- Purchase stopped halfway (see §7.6)
- Folio locked / unlocked / awaiting claim / already claimed
- Claim link missing its key
- Jurisdiction blocked
- Vault unreachable

---

## 11. How the result will be judged

The product is being entered into Base's Builder Quest, and the demo is a person, not an
architecture diagram. The design succeeds if this sequence is legible to someone who knows
nothing about crypto:

1. Open Folio. The balance is in their currency.
2. Type a real sentence. See the allocation and the local-currency total.
3. Confirm. They now own Apple and Nvidia, with share counts.
4. Send it to someone, unlocking on a future date.
5. The recipient opens a card that already looks like an account.

If those five steps work without anyone explaining Base, the design is right.

---

## 12. What is explicitly yours to decide

Everything visual and interactive: art direction and mood; colour system; typography;
grid, spacing and density; motion and transitions; illustration or photography, or the
absence of both; iconography; how the brand reads; the shape of the navigation; whether
Create is one page or several; how the preview screen resolves its density problem; how a
gift is made to feel like a gift.

Take a position. A confident direction beats a safe one — the competition is a field of
identical dark-mode dashboards, and this product is deliberately not that.
