# Handoff: Folio — gift-and-hold investing app (v2)

## Overview
Folio lets someone outside the US describe a portfolio in one sentence, buy it in their own currency, hold it in their own name, and hand it to someone else as a gift. This bundle covers the full v2 prototype: 19 mobile screens spanning eligibility, sign-in, composition, purchase (two wallet paths), ownership, gifting, recurring buys, drift, lock/vesting, custody proof, partial-fill recovery, and a transaction passbook.

## About the Design Files
The files in this bundle are **design references created in HTML** — prototypes showing intended look and behaviour, not production code to copy directly. The task is to **recreate these designs in the target codebase's existing environment** (React, React Native, SwiftUI, native Android, whatever is in use) using its established patterns, component library, and routing. If no environment exists yet, choose the most appropriate framework and implement the designs there.

`Folio v2.dc.html` is a single-file prototype: it renders a phone-sized frame plus a screen-picker strip that is **prototype scaffolding only** (the black/grey numbered tab bar and the italic hint line at the bottom). Neither ships. Everything inside the 390×812 frame is the product.

## Fidelity
**High-fidelity.** Colours, type, spacing, borders, copy, and interaction states are final and should be matched precisely. Copy in particular is deliberate — it is regulatory- and trust-sensitive and should not be paraphrased.

---

## Design language (read before building anything)

Brutalist editorial, monochromatic, one accent.

- **Ground** `#fcfcfc` (screen), `#f3efef` (inset panels, page behind the frame), `#ffffff` (input fills).
- **Void ground** `#080808` for refusals, warnings, and sealed states. On the void ground the accent lightens (see Colours).
- **Rules, not fills.** Structure is carried by 1px `#d8d8d8` hairlines and 2px `#111111` hard rules. Cards are borders, never tinted backgrounds. No shadows anywhere. No border radius anywhere — every corner is square, including inputs, buttons, badges, checkboxes.
- **One accent.** Ink blue, used only for: kickers, terminal periods on headlines, the current step, claim/receipt frames, the active nav marker, and error dots. It is never a large fill except the "Best" badge and hover states of primary buttons.
- **Terminal period motif.** Headlines end with an accent-coloured `.` or `?` — e.g. `KEEP FEEDING IT<span accent>.</span>`. It also closes the wordmark: `FOLIO.`
- **Serif punctuation.** Exactly one word or short phrase per headline may be set in Instrument Serif italic at a slightly larger size (e.g. "pay in *reais*", "these *shares*"). Never more than one per headline.
- **Figures are mono.** Every number, address, date, percentage, ticker and metadata label uses IBM Plex Mono with `font-feature-settings: 'tnum'`.

### Logo
Square 20×20 viewBox: `rect x=1 y=1 w=18 h=18` stroked `#111111` at 2px, plus `rect x=9 y=0 w=2 h=20` filled accent — an accent spine cutting the sheet edge to edge (a folio = a folded sheet, two leaves). Rendered at 18px in the prototype header, 16px in in-app headers. Wordmark: Archivo 700, 15px, `letter-spacing: 0.04em`, uppercase, followed by an accent period.

---

## Design Tokens

### Colours
| Token | Hex | Use |
| --- | --- | --- |
| ink | `#111111` | Text, hard rules, primary button fill |
| ink-void | `#080808` | Refusal / warning / sealed grounds |
| ground | `#fcfcfc` | Screen background |
| ground-inset | `#f3efef` | Panels, code blocks, page behind the frame |
| white | `#ffffff` | Input fills, checkbox interiors |
| accent | `#1a2fd6` | The single accent, on light grounds |
| accent-on-dark | `#8f9dff` | The same accent on `#080808` / `#111111` (contrast) |
| text-secondary | `#333333` | Body copy |
| text-tertiary | `#5a5858` | Supporting copy, inactive labels |
| text-quaternary | `#8a8a8a` | Mono labels, notes, disclaimers |
| rule-hair | `#d8d8d8` | 1px dividers |
| rule-mid | `#b5b2b2` | Dividers on inset panels |
| track | `#e4e0e0` | Progress / drift bar tracks |
| dark-hair | `#2a2929` | Dividers on the void ground |
| ghost | `#171617` / `#161516` | Oversized ghost letterforms on void ground |
| dark-body | `#d4d2d2` | Body copy on void ground |

