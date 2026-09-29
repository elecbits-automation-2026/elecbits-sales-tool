# TODO — turn on email intake, then finish the deal-level comms work

Written 29 Sep 2026. Two halves: **A** is setup nobody has done yet, half an
hour in a browser and no code. **B** is the code that is still missing once
the mail is flowing. A does not depend on B; do A whenever.

---

## Where this came from

`/api/inbox` failed with:

> ankita.shrivastava@elecbits.in: gmail token: Client is unauthorized to
> retrieve access tokens using this method, or client not authorized for any
> of the scopes requested.

The service account had no Workspace **domain-wide delegation**. Granting it
would have worked — and would have let anyone holding that key read *every*
mailbox on elecbits.in, silently. Delegation cannot be narrowed to one
mailbox; that is a property of the mechanism, not a setting we missed.

So the decision was: **one mailbox the team feeds, consented once.** The code
for it is merged (PR #50). The setup below is what remains.

---

## A · One-time setup

Nothing here needs a Workspace super admin, and nothing here touches anyone
else's mail.

### 1 · The mailbox

Create `clients@elecbits.in` (or whatever name) in Workspace. A **user
account**, not a group — a group has no inbox the Gmail API can read.

### 2 · Gmail API

Cloud Console → the **same project as the Drive service account** → APIs &
Services → Library → **Gmail API** → Enable. Drive working does not imply
Gmail is on.

### 3 · Consent screen

APIs & Services → OAuth consent screen → **User type: Internal**.

> Internal is the whole game. It is offered only because elecbits.in is a
> Workspace domain, and it means no Google verification and **no token
> expiry**. Choose External and leave it in Testing and the refresh token
> dies after 7 days — intake stops with `invalid_grant`, which
> `api/inbox.js` now names explicitly, but avoid the situation.

### 4 · OAuth client

APIs & Services → Credentials → Create credentials → **OAuth client ID** →
**Web application**.

Authorised redirect URI, verbatim:

```
https://elecbits-sales-tool.vercel.app/api/inbox?action=oauth-callback
```

Keep the **Client ID** and **Client secret**.

### 5 · First two env vars

Vercel → Settings → Environment Variables:

| Name | Value |
|---|---|
| `INBOX_OAUTH_CLIENT_ID` | from step 4 |
| `INBOX_OAUTH_CLIENT_SECRET` | from step 4 |

**Redeploy** — Vercel does not apply new vars to a running deployment.

### 6 · Consent, once

Open `https://elecbits-sales-tool.vercel.app/api/inbox?action=oauth-url`
and follow the `open` link it returns.

**Sign in as the mailbox, not as yourself.** Use an incognito window so the
wrong Google account is not picked up automatically. This is the mistake that
costs the most, because it fails weeks later and looks like something else —
the callback prints `consentedAs` so it is caught in the moment instead.

### 7 · The other two env vars

The callback page returns `INBOX_OAUTH_REFRESH_TOKEN` and
`INBOX_GMAIL_USER`. Store both in Vercel, redeploy, then check:

```
https://elecbits-sales-tool.vercel.app/api/inbox?action=status
```

Wanted: `"method": "consented mailbox (reads this inbox only)"`.

The refresh token is a password for that inbox. Revoke at
<https://myaccount.google.com/permissions> if it ever leaks.

### 8 · Feed it — and this part matters

On each client's **Client Comms** tab: the mailbox address, plus a one-line
brief of what to keep.

**CC the address, or auto-forward to it. Do not use the Forward button.**

| How the mail arrives | `From` header | Usable? |
|---|---|---|
| CC'd on the thread | the real sender | ✅ and it catches our outbound too |
| Gmail auto-forward rule (Settings → Forwarding) | the real sender | ✅ |
| Someone presses **Forward** | *the forwarder* | ❌ everything logs as from them |

`/api/inbox` reads headers and a snippet, not the quoted body, so a manually
forwarded mail has no recoverable sender. Recovering it means parsing forward
preambles — possible, messy, breaks on some clients. Not built.

---

## B · Code still to write

Ordered. Each is independently shippable.

### B1 · Stamp `dealId` on everything the comms path writes  · small

`org_activities.deal_id` exists and `saveTouch` already writes `t.dealId`.
**Every caller passes `""`.** So on Schneider with six live projects, every
email and every logged meeting is filed company-wide, and `belongsToDeal`
correctly refuses to show a company-level record on any one deal when
several are live — the record exists and reaches no deal room.

Same rule that was fixed for tasks, hitting from the other side. Fix this
first; it unblocks the rest and is worth doing even if B2/B3 never happen.

### B2 · A meeting log in the deal room · ~1 day

The write-up pipeline already exists in `CommsTab` — paste notes or a
transcript and the AI produces a touch, commitments both ways, decisions,
ideas, objections, a Markdown MoM filed to Drive, and next steps. It is on
the **company**, and the deal room has no meeting log at all.

Needed: the list, rendered per deal (needs B1), and a "log a meeting" entry
point that accepts pasted notes, a transcript, or an uploaded recording, and
drops the resulting next steps into the task list below it.

Audio is already built but pointed at the internal scrum:
`sales-recordings` (private bucket, `21-recordings-bucket.sql`),
`UploadRecording`, and the Fireflies proxy `api/fireflies.js`. Re-pointing
is wiring, not new plumbing.

### B3 · Scheduled pull, and routing to the right deal · depends on B1

Intake is a button today. A Vercel cron every 15 minutes is enough; Gmail
push via Pub/Sub is the alternative and is more setup than it is worth here.

The hard part is not Gmail, it is **which of the six Schneider projects this
email belongs to**. The sender's domain gives the company; nothing in the
mail reliably gives the deal. Three layers, in order:

1. **Match the per-deal POC** — `deals.contact_id` (migration 32, already
   applied). Emmanuel Adan's mail goes to the deal he is POC for. Depends on
   the POC fields actually being filled in.
2. **Ask the AI**, with `deals.context` in the prompt. Allowed to say unsure.
3. **An Unfiled tray** on the company, one click to assign.

Build all three. Layer 3 is not a fallback to skip: silently filing a
Schneider email under the wrong project is worse than asking.

---

## Also still open, unrelated to email

- **Eb-Master_Register** (Google Sheet) shared as **Editor** with the Drive
  service account. Until then minting a Client ID fails rather than
  half-succeeding — SOP Law 6 puts the register row before the folder, so a
  failed append means no ID is issued. Everything else works without it.
- The **touch logger never asks which project** a call was about, so touches
  get no `dealId` — the same gap as B1, at the other entry point.
- `StepProof` in `src/App.tsx` is defined and never rendered. Dead since the
  step modal went; delete when someone is next in that file.
