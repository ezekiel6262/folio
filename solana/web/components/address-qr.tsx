'use client'

import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

/** A scannable address for sending from a phone exchange app. Generated locally, never fetched. */
export function AddressQr({ address, size = 168 }: { address: string; size?: number }) {
  const [svg, setSvg] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    QRCode.toString(address, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#111111', light: '#ffffff' } })
      .then((s) => live && setSvg(s))
      .catch(() => live && setSvg(null))
    return () => {
      live = false
    }
  }, [address])

  if (!svg) return <div style={{ width: size, height: size }} className="bg-ground-inset" />
  return (
    <div
      role="img"
      aria-label="QR code of your account address"
      style={{ width: size, height: size }}
      className="bg-white p-2 [&>svg]:h-full [&>svg]:w-full"
      // qrcode's own SVG output for a validated address; no user HTML is involved.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
