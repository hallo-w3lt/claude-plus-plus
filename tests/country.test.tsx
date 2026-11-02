import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { countryCode, homeCode, intervalMs, lookupCountry } from '../hooks/country'
import { ISO3 } from '../hooks/iso3'

const trace = (loc: string) => ({
  status: 200,
  ok: true,
  headers: {},
  text: `ip=203.0.113.4\nloc=${loc}\n`,
})

const DOWN = { status: 503, ok: false, headers: {}, text: '' }

const HINT = {
  plugin: 'my-country',
  surface: 'terminal',
  component: 'PromptHint',
  props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
} as const

// Nothing sits beneath the plugin, so the test stands for the engine: a session
// that starts, a network that answers, and a PromptHint drawn as plain text.
// State is left to the kit's own store: a stand-in for state.get/state.set would
// replace it and cut the subscription that redraws a line already on screen.
function engine(on: On, answer: (url: string) => ReturnType<typeof trace>) {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('http.fetch', (_$, e) => ({ value: answer(e.url) }))
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.hint}</Text>
  })
}

const start = ($: Engine) => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

test('turns a provider code into ISO3', () => {
  expect(countryCode(' es ')).toBe('ESP')
  expect(countryCode('US')).toBe('USA')
  expect(countryCode('gb')).toBe('GBR')
  expect(countryCode('NA')).toBe('NAM') // Namibia, not a missing value
  expect(countryCode('XK')).toBe('XKX')
  expect(countryCode('T1')).toBe('TOR') // Cloudflare's code for Tor
})

test('refuses anything that is not a known country', () => {
  expect(countryCode('XX')).toBeNull()
  expect(countryCode('ZZ')).toBeNull()
  expect(countryCode('ESP')).toBeNull()
  expect(countryCode('Spain')).toBeNull()
  expect(countryCode('')).toBeNull()
  expect(countryCode(null)).toBeNull()
})

test('the ISO3 table is complete and consistent', () => {
  const pairs = Object.entries(ISO3)
  expect(pairs).toHaveLength(250) // 249 ISO 3166-1 entries plus XK
  for (const [two, three] of pairs) {
    expect(two).toMatch(/^[A-Z]{2}$/)
    expect(three).toMatch(/^[A-Z]{3}$/)
  }
  expect(new Set(pairs.map(([, three]) => three)).size).toBe(250)
})

test('keeps the first provider that answers', async () => {
  const code = await lookupCountry(async url => {
    if (url.includes('cloudflare')) return { ok: false, text: '' }
    if (url.includes('country.is')) return { ok: true, text: '{"country":"de"}' }
    return { ok: true, text: '{"country":"US"}' }
  })
  expect(code).toBe('DEU')
})

test('skips a provider that fails and one that returns XX', async () => {
  const code = await lookupCountry(async url => {
    if (url.includes('cloudflare')) throw new Error('down')
    if (url.includes('country.is')) return { ok: true, text: '{"country":"XX"}' }
    if (url.includes('ipinfo')) return { ok: true, text: 'not json' }
    return { ok: true, text: '{"success":true,"country_code":"jp"}' }
  })
  expect(code).toBe('JPN')
})

test('gives up when every provider is down', async () => {
  expect(await lookupCountry(async () => ({ ok: false, text: '' }))).toBeNull()
})

test('puts the code at the left of the hint line', async ($, on) => {
  const clock = mock.clock(on)
  engine(on, () => trace('es'))

  await start($)
  await clock.settle()

  const ui = await $.ui.mount(HINT)
  expect((await ui.find({ type: 'Text' }))?.text).toBe('ESP  ? for shortcuts')
  await ui.unmount()
})

test('redraws a line that was already on screen when the first lookup lands', async ($, on) => {
  const clock = mock.clock(on)
  engine(on, () => trace('es'))

  // The line draws at startup, before any lookup has answered.
  const ui = await $.ui.mount(HINT)
  expect((await ui.find({ type: 'Text' }))?.text).toBe('? for shortcuts')

  await start($)
  await clock.settle()

  // Same handle, no remount: the write must have redrawn it.
  expect((await ui.find({ type: 'Text' }))?.text).toBe('ESP  ? for shortcuts')
  await ui.unmount()
})

test('shows only the code when the hint line is empty', async ($, on) => {
  const clock = mock.clock(on)
  engine(on, () => trace('fr'))

  await start($)
  await clock.settle()

  const ui = await $.ui.mount({ ...HINT, props: { ...HINT.props, hint: '' } })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('FRA')
  await ui.unmount()
})

test('leaves the hint alone until a country is known', async ($, on) => {
  const clock = mock.clock(on)
  engine(on, () => DOWN)

  await start($)
  await clock.settle()

  const ui = await $.ui.mount(HINT)
  expect((await ui.find({ type: 'Text' }))?.text).toBe('? for shortcuts')
  await ui.unmount()
})

