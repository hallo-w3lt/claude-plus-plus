# my-country

A Claude Code plugin that shows the country of your public IP as an uppercase ISO 3166-1 alpha-3 code (`ESP`, `DEU`, `USA`), at the left of the hint line under the prompt:

```
⏵⏵ auto mode on (shift+tab to cycle)            claude-opus-5 · effort: high
ESP  ? for shortcuts
```

The left of the footer row is the permission mode, which a plugin cannot draw in. The hint line under the prompt is the bottom-left text it can change. No flag: the line is plain text, and a flag emoji does not render reliably.

The services answer with the two-letter code, so the plugin converts it with a built-in table of all 249 ISO 3166-1 entries (`hooks/iso3.ts`). Two codes are not ISO: Kosovo shows as `XKX`, and Tor traffic, which Cloudflare reports as `T1`, shows as `TOR`.

The code appears once the first lookup has finished. When no service gives a country (you are offline, or every service failed) it reads `NoN` instead, never the last country: an old code would be a false statement about the new connection. It is red when a home country is set, dim otherwise, and the plugin asks again every few seconds until a country comes back, instead of waiting out a whole check interval. To show `Err` instead, change `OFFLINE` at the top of `hooks/country.ts`. Nothing is written to disk.

## Home country and colors

Set `home_country` to your own country, for example `USA`. The code then shows **green** while your IP is there and **red** anywhere else, so a VPN that drops or lands in the wrong place is visible at a glance. Left empty, the code has no color.

It takes the 3-letter code (`USA`) or the 2-letter one (`us`), in any case. If what you typed is not a country, a message says so once at startup and the colors stay off.

Set it from the plugin's config menu, or in `~/.claude/settings.json`:

```json
"pluginConfigs": {
  "my-country": { "options": { "home_country": "USA" } }
}
```

Changing it reloads the plugin with the new value. The two colors are the `AT_HOME` and `ABROAD` constants at the top of `hooks/register.tsx`.

## Block prompts when abroad

Set `block_prompts_abroad` to `true` (it is off by default) and pressing Enter sends your prompt only when your IP is confirmed to be in the home country. Otherwise you get `Prompt not sent: your IP is in NLD, not in USA.`, or `Prompt not sent: could not confirm that your IP is in USA.` when the country could not be found. It needs `home_country`; without one it blocks nothing and says so at startup.

The check is made at Enter, not read from the last pass: the plugin asks the services again at that moment, and each of them answers with the IP and its country together, so the country judged is always the one of the IP in use right then. Each service gets 3 seconds there. If none answers, the prompt is held.

```json
"pluginConfigs": {
  "my-country": { "options": { "home_country": "USA", "block_prompts_abroad": true, "check_every_seconds": 5 } }
}
```

What it leaves alone, on purpose:

- **Slash commands** go through, so `/config` always works and you can turn this off from a red state.
- **Anything you did not send** goes through: background task notifications, scheduled runs, other sessions. Only your Enter in the terminal, and messages from the Remote Control app, are held.

What it does not leave alone: **an unknown country is held**. If every lookup fails (you are offline, or the services are blocked), or the plugin itself errors, the prompt is not sent. The way out is `/config`, which always works: turn `block_prompts_abroad` off there.

## What it asks

The same services as [IP Please](https://github.com/hallo-w3lt/ip-please-extension), in order, with no API key: `cloudflare.com/cdn-cgi/trace`, then `api.country.is`, `ipinfo.io` and `ipwho.is`. It checks at startup and again every 60 seconds by default, so a VPN change shows up on the next pass. Only the country code is kept, and only for the session.

Every request goes from your machine, so each of these services sees your public IP address. That is how they can tell the country. Apart from the standard headers any web request carries, the plugin sends them nothing else. Like any mod, its prompt hook runs on every prompt you send, but it only checks where the prompt came from and whether it is a slash command, and with `block_prompts_abroad` on it looks the country up again at that moment. It never looks at the text you type, and nothing you type is stored or sent anywhere.

## Check interval

Set `check_every_seconds` to change how often it asks. `5` means a VPN change shows up within 5 seconds. The value is kept between 2 and 3600; anything that is not a number falls back to 60. It is set the same way as `home_country`:

```json
"pluginConfigs": {
  "my-country": { "options": { "home_country": "USA", "check_every_seconds": 5 } }
}
```

Each pass makes one request, to Cloudflare, and only goes on to the next service if that one fails. At 5 seconds that is 12 requests a minute to a free public endpoint, so keep it as high as you can live with.

## Install

Needs Claude Code 2.1.287 or later in the terminal, which is the first version that loads mods; check yours with `claude --version`. The one-line shell install further down needs 2.1.292 or later. In the Desktop app's Code tab, mods work from 2.1.286. It was tested with 2.1.316.

At the prompt of a terminal session:

```
/plugin install my-country --marketplace hallo-w3lt/claude-plus-plus
```

Or from a shell:

```
claude plugin install my-country --marketplace hallo-w3lt/claude-plus-plus
```

Answer `y` to add the marketplace and pick a scope. A screen then sets the options (`home_country`, `block_prompts_abroad`, `check_every_seconds`), and the plugin is active in that session with no reload.

In the desktop app `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `hallo-w3lt/claude-plus-plus`, then Add plugin.

The hint line is drawn in the terminal and in the Desktop app's Code tab. It is not drawn in the VS Code extension.

## Develop

Clone the repository and run the plugin from its folder, with a reload on every save:

```
git clone https://github.com/hallo-w3lt/claude-plus-plus.git
claude --plugin-dir ./claude-plus-plus
```

Check it with `claude plugin validate .` and run its tests with `claude plugin test .` from that folder. The type definitions the editor and `tsc` use are written by Claude Code into `.claude-plugin/types/` the first time the plugin loads, and are not committed.

## License

MIT. See [LICENSE](LICENSE).
