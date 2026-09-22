import type { Metadata, Viewport } from 'next'
import { Archivo, Instrument_Serif, IBM_Plex_Mono } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'
import { CurrencyProvider } from '@/components/currency-context'
import { AppShell } from '@/components/app-shell'
import { EligibilityGate } from '@/components/eligibility-gate'

const archivo = Archivo({ subsets: ['latin'], weight: ['400', '500', '700'], variable: '--font-archivo', display: 'swap' })
const instrument = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  variable: '--font-instrument',
  display: 'swap',
})
const plexMono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-plex-mono', display: 'swap' })

export const metadata: Metadata = {
  title: 'Folio — own US stocks from anywhere',
  description:
    'Sign up with your email, add stablecoins, and own real US stocks in your own name. Describe a portfolio in a sentence, keep it, lock it, or give it away. Built on Solana with xStocks.',
}

export const viewport: Viewport = { themeColor: '#fcfcfc', width: 'device-width', initialScale: 1, maximumScale: 1 }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${instrument.variable} ${plexMono.variable}`}>
      <body className="min-h-screen bg-ground-inset font-sans">
        <Providers>
          <CurrencyProvider>
            <EligibilityGate>
              <AppShell>{children}</AppShell>
            </EligibilityGate>
          </CurrencyProvider>
        </Providers>
      </body>
    </html>
  )
}
