// shared/ is canonical; the web app needs its own copy so Vercel can build from web/ alone.
import { copyFileSync, existsSync } from 'node:fs'
const pairs = [
  ['shared/base-assets.json', 'web/lib/base-assets.json'],
  ['shared/deployment.base.json', 'web/lib/deployment.json'],
]
for (const [from, to] of pairs) {
  if (!existsSync(from)) { console.log(`skip ${from} (not present yet)`); continue }
  copyFileSync(from, to)
  console.log(`synced ${from} -> ${to}`)
}
