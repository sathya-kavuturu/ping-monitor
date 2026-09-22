# Secure Electron Monitor

Electron + React + TypeScript network monitoring dashboard, built with `electron-vite`. Started as
a scaffold demonstrating a locked-down IPC bridge and a Prisma/SQLite persistence layer; has since
grown into a full "Monitored Targets" dashboard - live ping/traceroute, a branching Network Path
view, historical charts, threshold alerting, DB export/import/analytics, and self-updates. Packaged
builds are published under the product name **Ping Monitor** (see `electron-builder.yml`).

## Run it

```bash
npm install      # also runs `prisma generate` + rebuilds better-sqlite3 for Electron (postinstall)
npm run dev      # dev server + electron with HMR
npm run build    # typecheck + production build to out/
```

Database commands (only needed when you change `prisma/schema.prisma`):

```bash
npm run db:migrate    # prisma migrate dev --name <...> - creates prisma/migrations/*/migration.sql
npm run db:generate   # regenerate the Prisma Client into src/generated/prisma
npm run db:studio     # prisma studio, browsing prisma/dev.db (the CLI's dev database, not the app's)
```

Release builds (`npm run build:win`/`:mac`/`:linux`) only upload anywhere if `GH_TOKEN` is set and
`--publish` is passed - see `.github/workflows/release.yml`, which does exactly that on every `v*`
tag push.

## Structure

