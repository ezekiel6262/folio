'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Screen, Spinner } from '@/components/ui'
import { STOCK_BY_SYMBOL } from '@/lib/assets'

/**
 * The human side of a shared basket link. Blink-aware clients read the Action behind
 * /basket; a plain browser lands here and goes straight to building that basket in Folio.
 */
export default function BasketPage() {
  const router = useRouter()
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const symbols = (q.get('s') ?? q.get('b')?.split('-').map((p) => p.split('.')[0]).join(',') ?? '')
      .split(',')
      .map((s) => STOCK_BY_SYMBOL.get(s.trim())?.display)
      .filter(Boolean)
    const folio = q.get('folio')
    router.replace(folio ? `/folio/${folio}` : `/create?prompt=${encodeURIComponent(symbols.join(', ') || 'the S&P 500')}`)
  }, [router])
  return (
    <Screen>
      <div className="flex min-h-[50vh] items-center justify-center">
        <Spinner />
      </div>
    </Screen>
  )
}