test('follows a VPN change on the next pass and keeps the code when a pass fails', async ($, on) => {
  const clock = mock.clock(on)
  let reply: ReturnType<typeof trace> = trace('es')
  engine(on, () => reply)

  const shown = async () => {
    const ui = await $.ui.mount(HINT)
    const text = (await ui.find({ type: 'Text' }))?.text
    await ui.unmount()
    return text
  }

  await start($)
  await clock.settle()
  expect(await shown()).toBe('ESP  ? for shortcuts')

  reply = trace('de')
  await clock.advance(60_000)
  expect(await shown()).toBe('DEU  ? for shortcuts')

  reply = DOWN
  await clock.advance(60_000)
  expect(await shown()).toBe('DEU  ? for shortcuts')
})

// The Text that holds the code alone: the whole line also contains it, so the
// match is anchored.
const codeText = (code: string) => ({ type: 'Text', text: new RegExp(`^${code}$`) }) as const

test('reads a home country typed as ISO3, ISO2, or with stray spaces and case', () => {
  expect(homeCode('USA')).toBe('USA')
  expect(homeCode(' usa ')).toBe('USA')
  expect(homeCode('us')).toBe('USA')
  expect(homeCode('NAM')).toBe('NAM')
  expect(homeCode('')).toBeNull()
  expect(homeCode('Narnia')).toBeNull()
  expect(homeCode('ZZZ')).toBeNull()
  expect(homeCode(undefined)).toBeNull()
})

test('the code is green when the IP is in the home country', { options: { home_country: 'USA' } }, async ($, on) => {
  const clock = mock.clock(on)
  engine(on, () => trace('us'))

  await start($)
  await clock.settle()

  const ui = await $.ui.mount(HINT)
  expect((await ui.find(codeText('USA')))?.props.color).toBe('green')
  expect((await ui.find({ type: 'Text' }))?.text).toBe('USA  ? for shortcuts')
  await ui.unmount()
})

test('the code is red when the IP is in another country', { options: { home_country: 'us' } }, async ($, on) => {
  const clock = mock.clock(on)
  engine(on, () => trace('es'))

  await start($)
  await clock.settle()

  const ui = await $.ui.mount(HINT)
  expect((await ui.find(codeText('ESP')))?.props.color).toBe('red')
  await ui.unmount()
})

test('without a home country the code has no color', async ($, on) => {
  const clock = mock.clock(on)
  engine(on, () => trace('es'))

  await start($)
  await clock.settle()

  const ui = await $.ui.mount(HINT)
  const props = (await ui.find(codeText('ESP')))?.props
  expect(props?.color).toBeUndefined()
  expect(props?.dimColor).toBe(true)
  await ui.unmount()
})

test('the color flips on the line already on screen when the VPN changes', { options: { home_country: 'USA' } }, async ($, on) => {
  const clock = mock.clock(on)
  let reply: ReturnType<typeof trace> = trace('us')
  engine(on, () => reply)

  await start($)
  await clock.settle()

  const ui = await $.ui.mount(HINT)
  expect((await ui.find(codeText('USA')))?.props.color).toBe('green')

  reply = trace('nl')
  await clock.advance(60_000)
  expect((await ui.find(codeText('NLD')))?.props.color).toBe('red')

  reply = trace('us')
  await clock.advance(60_000)
  expect((await ui.find(codeText('USA')))?.props.color).toBe('green')
  await ui.unmount()
})

test('a home country that is not a code is told once and leaves the colors off', { options: { home_country: 'Narnia' } }, async ($, on) => {
  const clock = mock.clock(on)
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  engine(on, () => trace('es'))

  await start($)
  await clock.settle()

  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toContain('"Narnia"')

  const ui = await $.ui.mount(HINT)
  expect((await ui.find(codeText('ESP')))?.props.color).toBeUndefined()
  await ui.unmount()
})

test('turns the check interval option into milliseconds', () => {
  expect(intervalMs(5)).toBe(5_000)
  expect(intervalMs(2.5)).toBe(2_500)
  expect(intervalMs(60)).toBe(60_000)
  expect(intervalMs(0)).toBe(2_000) // the floor, not a request storm
  expect(intervalMs(-10)).toBe(2_000)
  expect(intervalMs(99_999)).toBe(3_600_000)
  expect(intervalMs(undefined)).toBe(60_000)
  expect(intervalMs('5')).toBe(60_000) // not a number: the default
  expect(intervalMs(Number.NaN)).toBe(60_000)
})