**Contrast rule:** accent `#1a2fd6` is only legible on light grounds. Any accent glyph sitting on `#111111` or `#080808` must switch to `#8f9dff`. This applies to the active nav tab's step number, terminal periods on dark headlines, and inline highlights inside dark banners.

### Typography
- `Archivo` 400/500/700 — UI, headlines, buttons.
- `Instrument Serif` 400 + italic — one accent word per headline, pull quotes, reassurance passages.
- `IBM Plex Mono` 400/500 — all figures, labels, metadata, addresses.

| Role | Spec |
| --- | --- |
| Display headline | Archivo 700, 40px / 0.98, `-0.04em`, uppercase |
| Screen headline | Archivo 700, 30–34px / 1.0–1.04, `-0.035em`, uppercase |
| Section headline | Archivo 700, 26–27px / 1.02, `-0.035em`, uppercase |
| Serif accent word | Instrument Serif italic, headline size +4px, `-0.01em`, not uppercase |
| Serif pull quote | Instrument Serif 400, 24–25px / 1.2–1.24 |
| Serif reassurance | Instrument Serif 400, 17–20px / 1.35–1.45 |
| Card / list title | Archivo 700, 13–14px, `0.06em`, uppercase |
| Section label | Archivo 700, 12px, `0.16em`, uppercase |
| Kicker | IBM Plex Mono 400, 10px, `0.18em`, uppercase, accent |
| Mono label | IBM Plex Mono 400, 10px, `0.14em`, uppercase, `#8a8a8a` |
| Body | Archivo 400, 13.5–14.5px / 1.6, `#333333` |
| Body small | Archivo 400, 12.5–13px / 1.5–1.6, `#5a5858` |
| Disclaimer | Archivo 400, 11–11.5px / 1.6, `#8a8a8a` |
| Big figure | IBM Plex Mono 500, 40–46px / 1, `-0.03em`, tnum |
| Mid figure | IBM Plex Mono 500, 22–26px, `-0.02em`, tnum |
| Table figure | IBM Plex Mono 400/500, 11.5–13px, tnum |
| Button label | Archivo 700, 11.5–13px, `0.12–0.14em`, uppercase |

### Spacing & sizing
- Screen padding: 20px horizontal in chrome-headed screens, 24px in full-bleed statement screens; 26–40px top, 26–34px bottom.
- Vertical rhythm between blocks: 18 / 22 / 26px. Hairline-separated list rows: 10–16px vertical padding.
- Radius: **0** everywhere.
- Primary button: full width, min-height 52px (54px on the two most consequential actions). Secondary: min-height 46px. Icon/back buttons: min 32×32 with negative margin so the visual position is flush. All tap targets ≥44px.
- Phone frame: 390×812, 2px `#111111` border, 28px status strip (mono 10px), 24px home-indicator strip with a 110×3px black bar.

### Motion
- `folio-rise`: `opacity 0→1`, `translateY(14px)→0`, 320–340ms `cubic-bezier(0.2,0.8,0.2,1)`. Applied on every screen enter.
- `folio-sheet`: `translateY(100%)→0`, 280ms, same easing. Bottom sheets only (wallet picker).
- `folio-spin`: 900ms linear infinite, on a 34px ring with `border: 1px solid #d8d8d8` and `border-top-color: accent`.
- List rows shift right on hover: `padding-left: 0→12px`, 260ms, same easing, plus `background: #f3efef`.
- Primary buttons on hover: background and border both to accent.
- Secondary/ghost on hover: border and text to accent.

### Focus & selection
`input:focus, textarea:focus, button:focus-visible { outline: 1px solid #1a2fd6; outline-offset: 3px; }` · `::selection { background: #1a2fd6; color: #fcfcfc; }` · `::placeholder { color: #8a8a8a; }` · links: accent, underlined at 3px offset, hover to `#111111`.

---

## Screens

Order below matches the prototype's numbered picker.

