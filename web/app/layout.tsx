import type { Metadata, Viewport } from 'next'
import { Archivo, Instrument_Serif, IBM_Plex_Mono } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'
import { CurrencyProvider } from '@/components/currency-context'
import { EligibilityGate } from '@/components/eligibility-gate'

const archivo = Archivo({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-archivo',
  display: 'swap',
})
const instrument = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  variable: '--font-instrument',
  display: 'swap',
})
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Folio — own Apple, pay in reais',
  description:
    'Describe a portfolio in one sentence, buy it in your own currency, hold it in your own name, and hand it to someone else. Built on Base with Coinbase tokenized stocks.',
}

export const viewport: Viewport = {
  themeColor: '#fcfcfc',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${instrument.variable} ${plexMono.variable}`}>
      <body className="min-h-screen bg-ground-inset font-sans">
        <Providers>
          <CurrencyProvider>
            <EligibilityGate>
              {/* The product is a phone. On wider screens it sits on the inset ground
                  rather than stretching, which is also how the prototype presents it. */}
              <div className="mx-auto min-h-screen w-full max-w-[430px] bg-ground">{children}</div>
            </EligibilityGate>
          </CurrencyProvider>
        </Providers>
      </body>
    </html>
  )
}
