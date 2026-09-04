import type { Metadata, Viewport } from 'next'
import './globals.css'
import { Providers } from './providers'
import { CurrencyProvider } from '@/components/currency-context'
import { EligibilityGate } from '@/components/eligibility-gate'
import { SiteHeader } from '@/components/site-header'

export const metadata: Metadata = {
  title: 'Folio — your US stock envelope',
  description:
    'Describe a portfolio in your own words, fund it in the currency you already live in, and keep it, lock it, or send it. Built on Base with Coinbase tokenized stocks.',
}

export const viewport: Viewport = {
  themeColor: '#FAFAF8',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <Providers>
          <CurrencyProvider>
            <EligibilityGate>
              <div className="mx-auto flex min-h-screen w-full max-w-[440px] flex-col bg-paper sm:max-w-[480px]">
                <SiteHeader />
                <main className="flex-1 px-5 pb-28">{children}</main>
              </div>
            </EligibilityGate>
          </CurrencyProvider>
        </Providers>
      </body>
    </html>
  )
}