### 01 Gate — eligibility
Statement screen, no chrome. Kicker "01 · BEFORE WE BEGIN". Headline "WHO MAY HOLD THESE *shares*." Two body paragraphs explaining the restriction is a property of the asset, not a judgement. A single attestation row bounded top and bottom by 1px `#111111` rules: 20×20 square checkbox (1px border, white fill, 10×10 accent square when checked) beside the attestation sentence; the whole row is the hit target. Continue (primary) is **disabled until checked**. A ghost link below opens the blocked state.

### 02 Blocked — refusal
Void ground. A 210px Instrument Serif italic "us" bleeds off the bottom-right at `#171617`, `user-select: none`, decorative. Kicker "NOT AVAILABLE HERE" in `#8f9dff`. Headline in white with an `#8f9dff` terminal period. Copy states nothing was charged and no account exists, then offers the VPN/travel explanation. Single outlined white button "TRY AGAIN".

### 03 Door — the only marketing surface
In-app header (logo left, currency chip right, 2px bottom rule). Display headline "OWN APPLE. PAY IN *reais*." Primary "SIGN IN". Then an inset `#f3efef` price strip bounded by 1px rules: label "REFERENCE PRICES" and an accent-outlined staleness stamp ("69h old"); four ticker rows (name left, mono price right, `#b5b2b2` hairlines); a note naming the Chainlink feed. Then "HOW IT WORKS" — three numbered rows with accent mono numerals — and a legal paragraph: Folio is an interface and a vault, not a broker.

### 04 Wallet picker — bottom sheet
Scrim `rgba(8,8,8,0.62)`, sheet on `#fcfcfc` with 2px top rule, entering with `folio-sheet`. Recommended option is an accent-bordered `#f3efef` block carrying a solid accent "BEST" badge (white text). Below, "WALLETS ON THIS DEVICE" — a variable-length list of hairline-separated rows, each with a 26px square initial tile, name, mono note ("Browser extension · 6 signatures"), and an accent ↗. Closing paragraph explains other wallets sign every step separately and cannot have the fee covered.

### 05 Home
Header with logo, an empty-state toggle (prototype affordance — remove in production), currency chip. Balance block: mono label "READY TO INVEST", 44px mono figure, USD equivalent line. When the currency has no on-chain market, an accent left-bordered note explains settlement happens in USDC. Primary "BUILD A FOLIO". Below, "YOUR FOLIOS" with a mono count and two folio rows (name, mono value, contents line, and a status badge — accent-outlined for locked, grey for unlocked). Empty state: a 104×130 drawn passbook (1px border, 6px accent spine, four `#b5b2b2` rules), headline "NOTHING HERE YET.", and two explanatory paragraphs.

### 06 Compose — 01/03
Chrome header with back, title "NEW FOLIO", accent mono step "01 / 03 DESCRIBE". Headline "WHAT SHOULD IT HOLD?" Textarea, 1px `#111111`, white fill, min-height 96px. Four example chips. Hard rule. "HOW MUCH" with a min-amount note; the amount is a borderless mono 38px input with a grey currency symbol, sitting on a 2px bottom rule. Four preset buttons in a hairline-bordered strip that invert to black on hover. Two error blocks — below minimum, and above balance — each a 1px accent box with an accent bullet, naming the next action ("Raise the amount", "Add money or lower the amount"). Continue is disabled while either fires.

### 07 Preview — 02/03
Optional stale-price banner on the void ground with the highlight in `#8f9dff`. "WHAT WE UNDERSTOOD": an Instrument Serif 25px plain-language read of the sentence, then "YOU SPEND" + mono figure. Then per-leg rows: name, weight, mono cost and share count, a one-line reason, and a disclosure toggle rendered as an accent-outlined "More +" that becomes a solid accent "Close —". Expanded, the leg shows a 2px accent left-bordered mono block: live market price, reference price with its age, the gap ("+0.78% over ref") in accent, and a hairline-separated guaranteed worst case. Thin pools get an accent-bordered warning. Then "LEFT OUT, ON PURPOSE" (name / reason rows), a two-cell 1px bordered box for "COST TO GET IN" (1.82%) and "NETWORK FEE", and a share-equivalents explanation. Primary "THIS LOOKS RIGHT", secondary "CHANGE THE WORDING".

