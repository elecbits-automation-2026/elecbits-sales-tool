# Reference artifact

`elecbits-sales-os-artifact.jsx` is a single-file Claude-artifact prototype of the
Sales OS (Tailwind, `window.storage`, browser-side Anthropic calls). It is **not
wired to the production backend** and is kept here only as a design/feature
reference.

It is the richer feature spec: beyond the eight core modules already implemented
in `src/`, it also demonstrates ideas worth porting into the Supabase version —

- Training assignment + overdue tracking
- Daily worklog + discipline score
- Composite Health score (KPI 50% / training 25% / discipline 25%)
- Admin "Force move" gate bypass (logged reason)
- Structured stage-gate extraction (summary / facts / risks / next action)
- AI template generation (intro email, WhatsApp, one-pager, quote note)
- Knowledge access tiers (everyone / leadership / admin)

Do not deploy this file directly: it uses the artifact sandbox's `window.storage`
(no persistence on a real site) and calls the Anthropic API from the browser with
the key exposed. The production app in `src/` persists via Supabase and proxies AI
through `/api/claude`.
