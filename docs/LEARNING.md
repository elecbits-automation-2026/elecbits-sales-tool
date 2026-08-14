# What the Sales OS needs to learn

The tool's intelligence is in the context the team feeds it, not the code.
Ten AI surfaces (stage gates, record assistant, account planner, Drive
intelligence, task-closure gate, work-update scorer, scrum organiser,
brainstorm write-up, product assistant, agentic Assistant) each read a
specific slice of knowledge; System Memory rides on every call. Empty slice →
the AI guesses. Full slice → it's sharp.

Shareable version: https://claude.ai/code/artifact/672ef3f7-47c4-4def-9c3b-c0d736258a59

## The five knowledge stores

1. **Company knowledge** (Companies → record) — *partial*. Fill every record
   to 100% (contact, designation, phone/email, city, industry, size, what they
   do, source, potential); add payment terms/billing as custom fields; paste
   the story-so-far into the record chat for pre-tool clients; mint the
   official `Eb-<industry>-<size>-<serial>` ID on every real client.

2. **Process knowledge** (Admin → gates & question sets) — *partial*. Rewrite
   the stage-gate questions per pipeline stage in Elecbits' own selling
   language; train the company-card question set; confirm the Project-ID
   application set with ULM; **supply the real box-build acceptance criteria**
   (current six are placeholders and they hard-block submission); decide which
   deals require an LLD and who signs it off.

3. **Product & service knowledge** (Product / Service) — *needed, highest
   value*. One entry per product family (Soundbox, ESL, Enote, IFPD, gateways,
   motor drivers, meters, dev boards): what it is, ideal customer, MOQ, price
   band, lead time, two-line pitch, objections + answers. Plus services &
   pricing model, case studies, competitor positioning. Use access tiers for
   sensitive entries.

4. **Commercial rules** (System Memory — injected into every AI call) —
   *partial*. Payment terms + exceptions, discount authority ladder, quote
   validity, MOQ policy, delivery-commitment rule, positioning line,
   escalation rules. Short and true.

5. **Documents** (Google Drive → Eb-07-Sales) — *partial*. File artifacts
   (RFQs, quotes, MoMs, drawings, POs, sign-offs) into each company folder,
   dated filenames; put one full deal's paper trail in a reference folder as
   study material; share any folder the AI should read with
   `elecbits-drive-reader@…iam.gserviceaccount.com`.

Plus **people & performance**: KPI targets down the chain, roster with exact
sign-in emails and roles, trainings linked to knowledge entries.

## Already encoded — no action

ID conventions (43 industries, 6 size codes, shared serial mint, 01 R&D / 02
SCS), the ULM request/sanction contract, and the learning loops (activity
filing, brainstorm lessons + idea credits, lost-deal post-mortems, the
work-update vault, AI gate verdicts).

## Supply checklist (priority order)

| # | Supply | Who | Where |
|---|---|---|---|
| 1 | Product-family entries | Product + Saurav | Product / Service |
| 2 | Commercial rules | Saurav / finance | System Memory |
| 3 | Real box-build criteria | Operations | Admin → question sets |
| 4 | Stage-gate questions per stage | Saurav | Admin → stage gates |
| 5 | Records to 100% + IDs + history | Every agent | Companies |
| 6 | KPI targets + roster | Admin + dept heads | Admin · Performance |
| 7 | Deal paper-trail reference + filing discipline | Every agent | Drive |
| 8 | Share client folders with the service account | Drive owner | Google Drive |
| 9 | Case studies + positioning | Leadership | Product / Service |
| 10 | Trainings against new entries | Dept heads | Performance |

**The test of robust:** ask the Assistant — "What should I pitch to a
40-store retail chain?", "What are our payment terms?", "What's the next step
on our biggest open deal, and what's in its folder?" When all three come back
specific and correct, the tool is fed.