### 08 Commit — 03/03
Name input: Archivo 700 24px uppercase on a 2px bottom rule, with a mono `nn/40` counter. "WHO IS IT FOR": two radio rows (16px square, 8px accent fill) — Keep it / Send it to someone. Choosing Send reveals an accent-bordered `#f3efef` panel with an optional unlock date input and the line "It is theirs from the moment you send it." A four-row mono summary (You pay / You get / Cost to get in / Network fee) sits above the primary CTA, whose label carries the amount ("BUY AND SEND · R$ 150,02"). A ghost link starts the six-signature path instead.

### 09 Buying — three modes
- **One-tap:** spinner, headline "BUYING YOUR FOLIO.", the all-or-nothing promise, and a mono line with the amount and folio name. Resolves to Detail after 2.6s.
- **Step-by-step:** accent mono "STEP 03 OF 06", the current step as the headline, then six hairline rows — mono index, label, mono note, and a right-aligned status of Done / Signing / Waiting. Colours: done `#111111`, current accent, pending `#8a8a8a`. A footer notes a smart wallet would do all six in one tap. Advances every 1.1s.
- **Stopped:** "THREE OF THE SIX STEPS WENT THROUGH." Explains the filled part is real and the shares are in the wallet, not the folio. A 1px bordered box lists what is in the wallet right now and the unspent amount. Two actions: carry on from step 04, or leave it.

### 10 Detail — a folio you own / sent
Header, then kicker, folio name at 32px, 40px mono value, mono metadata line, and a black status chip ("WAITING TO BE CLAIMED · UNLOCKS 12 MAR 2028"). The claim link gets its own 2px accent-framed plate: kicker "HAND THIS OVER", Instrument Serif "This link is the only *key*.", a warning that whoever opens it can claim it, the URL in a mono `#f3efef` code block, and two buttons — copy (label flips to "LINK COPIED" for 2s) and preview. Below, "WHAT IS INSIDE" holdings rows and the custody disclaimer.

### 11 Claim — recipient, unsealed
Certificate on `#f3efef`: a `#fcfcfc` card with 2px `#111111` border and a 6px accent bar bleeding across the top. Kicker "SET ASIDE FOR YOU", "FROM MÃE", 34px name, hard rule, "WORTH TODAY" + 46px mono figure, holdings rows, then a void-ground band with "It is already yours." in `#8f9dff`. Closes on an Instrument Serif reassurance paragraph. CTA "MAKE IT MINE" plus a one-minute expectation note.

### 12 Repeat — standing order
Header right slot shows "RUNNING" or "NOT SET UP". Headline "KEEP FEEDING IT." Amount: three preset buttons, selected one inverted to black. "WHEN": three radio rows (Every week / Every payday / Every month) with notes; changing cadence recomputes "NEXT THREE" — three mono date/amount rows. A paragraph states short balances are skipped, never borrowed, and that share counts differ each time. Off state: primary "START THE STANDING ORDER". On state: a void-ground band ("Running. Next buy 08 Oct.") above a secondary "STOP IT".

### 13 Drift
Instrument Serif read: "You asked for chips, evenly. It has quietly become *mostly NVIDIA*." Per holding: name, mono current weight with an accent drift figure (`+8.4pp` / `−8.4pp`), then a 10px `#e4e0e0` track with a black fill at the actual weight and a 2px accent tick at the target, overhanging the track by 4px top and bottom. Target and share count in a mono caption. A 1px bordered "BRINGING IT BACK" box: sell / buy / costs. A paragraph names the tax consequence and states drift is not a fault. An 18px square checkbox sets auto-rebalance at 10pp. Primary "BRING IT BACK", secondary "LEAVE IT AS IT IS".

### 14 Campaign — merchant-funded claim
The Claim plate with a funder in the frame. Kicker "FUNDED BY PAYSTACK", headline "₦10,000 TO START YOU OFF.", copy stating it is a real purchase in the recipient's name, not credit or points. Four mono term rows (Funded / Claim by / Buys / Yours). Last line states what the funder is told: only that it was claimed — not the name, wallet, or holdings. CTA "CLAIM IT", ghost "LOOK AROUND FIRST".

