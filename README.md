# App3 Tester

App3 Tester is a public, static research app for following a sanitized App3
signal and testing it with a personal portfolio. It is designed for GitHub
Pages and works without a backend, login, broker connection, or trading API.

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

V1 does not fetch security prices. Users add a verified current price and FX
rate through **Uppdatera värde**. Until a held instrument has a valuation, the
current value and return remain unavailable rather than being fabricated.

The chart shows the user's local valuation snapshots. Nasdaq and OMX benchmark
lines are intentionally absent until a validated public benchmark dataset is
added. Market data may later value holdings and draw benchmarks, but it must
never calculate an App3 signal in this app.

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

Tests cover schema validation, strategy-independent rendering, NASDAQ and OMX,
HOLD and SWITCH, stale/failed/sample data, local persistence, transaction
calculation, strategy migration, registry validation, backup/reset, privacy,
fail-closed behavior, PWA metadata, and responsive accessibility hooks.

## Scope

V1 intentionally has no login, cloud database, payments, social features,
per-user notifications, push notifications, broker connection, or automatic
orders.

App3 Tester is a research/test tool, not investment advice. Historical returns
do not guarantee future returns.
