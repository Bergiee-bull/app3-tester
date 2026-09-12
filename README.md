# App3 Tester

App3 Tester is a public, static research app for following a sanitized App3
signal and testing it with a personal portfolio. It is designed for GitHub
Pages and works without a backend, login, broker connection, or trading API.

## Valbara ETF:er i App3

App3-signalen anger marknadsläge. I appen översätts signalen tydligt till den
ETF som användaren själv kan välja att äga:

| App3-signal | Exponering | ETF/instrument | Ticker |
| --- | --- | --- | --- |
| `NASDAQ` | Nasdaq 100 | **Invesco EQQQ Nasdaq-100 UCITS ETF Dist** | `EQQQ` |
| `OMX` | Sverige / OMX | **XACT OMXS30 ESG (UCITS ETF)** | `XACT OMXS30` |

Appen visar aktuell ETF direkt under dagens signal och använder samma fasta
instrumentval när en lokal testtransaktion registreras. App3 genomför aldrig
köp eller försäljningar automatiskt.

## Architecture

The four data domains are deliberately separate:

1. **App3 production** calculates the canonical signal in a private system.
2. **Public signal export** creates `data/app3_signal.json` from an explicit
   field whitelist.
3. **App3 Tester** reads only that public JSON and the public asset registry.
4. **Personal portfolio** is stored only in the user's browser through
   `localStorage`.

The web app contains no decision engine, backtest, strategy parameters, raw
market data, private production paths, or write path into App3.

## Privacy Model

No personal portfolio is included in this repository. A new browser starts
with an empty portfolio. Purchases, sales, valuations, signal history, and
settings are stored under the versioned browser key
`app3Tester.portfolio.v1`. They are not transmitted by the application.

Users can export their local portfolio to JSON, import that backup on another
device, or delete all local App3 Tester data. Reset never changes the public
signal.

## Public Signal

`data/app3_signal.json` has an exact versioned schema:

```json
{
  "schema_version": 1,
  "generated_at": "ISO-8601 timestamp",
  "is_sample_data": false,
  "strategy": {
    "id": "canonical strategy id",
    "display_name": "App3",
    "version": "strategy version"
  },
  "signal": {
    "recommended_asset": "registry key",
    "previous_asset": "registry key",
    "action": "HOLD or SWITCH",
    "signal_date": "YYYY-MM-DD",
    "effective_date": "YYYY-MM-DD"
  },
  "system": {
    "status": "OK",
    "data_quality": "PASS",
    "market_date": "YYYY-MM-DD"
  }
}
```

Missing, malformed, stale, sample-marked, or failed-quality signals are blocked.
The app then displays that App3 cannot be verified and hides the switch action.

The production-side exporter constructs this object field by field. It never
serializes an internal decision, account object, or position file wholesale.

## Asset Registry

`data/asset_registry.json` maps stable asset identifiers such as `NASDAQ` and
`OMX` to public display and instrument information. UI code works with the
signal's `recommended_asset` and resolves presentation through this registry.

The current selectable instruments are explicit: **Invesco EQQQ Nasdaq-100
UCITS ETF Dist** (`EQQQ`) for Nasdaq exposure and **XACT OMXS30 ESG (UCITS
ETF)** (`XACT OMXS30`) for Swedish exposure. The market selector controls this
fixed instrument choice; free-text instruments are not accepted in the V1 UI.

Adding a future asset requires a registry entry. It must not be implemented as
a strategy-specific condition in the UI.

## Strategy Versioning

The application is strategy agnostic. Transactions and observed signals store
the strategy ID and version that were active at that time. Historical records
therefore remain readable after a canonical strategy change.

If App3 production later promotes a new canonical strategy, App3 Tester should
normally require no code change. The trusted release process updates the
sanitized strategy ID/version and signal values while preserving schema
compatibility.

## Portfolio And Market Values

The first purchase records instrument, date, quantity, price, currency, FX rate
to SEK, and fee. BUY and SELL are supported in the UI. The local data model is
prepared for DIVIDEND and CASH_ADJUSTMENT.

The public market-data export includes the latest validated closing prices for
both selectable ETFs. When the app opens, it values a local EQQQ holding as
`quantity × EQQQ close in EUR × EUR/SEK` and a local XACT OMXS30 holding as
`quantity × close in SEK`. The quote date, ETF price, and FX rate are shown
under the current value. **Uppdatera värde** remains available as a manual
fallback.

