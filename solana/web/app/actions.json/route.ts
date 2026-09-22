import { ACTIONS_HEADERS } from '@/lib/actions'

/** Tells Blink clients which pages on this site are Actions, and where their APIs live. */
export async function GET() {
  return new Response(
    JSON.stringify({
      rules: [
        { pathPattern: '/basket', apiPath: '/api/actions/basket' },
        { pathPattern: '/api/actions/**', apiPath: '/api/actions/**' },
      ],
    }),
    { headers: ACTIONS_HEADERS },
  )
}

export const OPTIONS = GET