```
prisma/
  schema.prisma        # Target / PingHistory / HopHistory / AlertRule models
  migrations/           # SQL migrations, shipped with the app and applied at runtime (see below)
resources/
  tray-icon.png         # system tray icon, shipped with the app (see electron-builder.yml `files`)
  icon.png              # window/build icon
src/
  main/                 # Electron main process (Node/OS access lives only here)
    index.ts             # BrowserWindow, security policy, IPC handlers, engine/watchdog/tray/updater wiring
    tray.ts               # system tray icon + context menu (Show Dashboard / Quit)
    updater.ts             # electron-updater wiring - checkForUpdates/downloadUpdate, update:status events
    settings.ts             # persisted app-wide settings (currently just the global ping interval)
    utils.ts
    network/
      engine.ts            # NetworkEngine - per-target ping (1s) + traceroute (30s) loops
      ping-probe.ts          # real ICMP latency via the `ping` npm package
      traceroute.ts           # spawns tracert/traceroute via child_process, output parsed to HopSample[]
      traceroute-windows.ts    # Windows-specific tracert argument/output handling
      icmp-windows.ts           # native ICMP via koffi (iphlpapi.dll) - custom-TTL probes for traceroute
      resolve-ipv4.ts            # forces IPv4 resolution for hosts that also carry AAAA records
      forward-dns.ts              # resolves a hostname (or IP literal) to the address that gets pinged
      reverse-dns.ts                # PTR lookups for traceroute hop addresses
      ip-hosting.ts                  # on-demand hosting/ISP-org lookup per hop IP (ip-api.com), paced + cached
    alerting/
      watchdog.ts            # AlertWatchdog - evaluates live samples against configured thresholds
      notifications.ts        # renders an AlertEvent as a native OS Notification
    db/
      client.ts           # Prisma Client singleton (better-sqlite3 driver adapter)
      migrate.ts           # applies prisma/migrations/*/migration.sql at startup
      targets.ts            # target CRUD + reordering + showInOverview/pingingEnabled toggles
      ping-history.ts        # savePingRollup (1-min aggregation) / getPingHistory
      hop-history.ts          # saveHopHistory (traceroute) / getHopHistory / getHopHistoryRange
      storage-stats.ts         # per-table row counts + on-disk byte usage, for the DB Analytics tab
      import-export.ts          # export/import the whole SQLite file as a separate, read-only dataset
  preload/              # The ONLY bridge between main and renderer
    index.ts             # contextBridge.exposeInMainWorld('api', ...)
    index.d.ts            # types window.api for the renderer
  renderer/             # React app (sandboxed, no Node access)
    src/
      App.tsx                       # owns target state + the per-target 10-min live-update buffer
      lib/
        chart-data.ts                 # NetworkUpdate[] -> uPlot series (latency + time-based rolling loss %)
        chart-loss-markers.ts           # shared uPlot draw hook: one red bar per lost-ping timestamp
        chart-legend.ts                  # hover-tooltip timestamp formatter (shows seconds, not just h:mm)
        route-table.ts                     # NetworkUpdate[]/HopRecord[] -> per-hop MTR-style aggregation
        path-graph.ts                       # same data -> a branching hop graph for Network Path
        overview-chart.ts                     # live-buffer multi-target series for the Overview tab
        overview-history-chart.ts               # DB-backed (24h/7d/30d) equivalent of overview-chart.ts
        ping-history-chart.ts                     # PingHistoryRecord[] -> uPlot series, incl. per-bucket loss %
        use-hop-hosting.ts                          # shared, cached hosting/ISP lookup hook
        target-loss.ts                                # rolling recent loss % + severity, for the sidebar's badge
      components/
        Sidebar.tsx                    # target list: add/reorder/edit/delete, "Disable Pinging" trigger,
                                        #   a rolling loss-% badge per target
        MainContent.tsx                 # stat cards + alerts + timeline chart + route table + network path
        TimelineChart.tsx                 # uPlot: latency, loss bars + rolling loss % line, last 10 min
        RouteTable.tsx                     # MTR-style hop table with hostname/hosting-org lookups
        PathVisualization.tsx               # ThousandEyes-style branching hop-to-hop path view
        OverviewChart.tsx                     # all-targets tab: combined or per-target charts, live or historical
        IndividualLatencyChart.tsx             # one target's chart within Overview's "Individual" view
        AllAlerts.tsx                            # consolidated alert-rule view across every target
        DbStorageView.tsx                          # DB Analytics: storage stats + export/import
        ImportedDbView.tsx                           # read-only browsing of a previously imported dataset
        AddTargetDialog.tsx / EditTargetDialog.tsx     # target create/edit forms
        DisablePingingDialog.tsx                         # multi-select: pause/resume pinging per target
        ConfirmDialog.tsx / Modal.tsx / ContextMenu.tsx    # shared dialog/menu chrome
        TimeRangeControls.tsx / Sparkline.tsx                # small shared chart controls
        UpdateDialog.tsx                                       # auto-update check/download/restart prompt
        HelpDialog.tsx
  shared/               # types + IPC channel names imported by all three sides
    ip-utils.ts           # private/reserved/CGNAT address check - shared by the main-process hosting
                          #   lookup (skip it) and the renderer's path labels ("Your Network"/"No reply")
  generated/prisma/     # generated Prisma Client (gitignored, regenerated by `prisma generate`)
```

## Security model

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` on every `BrowserWindow`.
- The renderer never touches `ipcRenderer`, `require`, or Node globals — the preload script is
  the only place `contextBridge` is used, and it exposes a narrow, typed `window.api` (see
  `src/shared/types.ts#ExposedApi`) instead of raw IPC.
- IPC channel names live in one place (`src/shared/ipc-channels.ts`) so main/preload/renderer
  can't drift on string literals.
- `ipcMain.handle` validates `event.senderFrame` against the app's own origin before running,
  so a handler can't be invoked from an unexpected frame (e.g. an injected `<iframe>`).
- A strict `Content-Security-Policy` is set both via a `<meta>` tag and via
  `session.defaultSession.webRequest.onHeadersReceived`.
- `setWindowOpenHandler` routes `target="_blank"` links to the OS browser instead of opening an
  uncontrolled `BrowserWindow`; `will-navigate` blocks navigating the main window off its own
  origin; `<webview>` attachment is disabled entirely.
- The SQLite file lives under `app.getPath('userData')`, never inside the app bundle; only the
  main process ever touches `better-sqlite3`/Prisma, the renderer only ever sees plain data
  returned from validated IPC handlers.
