/**
 * X Layer assets a folio is allowed to hold.
 * Symbols and decimals were read from chain 196 on 2026-09-23 via rpc.xlayer.tech.
 * High-yield corporate bond wrappers were announced; no verified token address yet, so they are absent.
 */

export type Sleeve = "stock" | "treasury" | "credit" | "meme";

export type Pair = {
  rwa: string;
  rwaDisplay: string;
  pool: `0x${string}`;
  dex: string;
};

export type XAsset = {
  symbol: string;
  name: string;
  display: string;
  address: `0x${string}`;
  decimals: number;
  sleeve: Sleeve;
  tags: string[];
  aliases: string[];
  pair?: Pair;
};

export const XLAYER_CHAIN_ID = 196;

export const USDG = {
  symbol: "USDG",
  name: "Global Dollar",
  address: "0x4ae46a509F6b1D9056937BA4500cb143933D2dc8",
  decimals: 6,
} as const;

/** Whole meme sleeve, across every meme in one folio. */
export const MEME_CAP_BPS = 500;

export const XASSETS: XAsset[] = [
  {
    symbol: "wNVDAx",
    name: "Wrapped NVIDIA xStock",
    display: "NVIDIA",
    address: "0xa8ddb5cd96b5222afe198316e9a57caa642850d5",
    decimals: 18,
    sleeve: "stock",
    tags: ["chips", "ai", "growth", "large-cap"],
    aliases: ["nvidia", "nvda"],
  },
  {
    symbol: "wAAPLx",
    name: "Wrapped Apple xStock",
    display: "Apple",
    address: "0x943bf64d566c32a2bcd41ac92fb63c111cc9de8f",
    decimals: 18,
    sleeve: "stock",
    tags: ["hardware", "consumer", "quality", "large-cap"],
    aliases: ["apple", "aapl", "iphone"],
  },
  {
    symbol: "wTSLAx",
    name: "Wrapped Tesla xStock",
    display: "Tesla",
    address: "0xc3fdbe3a68ee5de461d30415a8165cf9aefe1171",
    decimals: 18,
    sleeve: "stock",
    tags: ["ev", "growth", "volatile"],
    aliases: ["tesla", "tsla"],
  },
  {
    symbol: "wSPCXx",
    name: "Wrapped SpaceX xStock",
    display: "SpaceX",
    address: "0x8e2eed8b8b5e13ea7bf38e50d7821d2c57309072",
    decimals: 18,
    sleeve: "stock",
    tags: ["space", "growth"],
    aliases: ["spacex", "spcx"],
  },
  {
    symbol: "wSPYx",
    name: "Wrapped S&P 500 xStock",
    display: "S&P 500",
    address: "0xe7e553cd128f0011777323a0b44a7b96ea1cb540",
    decimals: 18,
    sleeve: "stock",
    tags: ["index", "quality", "large-cap"],
    aliases: ["spy", "s&p", "sp500", "s&p 500"],
  },
  {
    symbol: "wQQQx",
    name: "Wrapped Nasdaq-100 xStock",
    display: "Nasdaq-100",
    address: "0x4c1ae29c159838fc1b224636e28e086eb69101f7",
    decimals: 18,
    sleeve: "stock",
    tags: ["index", "growth", "large-cap", "ai"],
    aliases: ["qqq", "nasdaq"],
  },
  {
    symbol: "deJTRSY",
    name: "JTRSY deRWA",
    display: "US Treasuries",
    address: "0x8de0f3295b9e42b29e7617bada7c603277420451",
    decimals: 18,
    sleeve: "treasury",
    tags: ["safe", "treasury"],
    aliases: ["treasury", "treasuries", "jtrsy", "dejtrsy", "t-bill", "tbill"],
  },
  {
    symbol: "deJAAA",
    name: "JAAA deRWA",
    display: "AAA CLOs",
    address: "0x5f8a1c74c112865bd05dbe4752c7608332719062",
    decimals: 18,
    sleeve: "credit",
    tags: ["credit", "clo"],
    aliases: ["jaaa", "dejaaa", "clo", "clos"],
  },
  {
    symbol: "STARLINK",
    name: "STARLINK",
    display: "STARLINK",
    address: "0x87359b7d78b03bd81b567bf425263b453c73eeee",
    decimals: 18,
    sleeve: "meme",
    tags: ["meme"],
    aliases: ["starlink"],
    pair: {
      rwa: "wSPCXx",
      rwaDisplay: "SpaceX",
      pool: "0x75f29bb65eac55a675808f671572699caafdece0",
      dex: "Uniswap V2",
    },
  },
  {
    symbol: "IGNIX",
    name: "IGNIX",
    display: "IGNIX",
    address: "0x0c9535416fd3b772646c4575e0664fd65afeeeee",
    decimals: 18,
    sleeve: "meme",
    tags: ["meme"],
    aliases: ["ignix"],
    pair: {
      rwa: "wSPCXx",
      rwaDisplay: "SpaceX",
      pool: "0xd67a15e729a03203b4e1ec0eaef7896e7d87a652",
      dex: "Uniswap V2",
    },
  },
  {
    symbol: "LAIKA",
    name: "LAIKA",
    display: "LAIKA",
    address: "0x4fec966f98d8530507787d947d1ab24fa145a999",
    decimals: 18,
    sleeve: "meme",
    tags: ["meme"],
    aliases: ["laika"],
    pair: {
      rwa: "wSPCXx",
      rwaDisplay: "SpaceX",
      pool: "0x68084c1d2873b22f4ef2dce9c293ef2c12576147",
      dex: "Uniswap V2",
    },
  },
  {
    symbol: "XDOG",
    name: "XDOG",
    display: "XDOG",
    address: "0x0cc24c51bf89c00c5affbfcf5e856c25ecbdb48e",
    decimals: 18,
    sleeve: "meme",
    tags: ["meme"],
    aliases: ["xdog"],
    pair: {
      rwa: "wSPCXx",
      rwaDisplay: "SpaceX",
      pool: "0xea149acd19315ca5a2382bb48ea0b4d24c8a11f7d7a7e7a4b074eb7fd5c3e9f5",
      dex: "Uniswap V4",
    },
  },
  {
    symbol: "STERLING",
    name: "STERLING",
    display: "STERLING",
    address: "0x2026a3fcb9f2d2317085ab59bd666b64dd81eeee",
    decimals: 18,
    sleeve: "meme",
    tags: ["meme"],
    aliases: ["sterling"],
    pair: {
      rwa: "wNVDAx",
      rwaDisplay: "NVIDIA",
      pool: "0xec879367c3a1c1ae721079e65dfbc4972ccf16ab",
      dex: "Uniswap V2",
    },
  },
];

export const XASSET_BY_SYMBOL = new Map(XASSETS.map((a) => [a.symbol, a]));
export const ALLOWED_XLAYER_SYMBOLS = XASSETS.map((a) => a.symbol);