test('checks again every 5 seconds when asked to', { options: { check_every_seconds: 5 } }, async ($, on) => {
  const clock = mock.clock(on)
  let reply: ReturnType<typeof trace> = trace('es')
  const asked: string[] = []
  engine(on, url => {
    asked.push(url)
    return reply
  })

  await start($)
  await clock.settle()
  expect(asked).toHaveLength(1)

  const ui = await $.ui.mount(HINT)
  expect((await ui.find({ type: 'Text' }))?.text).toBe('ESP  ? for shortcuts')

  reply = trace('de')
  await clock.advance(4_900)
  expect(asked).toHaveLength(1) // not yet
  expect((await ui.find({ type: 'Text' }))?.text).toBe('ESP  ? for shortcuts')

  await clock.advance(100)
  expect(asked).toHaveLength(2)
  expect((await ui.find({ type: 'Text' }))?.text).toBe('DEU  ? for shortcuts')

  reply = trace('fr')
  await clock.advance(5_000)
  expect((await ui.find({ type: 'Text' }))?.text).toBe('FRA  ? for shortcuts')
  await ui.unmount()
})

test('waits a minute between checks by default', async ($, on) => {
  const clock = mock.clock(on)
  const asked: string[] = []
  engine(on, url => {
    asked.push(url)
    return trace('es')
  })

  await start($)
  await clock.settle()
  expect(asked).toHaveLength(1)

  await clock.advance(59_000)
  expect(asked).toHaveLength(1)
  await clock.advance(1_000)
  expect(asked).toHaveLength(2)
})

// A prompt as the engine raises it, from the person's Enter unless said otherwise.
const typed = (text: string, extra: object = {}) => ({ text, wait: false, origin: { kind: 'composer' as const }, ...extra })

// The engine beneath: it counts the prompts that actually entered the session.
function session(on: On) {
  const entered: string[] = []
  on('prompt.submit', (_$, e) => {
    entered.push(e.text)
    return { text: e.text }
  })
  return entered
}

const ABROAD_ONLY = { options: { home_country: 'USA', block_prompts_abroad: true } }

test('does not send the prompt while the IP is outside the home country', ABROAD_ONLY, async ($, on) => {
  const clock = mock.clock(on)
  const entered = session(on)
  engine(on, () => trace('nl'))

  await start($)
  await clock.settle()

  const result = await $.prompt.submit(typed('hello'))
  expect(result).toEqual({ drop: 'Prompt not sent: your IP is in NLD, not in USA.' })

  const phone = await $.prompt.submit(typed('hello', { origin: { kind: 'bridge' } }))
  expect(phone.drop).toContain('NLD')
  expect(entered).toEqual([])
})

test('sends the prompt while the IP is in the home country', ABROAD_ONLY, async ($, on) => {
  const clock = mock.clock(on)
  const entered = session(on)
  engine(on, () => trace('us'))

  await start($)
  await clock.settle()

  const result = await $.prompt.submit(typed('hello'))
  expect(result.drop).toBeUndefined()
  expect(entered).toEqual(['hello'])
})

test('sends again as soon as the VPN is back in the home country', ABROAD_ONLY, async ($, on) => {
  const clock = mock.clock(on)
  const entered = session(on)
  let reply: ReturnType<typeof trace> = trace('nl')
  engine(on, () => reply)

  await start($)
  await clock.settle()
  expect((await $.prompt.submit(typed('one'))).drop).toBeDefined()

  reply = trace('us')
  await clock.advance(60_000)
  expect((await $.prompt.submit(typed('two'))).drop).toBeUndefined()
  expect(entered).toEqual(['two'])
})

test('blocks nothing unless the option is on', { options: { home_country: 'USA' } }, async ($, on) => {
  const clock = mock.clock(on)
  const entered = session(on)
  engine(on, () => trace('nl'))

  await start($)
  await clock.settle()

  expect((await $.prompt.submit(typed('hello'))).drop).toBeUndefined()
  expect(entered).toEqual(['hello'])
})

test('slash commands and prompts that are not the Enter of the person still go through', ABROAD_ONLY, async ($, on) => {
  const clock = mock.clock(on)
  const entered = session(on)
  engine(on, () => trace('nl'))

  await start($)
  await clock.settle()

  await $.prompt.submit(typed('/config', { command: { name: 'config', args: '' } }))
  await $.prompt.submit(typed('build finished', { origin: { kind: 'task-notification' } }))
  await $.prompt.submit(typed('tick', { origin: { kind: 'scheduled-trigger' } }))
  expect(entered).toEqual(['/config', 'build finished', 'tick'])
})

test('sends the prompt when the country is not known yet', ABROAD_ONLY, async ($, on) => {
  const clock = mock.clock(on)
  const entered = session(on)
  engine(on, () => DOWN)

  await start($)
  await clock.settle()

  expect((await $.prompt.submit(typed('hello'))).drop).toBeUndefined()
  expect(entered).toEqual(['hello'])
})

test('says so when blocking is on but there is no home country', { options: { block_prompts_abroad: true } }, async ($, on) => {
  const clock = mock.clock(on)
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  const entered = session(on)
  engine(on, () => trace('nl'))

  await start($)
  await clock.settle()

  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toContain('home_country')
  expect((await $.prompt.submit(typed('hello'))).drop).toBeUndefined()
  expect(entered).toEqual(['hello'])
})
