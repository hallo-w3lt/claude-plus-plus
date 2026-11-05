import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import { OFFLINE, homeCode, intervalMs, lookupCountry } from './country'

// The country of the IP as last looked up, or OFFLINE (NoN) when the last
// lookup found nothing. Null only before the first lookup has finished.
const country = atom({ plugin: 'my-country', key: 'country' } as const, null)

// The code reads green in the home country and red anywhere else. NoN is red
// too: with a home country set, "not sure" is shown the same as "not there".
const AT_HOME = 'green'
const ABROAD = 'red'

let tick: Timer | null = null
let retry: Timer | null = null
let busy = false

// The id of the main loop's turn that is running, null between turns. Only the
// main loop's: a subagent's or a teammate's turn carries an agentId and is left out.
let running: string | null = null
// The home country while `abort_running_abroad` is on and there is a home country
// to compare with. Null otherwise, which is also how the check knows it is off.
let cutHome: string | null = null

// IP Please gives each service 6 seconds. `$.http.fetch` has no timeout of its
// own, so a request that never answered would keep `busy` set for good and stop
// every later check, and the services after it would never get a turn.
const REQUEST_TIMEOUT_MS = 6000
// At Enter a person is waiting, so each service gets less time.
const GATE_TIMEOUT_MS = 3000
// After a lookup finds nothing, ask again this soon (or sooner if the check
// interval is shorter) instead of waiting out a whole interval on NoN.
const RETRY_MS = 5000

const fetchWithTimeout = ($: EngineInterface, url: string, timeoutMs: number) =>
  new Promise<{ ok: boolean; text: string }>((resolve, reject) => {
    const timer = $.clock.after(timeoutMs, () => reject(new Error('timed out')))
    // no-cache so a proxy or the host cannot answer with the country of the old IP.
    $.http
      .fetch(url, { headers: { 'Cache-Control': 'no-cache' } })
      .then(resolve, reject)
      .finally(() => timer.cancel())
  })

// Stops the running turn when the IP is confirmed to be outside the home country.
// NoN never stops it: "not sure" is not "not there", and a short outage of the
// lookup services must not kill a long run. It never throws: the turn can end on
// its own just before the abort lands, and that must not fail the lookup around it.
const cutIfAbroad = async ($: EngineInterface, code: string) => {
  if (cutHome === null || running === null || code === OFFLINE || code === cutHome) return
  const turnId = running
  // Cleared first, so a second pass cannot go after the same turn.
  running = null
  try {
    await $.turn.abort({ turnId })
    $.ui.toast(`my-country: stopped the running turn. Your IP is in ${code}, not in ${cutHome}.`)
  } catch {
    // The turn was already over. Nothing is left to stop.
  }
}

// Looks the country up now and keeps it, NoN when nothing answered. A failure
// replaces the last code on purpose: a stale country is worse than none.
const locate = async ($: EngineInterface, timeoutMs: number): Promise<string> => {
  const found = await lookupCountry(url => fetchWithTimeout($, url, timeoutMs))
  const code = found ?? OFFLINE
  // Before the state is written: stopping the turn comes first, the code on screen after.
  await cutIfAbroad($, code)
  if ((await read($, country)) !== code) await update($, country, () => code)
  return code
}

const refresh = async ($: EngineInterface, retryMs: number) => {
  if (busy) return
  busy = true
  let code: string | null = null
  try {
    code = await locate($, REQUEST_TIMEOUT_MS)
  } catch {
    // Reading or writing the state failed. The retry below tries again.
  } finally {
    busy = false
    retry?.cancel()
    retry = code !== null && code !== OFFLINE ? null : $.clock.after(retryMs, () => void refresh($, retryMs))
  }
}

export const register: Register = (on, options) => {
  const typed = typeof options.home_country === 'string' ? options.home_country.trim() : ''
  const home = homeCode(typed)
  // A VPN change shows up on the next pass, so this is also how late it can be.
  const everyMs = intervalMs(options.check_every_seconds)
  const retryMs = Math.min(everyMs, RETRY_MS)
  const blockAbroad = options.block_prompts_abroad === true
  const abortAbroad = options.abort_running_abroad === true

  // A reload starts the module over, so a turn already running is not known.
  running = null
  cutHome = abortAbroad ? home : null

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    tick?.cancel()
    retry?.cancel()
    void refresh($, retryMs)
    tick = $.clock.every(everyMs, () => {
      void refresh($, retryMs)
    })
    // A typo would otherwise leave the colors off with no hint of why.
    if (typed && home === null) {
      $.ui.toast(`my-country: "${typed}" is not a country code. Use 3 letters, for example USA.`)
    } else if (home === null && (blockAbroad || abortAbroad)) {
      $.ui.toast(
        blockAbroad && abortAbroad
          ? 'my-country: blocking prompts and stopping a running turn need a home_country, so nothing is blocked or stopped.'
          : blockAbroad
            ? 'my-country: blocking prompts needs a home_country, so nothing is blocked.'
            : 'my-country: stopping a running turn needs a home_country, so nothing is stopped.',
      )
    }
    return result
  })

  // Only the ids of the turns are kept, never what was said in them. The hooks
  // exist only while the option is on and there is a home country to compare with.
  if (cutHome !== null) {
    on('turn.start', ($, e, next) => {
      if (e.agentId === undefined) running = e.turnId
      return next(e)
    })

    on('turn.complete', ($, e, next) => {
      if (e.turnId === running) running = null
      return next(e)
    })
  }

  // The Enter that sends a prompt. It fails closed: the prompt goes through only
  // when the country is confirmed right now to be the home country. Not found,
  // no connection, a timeout or an error all hold it back.
  on('prompt.submit', async ($, e, next) => {
    if (!blockAbroad || home === null) return next(e)
    // Slash commands stay usable, /config included, so the option can be turned off.
    if (e.command) return next(e)
    // Only what the person sends. Notifications, schedules and peers go through.
    if (e.origin.kind !== 'composer' && e.origin.kind !== 'bridge') return next(e)

    // Asked again now rather than read from the last pass, which can be a whole
    // interval old: a VPN that dropped a moment ago must not let this one out.
    let code: string
    try {
      code = await locate($, GATE_TIMEOUT_MS)
    } catch {
      code = OFFLINE
    }
    if (code === home) return next(e)
    if (code === OFFLINE) return { drop: `Prompt not sent: could not confirm that your IP is in ${home}.` }
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