- Same for the network engine: only the main process spawns `ping`/`tracert`/`traceroute` child
  processes, and only the main process makes the outbound hosting-lookup HTTP request
  (`ip-hosting.ts`). The renderer never sees a host string go anywhere near `child_process` or
  `http` - it only ever receives already-resolved data over IPC.

## IPC contract

Grouped by feature area (see `src/shared/ipc-channels.ts` for the full channel-name list and
`src/shared/types.ts#ExposedApi` for the typed contract every side compiles against).

**Targets**

| Channel                        | Renderer API                                  | Payload                          |
| ------------------------------ | --------------------------------------------- | -------------------------------- |
| `targets:list`                 | `getTargets()`                                | `Target[]`                       |
| `targets:create`               | `createTarget(input)`                         | `Target`                         |
| `targets:update`               | `updateTarget(input)`                         | `Target`                         |
| `targets:delete`               | `deleteTarget(id)`                            | `void` (cascades history/alerts) |
| `targets:reorder`              | `reorderTargets(orderedIds)`                  | `void`                           |
| `targets:set-show-in-overview` | `setTargetShowInOverview(id, showInOverview)` | `Target`                         |
| `targets:set-pinging-enabled`  | `setTargetPingingEnabled(id, pingingEnabled)` | `Target` (re-syncs the engine)   |
| `targets:resolve-hostname`     | `resolveHostname(host)`                       | `string \| null`                 |
| `network:resolve-hop-hosting`  | `resolveHopHosting(address)`                  | `HopHostingInfo \| null`         |

**History**

| Channel                  | Renderer API                | Payload                                              |
| ------------------------ | --------------------------- | ---------------------------------------------------- |
| `ping-history:list`      | `getPingHistory(query)`     | `PingHistoryRecord[]`                                |
| `hop-history:list`       | `getHopHistory(query)`      | `HopRecord[]`                                        |
| `hop-history:range-list` | `getHopHistoryRange(query)` | `HopRecord[]` (most recent runs within a date range) |

**DB Analytics / import-export**

| Channel                         | Renderer API                    | Payload                |
| ------------------------------- | ------------------------------- | ---------------------- |
| `db:storage-stats`              | `getDbStorageStats()`           | `DbStorageStats`       |
| `db:export`                     | `exportDatabase()`              | `ExportDatabaseResult` |
| `db:import`                     | `importDatabase()`              | `ImportDatabaseResult` |
| `db:imported-info`              | `getImportedDbInfo()`           | `ImportedDbInfo`       |
| `db:imported-clear`             | `clearImportedDatabase()`       | `void`                 |
| `db:imported-targets-list`      | `getImportedTargets()`          | `Target[]`             |
| `db:imported-ping-history-list` | `getImportedPingHistory(query)` | `PingHistoryRecord[]`  |

**Alerts**

| Channel                   | Renderer API                       | Payload       |
| ------------------------- | ---------------------------------- | ------------- |
| `alert-rules:list`        | `getAlertRules(targetId?)`         | `AlertRule[]` |
| `alert-rules:create`      | `createAlertRule(input)`           | `AlertRule`   |
| `alert-rules:set-enabled` | `setAlertRuleEnabled(id, enabled)` | `AlertRule`   |
| `alert-rules:delete`      | `deleteAlertRule(id)`              | `void`        |

**Settings, updates & the live stream**

