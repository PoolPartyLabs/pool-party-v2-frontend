# 04 — The Tools page: running hookrisk from the app

> `/tools` (PP-TOOLS-SCR-001). Paste a deployed Uniswap v4 hook address, get its hookrisk report.
> Added 2026-09-13 on the hackathon branch. Flag: `hookTools`, **on by default on this fork**.

`hookrisk/` is a standalone toolchain with its own CLI, its own Foundry harness and its own Slither
plugin, and until now the only way to see it work was a terminal. This page is the demo surface: one
form, one report, and an honest failure when the host cannot run a scan.

---

## 1. What the page does

One column. The form is at the top (chain, hook address, Analyze); the status and the rendered
`HOOK_RISK.md` run full width beneath it, because the report has wide score tables that a half-width
panel would make scroll sideways on a laptop.

Three states, and the third is the one that matters:

| State | What the user sees |
|---|---|
| idle | The form, and "No scan yet". No claim about any hook. |
| running | The stage the scan is actually in (reading the verified source · compiling · running the detectors and the harness) plus elapsed seconds. Not a spinner: a five-minute scan needs to look alive. |
| report | The Markdown, plus a gate badge. A **failed gate is a result**, shown with its full report. |
| could not run | The exact reason, and **no report**. Never an empty one. |

That last row is the whole posture of hookrisk restated in a UI. From `hookrisk/CLAUDE.md`: *a tool
that reports nothing looks exactly like success; never let a failure read as clean.* A page that
rendered an empty report when slither was missing would reintroduce precisely the failure the tool
exists to prevent.

---

## 2. How a scan runs

All of it server-side, Node runtime, in a child process. The browser never sees a key, a path or a
process.

```
POST /api/tools/hookrisk   { chainId, address }   ->  202 { jobId, status }   (or 200 + report, cached)
GET  /api/tools/hookrisk?jobId=<sha256>           ->  { status, report? , error? }
```

1. **Normalise and key.** The address is EIP-55 checksummed (`normalizeAddress`); the cache key is
   `` `${chainId}:${address.toLowerCase()}` ``, so the same hook typed in three casings is one scan.
2. **Cache.** The job directory is `$HOOKRISK_WORK_DIR/hookrisk/<sha256(cacheKey)>/`, defaulting to
   the OS temp dir. A `HOOK_RISK.md` there younger than **24 h** is returned immediately. The
   directory is named after a hash rather than the address because the default work root is the
   shared temp dir, where a listing would otherwise be a log of which contracts this host was asked
   about.
3. **Sweep.** Every request deletes sibling directories older than 24 h, skipping the one it is about
   to write. **There is no cron, and there does not need to be:** the only thing that creates a
   directory is a request, so a request is the only moment the set can have grown.
4. **Job.** Otherwise a background job starts and the POST returns `202` with its id. The id IS the
   cache directory name, so two tabs asking about the same hook converge without coordination.
   Statuses: `queued → fetching-source → building → scanning → done | failed`.
5. **The job body**, in this order (preflight first, on purpose: a host without foundry should learn
   that in a second, not after a minute of network and disk):
   - **preflight** `forge --version`, slither, and `$HOOKRISK_HOME/cli/dist/cli.js`. Missing any of
     them fails the job immediately with a message naming each one and the command that installs it.
   - **source** Etherscan V2 `getsourcecode`. `SourceCode` comes back in three shapes and the caller
     does not get to choose: a bare `.sol` file, a standard-json-input wrapped in **doubled** braces
     (`{{ … }}`, not valid JSON until the outer layer is peeled), or the older single-brace file map.
     All three parse. An unverified contract is `NOT_VERIFIED`, a named result.
   - **project** the sources are written back at the paths solc originally used, with
     `settings.remappings` copied verbatim into `remappings.txt` and a `foundry.toml` pinning the
     same solc, optimizer and EVM version. A standard-json verification is self-contained, so this
     reproduces the original compilation rather than reconstructing a dependency tree. Paths are
     sanitised first: they were chosen by whoever verified the contract, and we write them to disk.
   - **build** `forge build`.
   - **scan** `node $HOOKRISK_HOME/cli/dist/cli.js init` then
     `scan <File.sol>:<Contract> --root <job dir> --out <job dir> --log-json`, with
     `HOOKRISK_SLITHER_BIN` set.
   - **read** `HOOK_RISK.md`, and expose it.

