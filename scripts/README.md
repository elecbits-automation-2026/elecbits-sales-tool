# Health check

Tests a deployment's seams and turns "the page doesn't work" into a named
cause.

Everything that has actually broken with this tool was a deployment problem,
not a code problem: an env var set on the wrong Vercel project, a `VITE_`
variable added without a redeploy, a schema missing from Exposed schemas, a
migration that never ran. From the outside they all look the same.

```bash
npm run check -- --url https://elecbits-sales-tool.vercel.app
```

Exits `0` when everything passes, `1` when something failed, `2` when the
script itself could not run — so it drops straight into CI.

## Flags

| Flag | What it does |
|---|---|
| `--url <origin>` | what to test (required) |
| `--db` | also query Supabase directly; needs `SUPABASE_URL` and `SUPABASE_ANON_KEY` in the environment |
| `--json` | machine-readable report on stdout |
| `--quiet` | failures only |

`npm run check:ci` is `--quiet --db`.

## What it checks

**Reaching it** — the origin answers, the HTML is the built app (`#root` is
present), and a hashed production bundle is linked. A dev index or a
misrouted domain fails here rather than confusing the later checks.

**Serverless functions** — that `/api/claude`, `/api/drive` and
`/api/fireflies` exist at this origin and, where they can say so, whether their
credentials are configured. It distinguishes three states that look identical
in a browser:

- *not deployed* — the route returns 404, or an SPA fallback hands back
  `index.html` instead of JSON. `vite preview` always does the latter, so
  test against `vercel dev` or the real deployment.
- *deployed but unconfigured* — the function answers and reports its own
  missing secret.
- *working*.

The Claude check probes the contract **without spending a token**: an empty
POST body must be rejected with `400`, while a missing key answers `500`. That
is enough to tell "key present" from "key absent" without ever running a
completion.

**Database** (`--db`) — that `core` and `sales` are both in Exposed schemas
(if either is missing, PostgREST answers 404 for every table in it and the app
silently loads empty), and that `sales.tasks` is queryable in the `doing`
state.

That last one exists because of a specific trap: `17-task-states.sql` is in no
`RUN-THIS-*` bundle, but the app writes `status = 'doing'` in seven places. A
database built only from the bundles rejects every attempt to start a task.
See `supabase/README.md`.

## What it cannot check

Anything that needs a signed-in session — the pipeline, the gates, the KPI
maths. Those need real credentials and real data, and guessing at them would
make the script lie. It tests the seams, not the screens.

## Why there is no browser here

The PMS equivalent (`scripts/check-meetings.mjs`) drives a real browser with
Playwright, which is right for it: its risky features are UI flows across two
Google APIs. This tool's failures are configuration, not interaction, so this
script is deliberately dependency-free — Node 18+ and nothing else. A check
script that needs `npx playwright install chromium` before it says anything is
a check script nobody runs.