| Direction       | Channel                      | Renderer API            | Payload                                                               |
| --------------- | ---------------------------- | ----------------------- | --------------------------------------------------------------------- |
| renderer → main | `settings:get`               | `getSettings()`         | `AppSettings`                                                         |
| renderer → main | `settings:set-ping-interval` | `setPingIntervalMs(ms)` | `AppSettings` (reschedules every target's timer)                      |
| renderer → main | `update:check`               | `checkForUpdates()`     | fire-and-forget                                                       |
| renderer → main | `update:download`            | `downloadUpdate()`      | fire-and-forget                                                       |
| main → renderer | `update:status`              | `onUpdateStatus(cb)`    | `UpdateStatusEvent` (checking/available/downloading/downloaded/error) |
| main → renderer | `network:update`             | `onNetworkUpdate(cb)`   | `NetworkUpdate` (per target, every ~1s)                               |

Both push-style subscriptions (`onNetworkUpdate`, `onUpdateStatus`) return an unsubscribe function
so React components can clean up `ipcRenderer` listeners on unmount.

## Database layer

**Why better-sqlite3 + a Prisma driver adapter, not Prisma's default engine.** Prisma's
`prisma-client` generator (v6+) can run without its historical Rust query-engine binary by using
a **driver adapter** instead — here, `@prisma/adapter-better-sqlite3` wrapping the same
`better-sqlite3` connection you'd otherwise reach for directly. That avoids the classic
Electron+Prisma packaging headache (locating/unpacking a per-platform native query-engine binary
from inside `app.asar`): the generated client (`src/generated/prisma/`) is plain TypeScript, and
the only native module in the picture is `better-sqlite3` itself, which needs the usual
Electron-specific rebuild (`electron-rebuild`, wired into `postinstall`).

**Migrations at runtime.** A packaged app has no Prisma CLI and no shadow database available, so
`prisma migrate deploy` isn't an option. Instead, `prisma/migrations/*/migration.sql` (generated
by `npm run db:migrate` during development, and shipped with the app via `electron-builder.yml`'s
`files`) is applied by hand on startup (`src/main/db/migrate.ts`), tracked in a small
`_app_migrations` table — the same idea as Prisma's own `_prisma_migrations`, just self-managed
since the CLI isn't around to do it for us. See `src/main/db/client.ts#initDatabase`.

**Schema** (`prisma/schema.prisma`):