### 15 Sealed — scheduled gift before its date
Void ground with a 200px italic ghost "wait". Kicker "SEALED UNTIL 12 MAR 2028" in `#8f9dff`. A 74px square seal: 2px white border with a 2px `#8f9dff` bar through its centre. Headline "MÃE LEFT THIS FOR YOU." followed by the giver's note in Instrument Serif 20px. A two-column band bounded by `#2a2929` rules: "OPENS IN" (days) and "WORTH TODAY" (amount) in 26px mono. An outlined white button toggles a peek at the holdings (`#2a2929` hairline rows). Footer: "It is already yours and it is already invested — the seal only holds the opening, not the money."

### 16 Locked — vesting
Locked: a void-ground band "LOCKED until 12 MAR 2028" with the word in `#8f9dff`. Unlocked (after breaking): a `#f3efef` band, accent "The lock is off.", noting it cannot be put back. Body: 40px mono value, contents line, a 10px term progress bar (black fill on `#e4e0e0`) with mono start and end dates beneath. "WHILE IT IS LOCKED" — four hairline rows, each with a mono mark: `+` in `#111111` for what is allowed, `−` in accent for what is not. Breaking is two-step: a ghost link "BREAK THE LOCK EARLY" reveals a 2px bordered panel headed "READ THIS TWICE", explaining permanence and that nothing is sold, with "BREAK IT — I UNDERSTAND" and "KEEP IT LOCKED".

### 17 Proof — custody receipt
A 2px bordered plate with the 6px accent top bar. Kicker "CUSTODY RECEIPT", folio name, Instrument Serif "Held in a vault in your name. Anyone can check this — *no one has to take our word*." Eight mono rows: Owner, Vault, Chain, Holdings (two lines), Custodian, Block, Stamped. Full transaction hash in a `#f3efef` mono block, `word-break: break-all`. Buttons: copy the receipt (label flips on copy) and open on Base ↗. Footer names the regulated custodian and states Folio cannot move the assets — only the owner address can.

### 18 Partial — partial fill recovery
"THREE OF FOUR WENT THROUGH." Copy: the market moved in flight; three legs filled inside the worst case, one did not, so it was not bought at a price never agreed to. "FILLED" — three hairline rows with share counts and "inside worst case". Then a void-ground block "NOT FILLED": SanDisk, its amount, and a mono explanation that the pool moved 2.1% past the worst case and the money was never spent. A 1px bordered "IF YOU FILL IT NOW" box: price now, delta against worst case in accent, resulting share count. Primary "FILL THE LAST LEG AT MARKET", secondary "KEEP THE THREE, REFUND THE REST".

### 19 Passbook — running ledger
A three-segment filter strip (All / Shares / Money) flush against the header, active segment inverted. Rows: 52px mono date column, event kind in mono uppercase (BOUGHT and DIVIDEND `#111111`, GIFT SENT and CLAIMED accent, REBALANCE / DEPOSIT / FEE COVERED `#5a5858`), a plain-language note, and right-aligned mono amount over running balance. Rows shift right on hover and open the receipt (screen 17). Footer: "Every line is a transaction on Base, in order, with nothing netted off."

---

## Interactions & Behaviour

| Trigger | Result |
| --- | --- |
| Attestation checkbox | Enables Continue on Gate |
| Wallet row / smart wallet | Signs in, lands on Home |
| Amount below minimum | Error block, Continue disabled |
| Amount above balance | Shortfall error naming the deficit, Continue disabled |
| "More +" on a preview leg | Expands one leg at a time (accordion); label becomes "Close —" |
| "Send it to someone" | Reveals the unlock-date panel; primary CTA label changes to "BUY AND SEND · <amount>" |
| Buy (smart wallet) | One-tap mode, 2.6s, then Detail |
| Buy (browser wallet) | Step mode, advances one step per 1.1s; completes to Detail |
| Break at step 04 | Stopped state; "carry on" resumes at index 3 |
| Copy link / copy receipt | Label flips for 2000ms, then reverts |
| Cadence radio | Recomputes the next three dates |
| Start / stop standing order | Swaps the footer between CTA and running band |
| Break the lock | Two-step confirm; on confirm the banner, header chip, and footer CTA all change |
| Peek (sealed) | Toggles holdings rows; button label flips |
| Ledger filter | Filters rows and updates the header count |
| Ledger row | Opens the custody receipt |

