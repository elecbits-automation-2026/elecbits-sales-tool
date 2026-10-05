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

---

## C · Turning the daily digest on — the exact steps

`api/digest.js` is built and tested (`npm run test:digest`, 46 assertions).
It renders both mails correctly; it only needs somewhere to post them.

Sending goes through Gmail, from ONE mailbox, in a Google Cloud project of
your own. The project does NOT have to be the one holding the Drive service
account (`elecbits-pms-odm-504516`) — that one belongs to the PMS, and its
consent screen is shared. A separate project keeps the two apart and removes
the one failure you could not fix yourself: somebody else's consent screen
left on External/Testing, which expires the token every 7 days.

Recipients need nothing. One consent sends to the whole team; an agent only
has to be on the roster, active, with tasks assigned.

### 1 · The person doing this

Cloud Console: any elecbits.in account that may create a project. If **New
Project** is greyed out, the Workspace admin restricts it — ask them to
create an empty project and make you Owner.

The CONSENT link later must be opened as the SENDING mailbox, whoever that
is. Those can be two different people; if they are, use an incognito window
for the consent so Google does not quietly reuse the wrong account.

### 2 · Create the project

console.cloud.google.com → project picker (top bar) → **New Project** →
name `elecbits-sales-os` → Create → switch into it.

Everything below happens inside that project. Check the top bar says so.

### 3 · Enable Gmail

<https://console.cloud.google.com/apis/library/gmail.googleapis.com> →
**Enable**. (**Manage** means it is already on.)

### 4 · Consent screen

<https://console.cloud.google.com/apis/credentials/consent> — in newer
consoles this is **Google Auth Platform**, tabs Branding / Audience /
Clients.

**User type: Internal.** This is the setting that matters. Internal is
offered only because elecbits.in is a Workspace domain, and it means no
Google review and **no token expiry**. External leaves the app in Testing,
where refresh tokens die after 7 days with an `invalid_grant` that reads
like something else entirely.

App name `Elecbits Sales OS`, your address for both email fields, skip the
logo and domains. On the **Scopes** page add nothing — the app asks for its
scope at consent time.

### 5 · OAuth client

<https://console.cloud.google.com/apis/credentials> → **+ CREATE
CREDENTIALS → OAuth client ID** → type **Web application** → name
`Sales OS digest`.

Leave JavaScript origins empty. Under **Authorised redirect URIs** add
exactly, copied not typed:

```
https://elecbits-sales-tool.vercel.app/api/inbox?action=oauth-callback
```

Character for character. A trailing slash or space gives
`redirect_uri_mismatch` two steps later.

Copy the **Client ID** and **Client secret**.

### 6 · First two variables

Vercel → Settings → Environment Variables → `INBOX_OAUTH_CLIENT_ID`,
`INBOX_OAUTH_CLIENT_SECRET` → **Redeploy**. Vercel does not apply new
variables to a running deployment.

### 7 · Consent, as the sending mailbox

Open `/api/inbox?action=oauth-url&for=digest`. The `for=digest` asks for
`gmail.send` rather than read access, and makes the callback name the
DIGEST_* variables.

Follow the `open` link **signed in as the sending mailbox**. Approve.

**Check `consentedAs` on the result page.** Consenting as the wrong account
is the one mistake that fails silently, days later.

### 8 · The rest of the variables

| Name | Value |
|---|---|
| `DIGEST_OAUTH_REFRESH_TOKEN` | from step 7 |
| `DIGEST_GMAIL_USER` | the sending address |
| `CRON_SECRET` | any long random string |
| `DIGEST_ONLY_TO` | **while testing** — the only address that receives |

Redeploy.

### 9 · Check, read, then send

`/api/digest?action=status` → wants `sender: gmail`, the right `sendsAs`,
`cronSecret: set`, and the **TESTING FILTER IS ON** warning. No warning
means a real send would reach the team.

`/api/digest?when=morning&preview=1` renders everyone's mail and sends
nothing. Then drop `&preview=1` for a real send — delivered only to
`DIGEST_ONLY_TO`, everyone else reported as `held`.

### 10 · Go live

Delete `DIGEST_ONLY_TO`, redeploy. `vercel.json` already runs it at 09:00
and 18:30 IST on weekdays.

**On Hobby, Vercel allows two crons and runs each about once a day rather
than to the minute** — a "9am" mail may land mid-morning. This uses exactly
two, so it fits; precise timing is the reason to be on Pro.

### Afterwards

The sender can be changed any time: consent again as the new mailbox, swap
the two DIGEST_* variables, redeploy, and revoke the old grant at
myaccount.google.com/permissions. Worth doing before the team sees it, so
the digests arrive from something like `sales-os@elecbits.in` rather than
from a colleague.