- `Target` — one row per monitored host: `id`, `name`, `host`, `sortOrder` (drives sidebar/Overview
  display order), `showInOverview` and `pingingEnabled` (two independent booleans — a target can be
  hidden from Overview while still actively pinged, but a paused target is _always_ excluded from
  Overview regardless of `showInOverview`, since there's no live data to show), `createdAt`.
- `PingHistory` — one row per **completed 1-minute rollup**, not one row per sample: raw ~1s
  probes are buffered in memory (`src/main/index.ts`) and flushed once a minute via
  `savePingRollup`, storing `sampleCount`, `lostCount`, and min/avg/max latency. At ~30
  samples/min that's ~1,440 rows/day/target instead of ~43,000.
- `HopHistory` — one row per hop of one traceroute run; rows sharing a `traceId` make up a run.
  A run is captured immediately when a target is added and refreshed on its own cadence (below).
  `getHopHistoryRange` uses a `groupBy` on `traceId` to fetch the most recent N runs within an
  arbitrary date range without scanning every hop row in that window.
- `AlertRule` — a user-configured threshold for one target (`metric`, `thresholdValue`, `enabled`).
  `metric` is a plain string column (SQLite has no enum type); validity is enforced in
  `src/main/db/alert-rules.ts`, not the schema.

**Export / import / storage stats** (`src/main/db/import-export.ts`, `storage-stats.ts`, the DB
Analytics tab's `DbStorageView.tsx`): `exportDatabase` opens a native save dialog and copies the
live SQLite file verbatim; `importDatabase` opens a native open dialog and copies the chosen file
into its own app-owned location as a **separate, read-only dataset** — it's never merged into the
live database, just browsable afterwards via `ImportedDbView.tsx` (a fresh `db:imported-*` read-only
IPC surface, entirely apart from the live one). `getDbStorageStats` reports live row counts and
on-disk bytes per table, plus a from-scratch capacity estimate for "today's targets and cadence,
run for 30 days" — not a projection from current size, since that would double-count whatever
history already exists.

## Network engine (`src/main/network/`)

`NetworkEngine` (`engine.ts`) is the actual monitoring service. It owns one independent timer
pair per target - no shared "tick" loop - so a slow probe on one target never delays another's.
It has no notion of "disabled" itself: it just tracks whatever `{id, host}[]` list it's handed by
`sync()`, diffing against what it already tracks (stop timers for anything missing, start timers
for anything new). A target's `pingingEnabled` flag (toggled via the sidebar's "Disable Pinging"
dialog) is enforced one level up, in `src/main/index.ts#refreshCurrentTargets`, by simply leaving
disabled targets out of the list passed to `sync()` - the same mechanism a deleted target already
relied on to stop being monitored.

- **Ping, every 1s** (`ping-probe.ts`): one ICMP echo, via a persistent native handle
  (`icmp-windows.ts`, `IcmpSendEcho` through `iphlpapi.dll`) on Windows, or the OS `ping` command
  via the [`ping`](https://www.npmjs.com/package/ping) npm package elsewhere. Returns latency in
  ms, or `null` if the packet was lost - the engine derives `status` from that (`null` → `offline`,
  `> 150ms` → `degraded`, else `online`) and broadcasts a `NetworkUpdate` immediately. The timeout
  is 3s, not 1s: an earlier, tighter 800ms timeout was measured (see git history around the "ping
  and trace handling" refactor) to read a steady 2-3% "loss" on a target with zero actual loss in a
  parallel `ping.exe` run - genuine round trips that landed just past 800ms, not real packet loss.
  Since 3s is longer than the 1s tick, ticks are deliberately **not** guarded against a previous
  probe for the same target still being in flight (there used to be a `pingInFlight` skip-this-tick
  check here) - that guard would otherwise silently drop whole samples now that a slow-but-real
  reply can outlive its own tick; overlapping probes were measured to cost nothing extra.
- **Traceroute, every 30s** (`traceroute.ts`/`traceroute-windows.ts`, backed by native ICMP via
  `icmp-windows.ts` on Windows for per-hop TTL control): parses each hop into a `HopSample`
  (hop number, address, latency; `null` address/latency = that hop never replied - a common,
  expected outcome for routers that filter or rate-limit ICMP TTL-expired replies, not a bug).
  **Decoupled from the ping cadence on purpose**: a real traceroute routinely takes many seconds
  to tens of seconds (each unresponsive hop waits out its own timeout) - running it every 1s would
  either queue up runs behind each other or hammer the network. A hard kill-timer bounds one
  pathological target's traceroute from blocking its own next attempt indefinitely.
- **Hop hostname/hosting**, resolved separately from the traceroute itself and only for hops
  actually displayed: `reverse-dns.ts` does PTR lookups per hop address; `ip-hosting.ts` looks up
  its owning organization/ISP via ip-api.com's free, keyless API, paced to stay under its
  45-requests/minute free-tier limit and cached per address for the process's lifetime, since a
  hop's owning org essentially never changes and the same router IPs repeat across runs/targets.
  Both are skipped entirely for a private/reserved/CGNAT address (`shared/ip-utils.ts`) - there's
  no public org to look up for your own router.

Every `NetworkUpdate` therefore aggregates two data sources at different freshness: a live ping
from _this_ tick, plus the most recently completed traceroute's hops (`hops`/`hopsCapturedAt`
tell the UI how stale that path is). `onSample`/`onTraceroute` callbacks (wired in
`src/main/index.ts`) are the engine's only way out - it never touches IPC or Prisma directly, so
it's easy to unit-test or swap the probes for something else (e.g. an SNMP poller) later.

## Frontend visualization

`App.tsx` keeps a rolling **last-10-minutes buffer per target** (`updatesByTarget`, pruned by
timestamp on every incoming `network:update` event) and passes the selected target's slice to
the components below - no DB round trip, no polling, just the live IPC stream. Longer views
(Overview's 24h/7d/30d ranges, Network Path's historical hop data) instead query the DB directly
through `ping-history:list`/`hop-history:range-list`.

**Timeline chart** (`TimelineChart.tsx`), via [uPlot](https://github.com/leeoniya/uPlot) - chosen
over a React-native charting lib (Recharts/ECharts) because it's canvas-based and built
specifically to redraw fast and often, which is exactly this use case (a fresh sample arrives
every ~1s per target and has to hit the chart without jank). It's a thin imperative wrapper: the
`uPlot` instance is created once in a `useEffect` and updated via `.setData()`/`.setSize()`
afterwards - never torn down and rebuilt on every tick, and never a React-managed DOM subtree.
Loss is shown two ways at once: a thin red vertical bar at every lost-ping timestamp
(`chart-loss-markers.ts`, drawn directly on the canvas so it lines up pixel-for-pixel with the
latency line's gap at that same timestamp - no visual offset between them), plus a dashed rolling
loss-% line on its own right-hand 0–100% axis (`chart-data.ts#computeRollingLossPercent`, a
**time-based** sliding window - fixed at 30 seconds of real time, not a fixed sample count, so the
same underlying loss rate reads the same whether the target is pinged every 1s or every 3s).
Hovering the chart shows seconds in the timestamp, not just hour:minute (`chart-legend.ts`).

**Network Path** (`PathVisualization.tsx`) renders a ThousandEyes-style branching graph, one node
per hop, built from `path-graph.ts`'s (hop number, address) grouping across several retained
traceroute runs - a hop that disagrees between runs (router load-balancing across equal-cost
paths) shows as parallel branches that re-merge once the runs agree again. Each node's label
prefers, in order: the hop's hosting/network org name (e.g. "Google LLC"), its reverse-DNS
hostname, `"Your Network"` for your own private/CGNAT gateway hop, or `"No reply"` for a hop that
never answered at all - a bare `"Hop N"` is only ever a last resort. Every node is colored by
`route-table.ts#hopStatus` - the same per-hop-number loss % `RouteTable` computes, not just that
node's own latency - so a hop that's silent part of the time reads as degraded/offline even on the
branch where it did reply, instead of only the separate "silent" branch looking unhealthy. Selecting
a time range on the timeline chart re-queries the path for that same window (`getHopHistoryRange`),
so Network Path isn't limited to only ever showing the live buffer's most recent runs.

**Route table** (`RouteTable.tsx`) is deliberately _not_ a plain dump of the latest traceroute -
`route-table.ts` aggregates several recent runs into one row per hop number (address/hostname/
latency from the most recent run that got a reply, hosting org alongside it, and a **loss %** =
the fraction of those runs where that hop didn't reply at all). That's the same idea MTR/WinMTR
use to tell "this hop is flaky" from "this hop happened to drop one probe."

**Overview tab** (`OverviewChart.tsx`) shows every actively-pinged target at once, in one of two
modes (defaults to **Individual**): "All targets" overlays every target's latency + rolling loss %
on one shared chart; "Individual" renders one `IndividualLatencyChart` per target, each with its
own per-target checkbox to hide/show it. Either mode can point at the live buffer or, once a
24h/7d/30d range is selected, at DB-backed history (`overview-history-chart.ts`) - a target that
currently has pinging disabled (see below) never appears in either mode, since it has no live or
historical data worth charting for that window.

**Sidebar loss badge** (`target-loss.ts`, rendered in `Sidebar.tsx`): each target row shows a small
colored badge with its rolling loss % over the last 60 seconds of live samples - separate from the
status dot, which only reflects the single most recent sample. Thresholds: nothing below 0%, amber
under 5%, orange 5-15%, red 15%+. It's a pure function of the trailing window, not a timer someone
has to clear, so it disappears on its own once a full window has passed with no lost packet -
"colored for as long as there's been loss," nothing more to manage.

**Disable Pinging** (`DisablePingingDialog.tsx`, opened from the sidebar): a checkbox list of
every target, checked = actively pinged. Unchecking one immediately stops its engine timer (see
Network engine above) - it stays visible in the sidebar, dimmed with a "Paused" tag, so it's easy
to tell apart from a target that's merely offline.

**DB Analytics tab** (`DbStorageView.tsx`) surfaces `getDbStorageStats()` (per-table row counts,
on-disk bytes, a 30-day capacity estimate) alongside export/import controls; **Imported Data**
(`ImportedDbView.tsx`) browses a previously-imported dataset read-only, entirely separate from the
live database.

## Alerting watchdog (`src/main/alerting/`)

`AlertWatchdog` (`watchdog.ts`) sits between the engine and notifications. It's fed every
`NetworkUpdate` the moment the engine produces it (`engine.onSample` -> `watchdog.evaluate` in
`src/main/index.ts`) and maintains its own rolling window per target (last 30 samples, ~1 minute)
independent of the DB's 1-minute rollups, which flush too slowly for near-real-time alerting.

For each `AlertRule` belonging to that target (configured via the selected target's **Alerts**
panel, or the consolidated **Alerts** tab - `AllAlerts.tsx` - which lists every target's rules in
one place; both persist through the same `alert-rules:*` IPC), it computes the current value
(rolling packet-loss % or rolling avg latency, whichever the rule's `metric` is), requires at
least 5 samples before evaluating (so one lost packet right after a target is added doesn't read
as "50% loss"), and compares it against `thresholdValue`. Firing is **edge-triggered**: a
notification goes out on the OK -> breached transition, then only once every 5 minutes while it
stays breached (not on every 1s tick), plus once more on breached -> OK ("recovered"). The
watchdog only ever calls back into `onAlert` - it doesn't know `Notification` exists. A target
with pinging disabled simply produces no samples, so its rules never fire while paused - there's
nothing else to wire up for that case.

`notifyAlertEvent` (`notifications.ts`) turns that callback into Electron's native `Notification`
API (Action Center / Notification Center / libnotify, depending on OS) - e.g. _"Alert: Office
Router - Packet loss is 12%, above your 5% threshold."_ Clicking a notification calls back into
`src/main/index.ts` to restore the window, whether it's hidden in the tray or just unfocused.
Every alert/recovery is also logged to console (`[watchdog] ...`) regardless of whether the OS
notification renders - a lightweight audit trail independent of the platform's toast system.

## System tray (`src/main/tray.ts`)

Closing the window doesn't quit the app: its `close` handler calls `event.preventDefault()` and
`hide()`s it instead, so the network engine and watchdog keep polling and can keep firing native
notifications with no window open at all. A tray icon (left-click toggles the window; right-click
gives a "Show Dashboard" / "Quit" menu) is the only other way back in - `app.on('window-all-closed')`
is now a no-op on every platform, since the tray, not a window, is what keeps the app alive.
`isQuitting` (flipped in `before-quit`, which always fires before any window's `close` event) is
what tells the two apart: without it, the tray's own "Quit" would just re-hide the window forever
instead of actually exiting.

Verified directly rather than assumed: attaching Node's inspector to the main process
(`electron . --inspect=<port>`) and calling `BrowserWindow.getAllWindows()` before/after a
simulated close confirmed `isDestroyed: false` throughout - the window is genuinely kept alive and
hidden, not torn down and silently recreated - and that `app.quit()` (the tray's real exit path)
still terminates the process cleanly.

## Auto-update (`src/main/updater.ts`, `.github/workflows/release.yml`)

`electron-updater` checks `github.com/<owner>/<repo>/releases` for a newer published release,
using `publish` config baked into the build (`electron-builder.yml`) - `checkForUpdates`/
`downloadUpdate` are user-triggered from `UpdateDialog.tsx`, which renders whatever `update:status`
event the updater last emitted (`checking` → `available`/`not-available` → `downloading` →
`downloaded`, or `error`); a `downloaded` update quits and relaunches into itself.

Releasing is entirely CI-driven: pushing a `v*` tag (after bumping `package.json#version`) runs
`.github/workflows/release.yml` on `windows-latest`, which builds and runs
`electron-builder --win --publish=always` - `releaseType: release` in `electron-builder.yml`
means a brand-new release publishes immediately rather than sitting as a draft. That setting only
applies at _creation_ time, though: if a release for a given tag already exists (e.g. from a prior,
interrupted run), electron-builder reuses it as-is and only uploads assets to it - so a release
that somehow got stuck as a draft has to be flipped to published by hand
(`gh release edit <tag> --draft=false`) rather than by re-running the workflow.
