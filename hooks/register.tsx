import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import { homeCode, intervalMs, lookupCountry } from './country'

const country = atom({ plugin: 'my-country', key: 'country' } as const, null)

// The code reads green in the home country and red anywhere else.
const AT_HOME = 'green'
const ABROAD = 'red'

let tick: Timer | null = null
let busy = false

const refresh = async ($: EngineInterface) => {
  if (busy) return
  busy = true
  try {
    const code = await lookupCountry(url => $.http.fetch(url))
    if (code === null || (await read($, country)) === code) return
    await update($, country, () => code)
  } catch {
    // The next pass tries again. The last code stays up.
  } finally {
    busy = false
  }
}

export const register: Register = (on, options) => {
  const typed = typeof options.home_country === 'string' ? options.home_country.trim() : ''
  const home = homeCode(typed)
  // A VPN change shows up on the next pass, so this is also how late it can be.
  const everyMs = intervalMs(options.check_every_seconds)
  const blockAbroad = options.block_prompts_abroad === true

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    tick?.cancel()
    void refresh($)
    tick = $.clock.every(everyMs, () => {
      void refresh($)
    })
    // A typo would otherwise leave the colors off with no hint of why.
    if (typed && home === null) {
      $.ui.toast(`my-country: "${typed}" is not a country code. Use 3 letters, for example USA.`)
    } else if (blockAbroad && home === null) {
      $.ui.toast('my-country: blocking prompts needs a home_country, so nothing is blocked.')
    }
    return result
  })

  // The Enter that sends a prompt while the IP is outside the home country. It
  // fails open on purpose: with no known country, or if this hook throws, the
  // prompt goes through, so being offline never locks the session.
  on('prompt.submit', async ($, e, next) => {
    if (!blockAbroad || home === null) return next(e)
    // Slash commands stay usable, /config included, so the option can be turned off.
    if (e.command) return next(e)
    // Only what the person sends. Notifications, schedules and peers go through.
    if (e.origin.kind !== 'composer' && e.origin.kind !== 'bridge') return next(e)

    const code = await read($, country)
    if (code === null || code === home) return next(e)
    return { drop: `Prompt not sent: your IP is in ${code}, not in ${home}.` }
  })

  // The permission mode owns the left of the footer row, so the code goes at
  // the start of the hint line under the prompt: the bottom-left text.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const code = await read($, country)
    if (!code) return next(e)

    const { Text } = $.ui.resolve(e)
    const hint = e.props.hint.trim()
    // Colored when a home country is set, dim like the rest of the line when not.
    const style = home === null ? { dimColor: true } : { color: code === home ? AT_HOME : ABROAD, weight: 'bold' as const }

    return (
      <Text>
        <Text {...style}>{code}</Text>
        <Text dimColor>{hint ? `  ${hint}` : ''}</Text>
      </Text>
    )
  })
}
