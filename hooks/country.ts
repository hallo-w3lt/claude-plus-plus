// Country of this machine's public IP, as an ISO 3166-1 alpha-3 code (ESP, not
// ES). Providers are tried in the same order as the IP Please extension, and
// the first one that gives a known country wins.

import { ISO3 } from './iso3'

export const DEFAULT_SECONDS = 60
export const MIN_SECONDS = 2
export const MAX_SECONDS = 3600

// Shown in place of the country when no service gave one: no connection, or
// every service failed. Not a country, so it can never equal a home country.
export const OFFLINE = 'NoN'

// How often to look the country up, from the `check_every_seconds` option, in
// milliseconds. Not a number means the default. Out of range is pulled in: the
// floor keeps a 0 from becoming a request storm on free public services.
export function intervalMs(raw: unknown): number {
  const seconds = typeof raw === 'number' && Number.isFinite(raw) ? raw : DEFAULT_SECONDS
  return Math.round(Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, seconds)) * 1000)
}

const KNOWN = new Set(Object.values(ISO3))

// The home country the person typed in the plugin's options. The ISO3 code is
// what the docs ask for, but the 2-letter one (us) works too. Anything else is
// null, which the plugin treats as "no home country set".
export function homeCode(raw: unknown): string | null {
  const code = typeof raw === 'string' ? raw.trim().toUpperCase() : ''
  return KNOWN.has(code) ? code : countryCode(code)
}

export type Fetcher = (url: string) => Promise<{ ok: boolean; text: string }>

type Provider = {
  url: string
  read: (text: string) => string | null
}

// A provider's alpha-2 code to the alpha-3 shown. Anything that is not a known
// country (XX, a name, junk) is null so the next provider gets a turn. T1 is
// what Cloudflare returns for Tor: it has no ISO code, so it reads as TOR.
export function countryCode(raw: string | null): string | null {
  const code = (raw ?? '').trim().toUpperCase()
  if (code === 'T1') return 'TOR'
  return ISO3[code] ?? null
}

function cloudflare(text: string): string | null {
  for (const line of text.split('\n')) {
    const eq = line.indexOf('=')
    if (eq !== -1 && line.slice(0, eq) === 'loc') return line.slice(eq + 1)
  }
  return null
}

function jsonField(key: string): (text: string) => string | null {
  return text => {
    const data = JSON.parse(text) as Record<string, unknown>
    const value = data[key]
    return typeof value === 'string' ? value : null
  }
}

function ipwho(text: string): string | null {
  const data = JSON.parse(text) as { success?: unknown; country_code?: unknown }
  if (data.success === false) return null
  return typeof data.country_code === 'string' ? data.country_code : null
}

const PROVIDERS: readonly Provider[] = [
  { url: 'https://www.cloudflare.com/cdn-cgi/trace', read: cloudflare },
  { url: 'https://api.country.is/', read: jsonField('country') },
  { url: 'https://ipinfo.io/json', read: jsonField('country') },
  { url: 'https://ipwho.is/', read: ipwho },
]

export async function lookupCountry(fetchText: Fetcher): Promise<string | null> {
  for (const provider of PROVIDERS) {
    try {
      const res = await fetchText(provider.url)
      if (!res.ok) continue
      const code = countryCode(provider.read(res.text))
      if (code) return code
    } catch {
      // This provider failed. The next one may answer.
    }
  }
  return null
}