The automatic quote never contains or receives a user's quantity, purchase
price, account value, or return. Those inputs stay in `localStorage`; the
calculation happens in the browser. Because EQQQ is distributing, cash
distributions must be recorded locally before they are reflected in the actual
portfolio value. Benchmark curves use provider-reported Adjusted Close.

The chart compares the user's local App3 valuation snapshots with two public
buy-and-hold benchmarks. All three series start at 0% on the first common
completed trading date on or after the user's locally stored first purchase:

- App3 is green while the recorded holding is Nasdaq and red while it is OMX.
- Nasdaq buy-and-hold uses `EQQQ.DE` Adjusted Close converted to SEK with
  `EURSEK=X`.
- OMX buy-and-hold uses `XACT-OMXS30.ST` Adjusted Close in SEK.

The two benchmark lines use separate grey shades. Thin vertical markers show
recorded App3 asset switches. Benchmark data is public, contains no user
portfolio values, and is rejected if marked as sample data or if provenance
validation fails. Yahoo Adjusted Close may differ from actual account returns
because of fees, tax, spread, and provider adjustments.

Refresh the sanitized public benchmark file with:

```bash
python3 scripts/export_public_benchmarks.py
```

This optional maintenance command requires `pandas` and `yfinance`. Market data
never calculates an App3 signal in this public app.

## Daily 07:15 Update

The local Mac publisher runs every day at **07:15 Europe/Stockholm**. It uses a
fail-closed chain:

1. Export the sanitized App3 signal from the private production workspace.
2. Fetch EQQQ, XACT OMXS30, and EUR/SEK through `yfinance`.
3. Validate both public JSON files and reject sample data.
4. Run all tests.
5. Commit only `data/app3_signal.json` and `data/benchmark_series.json`.
6. Push `main`, after which GitHub Actions deploys GitHub Pages.

Test the complete chain without changing or publishing files:

```bash
APP3_PRODUCTION_ROOT=/path/to/private/workspace \
  bash scripts/update_and_publish_daily.sh --dry-run
```

Install the macOS LaunchAgent:

```bash
APP3_PRODUCTION_ROOT=/path/to/private/workspace \
  bash scripts/install_daily_update_agent.sh
```

Inspect status and logs:

```bash
launchctl print gui/$(id -u)/com.app3tester.daily-update
tail -f data/logs/app3_tester_daily.out.log
tail -f data/logs/app3_tester_daily.err.log
```

Remove the schedule with `bash scripts/uninstall_daily_update_agent.sh`. The Mac
must be running with network access and valid Git credentials. A failed signal
export, provenance check, price/FX fetch, test, or push stops the chain; stale or
invalid data is never published as a successful update.

## Local Development

Requires Python 3 for the static server and Node.js 22 or newer for tests.

```bash
npm test
npm run serve
```

Open `http://127.0.0.1:4173`.

## PWA

The manifest, icon, and service worker provide an installable standalone app.
The app shell is cached, while `app3_signal.json` is always requested from the
network without a service-worker cache fallback. This avoids presenting a
cached production recommendation as current.

## GitHub Pages

`.github/workflows/deploy-pages.yml` runs tests and validates both public JSON
files before deployment. Only `main` can deploy. Feature branches can run
locally but do not go live.

To publish after repository review:

1. Create an empty public GitHub repository named `app3-tester`.
2. Add it as this local repository's `origin`.
3. Merge the reviewed feature branch into `main`.
4. Push `main` and enable GitHub Pages with **GitHub Actions** as the source.

No push or Pages publication is performed automatically by the local build.

## Updating The Signal

The trusted production process runs its sanitized exporter with an explicit
output target for `data/app3_signal.json`. Review the generated diff, run
`npm test`, and publish the data-only change through the normal repository
workflow. Never copy the internal decision JSON into this repository.

## Tests

```bash
npm test
```

Tests cover schema and benchmark validation, synchronized buy-and-hold start
dates, strategy-independent rendering, NASDAQ and OMX,
HOLD and SWITCH, stale/failed/sample data, local persistence, transaction
calculation, strategy migration, registry validation, backup/reset, privacy,
fail-closed behavior, PWA metadata, and responsive accessibility hooks.

## Scope

V1 intentionally has no login, cloud database, payments, social features,
per-user notifications, push notifications, broker connection, or automatic
orders.

App3 Tester is a research/test tool, not investment advice. Historical returns
do not guarantee future returns.