**Timers must be cleared** on every navigation — the prototype clears both the one-tap timeout and the step interval on each screen change.

---

## State

```
screen            enum, 19 values
attested          bool      — gate
empty             bool      — prototype affordance, drop in production
prompt            string
amountUsd         number    — canonical amount
amountText        string    — what the user typed, local currency
openLeg           int|null  — accordion index
folioName         string    (max 40)
give              'keep' | 'send'
unlock            ISO date
mode              'onetap' | 'steps' | 'stopped'
step              0-5
copied            bool      (2s)
cadence           'weekly' | 'payday' | 'monthly'
repeat            bool
repeatUsd         number
autoRebalance     bool
peek              bool      — sealed
breaking          bool      — lock confirm revealed
lockOff           bool      — lock broken
ledgerFilter      'all' | 'shares' | 'money'
```

### Configuration (exposed as props in the prototype)
- `currency`: `BRL` | `NGN` | `IDR`. Each carries symbol, locale, an FX rate, a money word used in the display headline ("reais" / "naira" / "rupiah"), and a `tradeable` flag. When `tradeable` is false there is no on-chain market for that currency, and the app must say so — the settlement note appears on Home and Preview, the balance line reads "held as USDC", and step 01 of the signature path says USDC rather than the local code.
- `staleHours` (0–168): drives the staleness stamp, the "last updated" sentence, the reference-age labels inside expanded legs, and — at ≥24h — the void-ground stale banner on Preview.
- `feeCovered` (bool): switches the network fee between "Free" / "We cover it on this wallet" and a real charge, and rewrites the sentence in the wallet picker and the footer of the signature path.

All money is formatted with `Intl.NumberFormat` in the currency's own locale; two decimals for BRL, zero for NGN and IDR and for any value ≥1000.

### Data the real implementation needs
Reference prices with an "as of" timestamp; live quotes and a guaranteed worst case per leg; pool depth (to raise the thin-pool warning); realised fills per leg with slippage; the vault contract, owner address, chain id, block, timestamp, and transaction hash; the custodian's name; a chronological event ledger with running balance.

---

## Copy rules

Non-negotiable, because they carry the product's legal and trust posture:

1. Never call Folio a broker or issuer, and never imply a return. The phrasing used is "Folio is an interface and a vault."
2. Restrictions are described as properties of the asset, never as judgements about the user.
3. Every refusal states what did **not** happen ("nothing has been charged", "your money was never spent").
4. Share counts are always "share-equivalents, adjusted for dividends and splits".
5. Costs are stated before the button that incurs them.
6. Rebalancing and lock-breaking state their irreversible or taxable consequence in the same block as the confirm.
7. Sentence case in body copy; uppercase is a typographic device only.

---

## Assets
No images, no icon library. Every mark is drawn: the logo, the empty-state passbook, the seal, drift and term bars, the spinner ring, and the arrow glyphs (`←` `↗` `●` `+` `−`), which are Unicode characters set in IBM Plex Mono. Fonts load from Google Fonts: Archivo 400/500/700, Instrument Serif regular + italic, IBM Plex Mono 400/500.

## Files
- `Folio v2.dc.html` — the v2 prototype, all 19 screens. This is the reference to build from.
- `Folio v1.dc.html` — the earlier direction (warmer, gold-ledger). Included for context only; **do not build from it**.

## Accessibility notes to carry over
- All tap targets ≥44px; back/icon buttons are 32px visually but padded to 44px.
- Focus is a visible 1px accent outline at 3px offset — never removed.
- Accent must never sit on a dark ground without switching to `#8f9dff`.
- Decorative ghost letterforms are `aria-hidden` and `user-select: none`.
- The logo SVG carries `role="img"` and `aria-label="Folio"`.
