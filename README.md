# my-country

A Claude Code plugin that shows the country of your public IP as an uppercase ISO 3166-1 alpha-3 code (`ESP`, `DEU`, `USA`), at the left of the hint line under the prompt:

```
⏵⏵ auto mode on (shift+tab to cycle)            claude-opus-5 · effort: high
ESP  ? for shortcuts
```

The left of the footer row is the permission mode, which a plugin cannot draw in. The hint line under the prompt is the bottom-left text it can change. No flag: the line is plain text, and a flag emoji does not render reliably.

The services answer with the two-letter code, so the plugin converts it with a built-in table of all 249 ISO 3166-1 entries (`hooks/iso3.ts`). Two codes are not ISO: Kosovo shows as `XKX`, and Tor traffic, which Cloudflare reports as `T1`, shows as `TOR`.

The code appears once the first lookup succeeds. A later failure keeps the last code. Nothing is written to disk.

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

Set `block_prompts_abroad` to `true` (it is off by default) and pressing Enter does not send your prompt while the code is red. You get `Prompt not sent: your IP is in NLD, not in USA.` instead. It needs `home_country`; without one it blocks nothing and says so at startup.

```json
"pluginConfigs": {
  "my-country": { "options": { "home_country": "USA", "block_prompts_abroad": true, "check_every_seconds": 5 } }
}
```

What it leaves alone, on purpose:

- **Slash commands** go through, so `/config` always works and you can turn this off from a red state.
- **Anything you did not send** goes through: background task notifications, scheduled runs, other sessions. Only your Enter in the terminal, and messages from the Remote Control app, are held.
- **An unknown country** goes through. If every lookup fails (you are offline) the plugin cannot tell, and it never locks you out. The same goes if the plugin itself errors.

The check uses the last country it saw, so a VPN drop is caught only after the next pass. Pair it with a short `check_every_seconds` if that gap matters.

## What it asks

The same services as [IP Please](https://github.com/hallo-w3lt/ip-please-extension), in order, with no API key: `cloudflare.com/cdn-cgi/trace`, then `api.country.is`, `ipinfo.io` and `ipwho.is`. It checks at startup and again every 60 seconds by default, so a VPN change shows up on the next pass. Only the country code is kept, and only for the session.

## Check interval

Set `check_every_seconds` to change how often it asks. `5` means a VPN change shows up within 5 seconds. The value is kept between 2 and 3600; anything that is not a number falls back to 60. It is set the same way as `home_country`:

```json
"pluginConfigs": {
  "my-country": { "options": { "home_country": "USA", "check_every_seconds": 5 } }
}
```

Each pass makes one request, to Cloudflare, and only goes on to the next service if that one fails. At 5 seconds that is 12 requests a minute to a free public endpoint, so keep it as high as you can live with.

## Install

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