**Exit codes**, from `hookrisk/errors/catalog.json` and `hookrisk/docs/TROUBLESHOOTING.md`:

| Code | Meaning here |
|---|---|
| `0` | Scan completed, gate passed. A report. |
| `2` | Scan completed, **gate failed**. Still a report, and shown as one. This is the single most important line in this document. |
| `10`–`70` | hookrisk could not run (`HR-Exxx`). No report; the page says so. |
| `64` | Bad command line, i.e. our bug. Treated as could-not-run. |

**Rate limit.** One running job per cache key. A second start for a hook already being scanned joins
that job rather than queueing another compile, so pressing Analyze five times costs one scan.

---

## 3. Configuration

All server-side. None of these is `NEXT_PUBLIC_`, and `ETHERSCAN_API_KEY` must never become one.

| Var | Default | Unset means |
|---|---|---|
| `ETHERSCAN_API_KEY` | — | A scan fails with `EXPLORER_KEY_MISSING`, named on the page. Nothing else in the app is affected. |
| `HOOKRISK_HOME` | `<repo>/hookrisk` | Fine for `pnpm dev`. The container sets `/opt/hookrisk`. |
| `HOOKRISK_WORK_DIR` | OS temp dir | Job dirs and the 24 h cache live here. Point it at a volume to keep the cache across restarts. |
| `HOOKRISK_SLITHER_BIN` | `$HOOKRISK_HOME/.venv/bin/slither` | What `make setup` inside `hookrisk/` creates. |
| `NEXT_PUBLIC_FEATURE_HOOK_TOOLS` | on (this fork) | `off` makes `/tools` 404 and drops the sidebar entry. |

**Running it locally** needs the toolchain: `cd hookrisk && make setup` (venv + slither + the
detector plugin + the pinned v4 deps + the CLI build), then `foundryup` if `forge` is not on PATH.

---

## 4. The container path (`WITH_HOOKRISK=1`)

```bash
# Default. Unchanged, alpine, no toolchain, byte-identical to before this existed.
docker build -t pool-party-v2 .

# With hookrisk.
docker build --build-arg WITH_HOOKRISK=1 \
             --build-context hookrisk=./hookrisk \
             -t pool-party-v2:hookrisk .
```

**Why a named build context.** `.dockerignore` excludes `hookrisk`, deliberately: `COPY . .` in the
builder stage would otherwise carry a Python + Foundry toolchain into every image of an app that
does not import it. Un-excluding it would change the default build. A named context is additive
instead. It is read by exactly one stage, `hookrisk-1`, which is unreachable when `WITH_HOOKRISK=0`,
so the default build never needs the flag and never resolves the context. (One wart:
`docker build --check` lints *every* stage, so it tries to resolve `hookrisk` as an image name and
errors. Real builds do not; `docker build --target runtime-0 .` is the quick proof.)

**What `WITH_HOOKRISK=1` actually installs**, in the runtime stage:

- **Debian bookworm-slim instead of alpine.** Not a preference: `foundryup` ships glibc binaries and
  slither's wheels are manylinux, so neither installs on musl without a source build. Node stays 22.
- `ca-certificates`, `curl`, `git`, `python3`, `python3-pip`, `python3-venv`. No `build-essential`:
  every wheel needed is prebuilt.
- **Foundry** via `foundryup` into `/opt/foundry`, system-wide so the non-root runtime user reaches
  it without a HOME of its own.
- **Slither** (`slither-analyzer>=0.11.5,<0.12`) into `/opt/slither-venv`. Its own venv because
  Debian marks the system interpreter externally-managed (PEP 668).
- **The hookrisk checkout** at `/opt/hookrisk`, then `npm ci && npm run build` in `cli/`, the Slither
  detector plugin (`pip install -e /opt/hookrisk/detectors`), and `scripts/fetch-deps.sh` (what
  `make deps` runs) to clone `harness/deps.lock` at its exact pinned commits.
- **A warmed compiler cache.** `SVM_HOME=/opt/svm`, world-writable, and one `forge build` of the
  harness at image-build time so the first scan does not pay for a solc download as a non-root user.

Expect that image build to take roughly **10 to 20 minutes** cold (foundryup, the slither wheels, six
git clones, and one v4-core compile) and to add on the order of **1.5 to 2.5 GB**.

---

## 5. How long a scan takes

| | |
|---|---|
| Cached (same hook, inside 24 h) | Immediate. The POST returns `200` with the report. |
| Warm host, small hook | **20 to 60 s.** Source fetch is a second; the rest is `forge build` plus the scan. |
| Typical hook, warm solc cache | **2 to 5 min.** The differential harness runs ~1285 fuzzed sequences. |
| Cold host (solc download, large dependency tree) | **5 to 12 min.** |
| Ceiling | `forge build` is capped at 12 min, the scan at 20 min; either overrun fails the job with a named timeout. |

The demo runbook's own numbers on a warm machine (`hookrisk/docs/hackathon/DEMO_RUNBOOK.md`) are 4 to
7 s per scan, but those clones are already built; this page pays for the compile every first time.

---

## 6. Known limits, stated here rather than discovered later

- **`[harness] constructorArgs` is not wired.** A hook whose constructor takes more than the
  `IPoolManager` the harness can derive on its own comes back with the harness **skipped** and
  `HR-E305` in the log, naming the exact argument types it needs. The scan still completes and the
  static half of the report is real; the invariants read `skipped`, which the report says out loud.
  This is hookrisk's documented behaviour and the page does not paper over it. Wiring it would mean
  asking a user for constructor arguments in the form, which is a design decision, not a bug fix:
  `hookrisk init` writes the `hookrisk.toml` and the fix is three lines in it (see DEMO_RUNBOOK step
  5). Deliberately deferred.
- **`hookrisk.toml` uses the generated defaults.** `init` writes the most conservative values for
  everything a tool cannot observe (unproven team, no fee), and nobody edits them per scan. So the
  *score* on this page is the floor for an unknown team, and the tier usually comes back as a range.
  That is the design working, and section 2 of the report says which dimensions are unmeasured.
- **The job registry is per process.** A second replica does not see the first's running job, and a
  restart forgets what was in flight. The 24 h disk cache is what actually survives, so the worst
  case is one wasted rerun rather than a wrong answer.
- **BlockSec HookScan is off.** It needs Docker inside the container and a 1.2 GB image; the scan
  runs with the hookrisk detectors and the harness only, and the report names `blocksec` as not run
  rather than silently scoring its dimensions zero.

---

## 7. Where the code is

| | |
|---|---|
| Route + loading | `src/app/[locale]/(auth)/(app)/tools/{page,loading}.tsx` (PP-TOOLS-SCR-001) |
| Screen + report renderer | `src/features/tools/HookRiskScreen.tsx` (PP-TOOLS-CMP-001), `components/MarkdownReport.tsx` (PP-TOOLS-CMP-002) |
| API | `src/app/api/tools/hookrisk/route.ts` (PP-TOOLS-API-001) |
| Server lib | `src/lib/tools/hookrisk/{paths,explorer,project,run,jobs,contract}.ts` (PP-TOOLS-LIB-001..006) |
| Flag | `src/lib/features/registry.ts` → `hookTools`; row in `docs/FEATURE_FLAGS.md` |
| Analytics | `docs/ANALYTICS_EVENTS.md` § Tools, five events, all from PP-TOOLS-CMP-001 |
| Seams | `docs/INTEGRATION_POINTS.md` § Tools |
