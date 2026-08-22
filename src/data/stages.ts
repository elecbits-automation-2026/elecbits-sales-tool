/* ─── THE SALES PROCESS ────────────────────────────────────────────────────
   The pipeline itself: its stages, the questions that gate each one, and the
   measures a person is held to. This was a block of literals inside App.tsx,
   which meant changing how Elecbits sells required editing a React component
   and shipping a build.

   It is data, so it lives in src/data/. The PMS goes one step further — its
   equivalent is GENERATED from the process documents in docs/process/ by
   scripts/build-process-map.mjs, so the documents are the source of truth and
   the app cannot drift from them. That is the shape to grow into: when these
   stages start changing more than once a quarter, generate this file from
   whatever the sales team actually maintains instead of hand-editing it.

   Nothing here imports from the app. Anything that needs React belongs in a
   component, not in this file.                                              */

export type Stage = { key: string; name: string };

/** The pipeline, in order. A deal's position is an index into this. */
export const STAGES: Stage[] = [
  { key: "lead", name: "Lead" },
  { key: "first_meeting", name: "First Meeting" },
  { key: "physical_meeting", name: "Physical Meeting" },
  { key: "rfq", name: "RFQ" },
  { key: "project_id", name: "Project ID" },
  { key: "pm_added", name: "PM Added" },
  { key: "quote_lld", name: "Quote / LLD" },
  { key: "negotiation", name: "Negotiation" },
  { key: "closure", name: "Closure" },
  { key: "po", name: "PO" },
];

export const stageIdx = (k: string): number => STAGES.findIndex((s) => s.key === k);
export const stageName = (k: string): string =>
  (STAGES.find((s) => s.key === k) || ({} as Stage)).name || k;

/* What must be answered before a deal may leave a stage. The AI runs the
   interview; these are the things it will not let pass unanswered. An admin
   can override the set per-stage in Admin → Gates, which is why this is
   DEFAULT_ and not the last word. */
export const DEFAULT_GATES: Record<string, string[]> = {
  lead: ["Where did this lead come from", "Which Elecbits product line fits", "Who is the contact and their role"],
  first_meeting: ["Who attended the meeting (both sides)", "What exact need did the client state", "What did you pitch and how did they react", "Agreed next step with a date"],
  physical_meeting: ["Where did you meet and who was present", "Requirements captured (specs, volumes, timelines)", "What was demonstrated or shown", "Client's budget or volume signals", "Agreed next step with a date"],
  rfq: ["Exact product / spec being quoted", "Quantity and delivery timeline", "Target price or budget from client", "Who is the decision maker", "Competitors in the picture"],
  project_id: ["Internal project ID created", "Scope summary in one or two lines", "Engineering owner assigned", "Feasibility or risk notes"],
  pm_added: ["Project manager name", "Kickoff date", "Key deliverables agreed", "Client-side point of contact"],
  quote_lld: ["Quote amount and validity", "Margin percentage", "LLD status (shared / pending)", "Who received the quote"],
  negotiation: ["Exact objections raised and by whom", "Price gap between us and client", "Competitor pressure details", "Concessions asked, concessions offered", "Expected decision date"],
  closure: ["Final agreed price", "Payment terms", "Delivery schedule", "Any pending approvals on client side"],
  po: ["PO number", "PO value", "Advance received (yes/no, amount)", "Delivery start date", "PO document received"],
};

/* What a salesperson is measured on. `pace` means the target is spread across
   the month and the person is judged against elapsed days, not the whole
   month's number on the 2nd. */
export const KPI_METRICS = [
  { key: "companies", label: "Companies added", pace: true },
  { key: "meetings", label: "Meetings held", pace: true },
  { key: "rfqs", label: "RFQs raised", pace: true },
  { key: "quotes", label: "Quotes sent", pace: true },
  { key: "pos", label: "POs closed", pace: true },
  { key: "revenue", label: "Revenue", pace: true, money: true },
  { key: "completeness", label: "Data completeness", pace: false, pct: true },
];

/* The company record. `req` fields drive the completeness score and the
   "fix this now" rail, so adding one raises the bar for every existing
   company at once — deliberate, and worth knowing before you add one. */
export const COMPANY_FIELDS = [
  { k: "name", label: "Company name", req: true },
  { k: "contactPerson", label: "Contact person", req: true },
  { k: "designation", label: "Designation", req: false },
  { k: "phone", label: "Contact phone", req: true },
  { k: "email", label: "Email", req: true },
  { k: "city", label: "City", req: true },
  { k: "industry", label: "Industry", req: true },
  { k: "whatTheyDo", label: "What they do", req: true, long: true },
  { k: "source", label: "Lead source", req: true },
  { k: "potential", label: "Annual potential (₹)", req: true, num: true },
  { k: "website", label: "Website", req: false },
  { k: "address", label: "Address", req: false, long: true },
];

export const REQ_FIELDS = COMPANY_FIELDS.filter((f) => f.req);

/** Days a deal may sit untouched before it goes amber, then red. */
export const STALE_AMBER = 4;
export const STALE_RED = 8;

/* ─── WHAT EACH STAGE ACTUALLY INVOLVES ────────────────────────────────────
   The PMS anchors a task to one of 308 process steps, and each step carries
   its action, its entry and exit questions, its template and the Drive path
   its output is filed at. All of that is GENERATED from five documents in
   docs/process/ — the documents are the source of truth and the app cannot
   drift from them.

   Sales has no such documents, so this is the honest substitute: one entry per
   pipeline stage, at the same shape, so the work window can show a person what
   this task is part of and what it has to produce.

   PROVENANCE, because it matters when you read these:

     exit      NOT written here. It is DEFAULT_GATES above — the questions the
               stage gate already interviews against today. Real, in use.
     entry     derived from the preceding stage's exit. If the previous
               stage's questions cannot be answered, this stage has not
               started, whatever the pipeline says.
     action /
     whatToDo /
     guidance  A FIRST DRAFT, inferred from what the gates demand and how the
               tool already behaves. Nobody in sales wrote them. They are
               meant to be corrected — treat a wrong one as a bug report
               against this file, not as the method.

   When these start changing more than once a quarter, generate this file from
   whatever the sales team actually maintains, the way the PMS does.          */

export type StageGuide = {
  action: string;      // the verb: what you are doing
  whatToDo: string;    // one line of scope
  entry: string;       // answerable before you start, or you have not started
  produces: string;    // the artefact this leaves behind, filed in Drive
  guidance: string;    // how to do it
};

export const STAGE_GUIDE: Record<string, StageGuide> = {
  lead: {
    action: "Qualify",
    whatToDo: "Establish that there is a real buyer, a real need, and a product line that fits.",
    entry: "Do you have a name, a company and a way to reach them?",
    produces: "The company record, with source and contact filled in.",
    guidance: "Fill the company record before anything else — completeness drives the KPI and every later stage reads it. Name the product line you think fits; if none does, say so and park the lead rather than carrying it.",
  },
  first_meeting: {
    action: "Meet",
    whatToDo: "First conversation. Hear the need in their words, pitch, and leave with a dated next step.",
    entry: "Is the lead qualified, and is a meeting actually booked?",
    produces: "A call log entry against the company, with the agreed next step.",
    guidance: "Log it the same day — a meeting nobody wrote up did not happen as far as this tool is concerned. Record who attended on both sides, and the next step WITH a date. A next step without a date is how deals go stale.",
  },
  physical_meeting: {
    action: "Visit",
    whatToDo: "In person. Capture real requirements — specs, volumes, timelines — and read the budget signals.",
    entry: "Did the first meeting end with an agreed reason to meet in person?",
    produces: "Requirements captured on the company record; expenses filed if you travelled.",
    guidance: "Write the specs down in their numbers, not your paraphrase. Volume and timeline are what engineering will be quoted against, so a vague answer here becomes a wrong quote later. File travel expenses while you remember them.",
  },
  rfq: {
    action: "Scope the quote",
    whatToDo: "Pin the exact thing being quoted, in what quantity, by when, against what budget.",
    entry: "Have requirements been captured, and has the client asked for a price?",
    produces: "An RFQ the engineering side can price.",
    guidance: "Name the decision maker and the competitors — both change how you price, and neither is discoverable later. If the client will not give a target price, record that they would not; it is a signal, not a blank.",
  },
  project_id: {
    action: "Raise the project",
    whatToDo: "Turn the RFQ into an internal project with an owner and a scope.",
    entry: "Is the RFQ complete enough for engineering to act on?",
    produces: "A project request into ULM's inbox (core.intake).",
    guidance: "Sales does not create projects — it raises a request and ULM decides. Give the summary in two lines and name the feasibility risks you already know about; a request that hides a risk gets sanctioned and then fails.",
  },
  pm_added: {
    action: "Hand over",
    whatToDo: "A project manager takes ownership and a kickoff is booked.",
    entry: "Has the request been accepted and a project created?",
    produces: "A named PM, a kickoff date, and the client's point of contact.",
    guidance: "Introduce the PM to the client-side contact yourself. The handover most likely to fail is the one where the client learns their PM changed by receiving an email from a stranger.",
  },
  quote_lld: {
    action: "Quote",
    whatToDo: "Send the price and the low-level design, and record what was sent and to whom.",
    entry: "Is there a PM and an agreed scope to quote against?",
    produces: "The quote document, filed in the company's Drive folder.",
    guidance: "Record the margin, not just the price — a quote whose margin nobody knows cannot be negotiated safely. Note validity, because an expired quote reopened at the old price is a loss nobody decided to take.",
  },
  negotiation: {
    action: "Negotiate",
    whatToDo: "Work the objections. Track the gap, the concessions and the competition.",
    entry: "Has the quote been received and responded to?",
    produces: "A written record of objections, concessions and the expected decision date.",
    guidance: "Write down what was ASKED for separately from what was OFFERED — conflating them is how a concession becomes permanent. Log the price gap as a number. An expected decision date is what stops this stage running for a quarter.",
  },
  closure: {
    action: "Close",
    whatToDo: "Agree the final price, terms, schedule and any remaining approvals.",
    entry: "Has the client signalled intent to proceed?",
    produces: "Agreed commercial terms, in writing.",
    guidance: "Payment terms and delivery schedule are part of the close, not paperwork afterwards. Name any approval still outstanding on their side — a deal closed against an unnamed approver is a deal that slips.",
  },
  po: {
    action: "Collect the PO",
    whatToDo: "Get the purchase order, the number, the value and the advance.",
    entry: "Are the commercial terms agreed?",
    produces: "The PO document, filed in the company's Drive folder.",
    guidance: "The PO document itself, in Drive — not just the number typed into a field. Record whether the advance was actually received, because 'PO received' and 'money received' are different days and Finance needs both.",
  },
};

/** The guide for a stage, or null when the key is unknown. */
export const guideFor = (key: string): StageGuide | null => STAGE_GUIDE[key] || null;

/** The question that must already be answerable — the previous stage's exit. */
export const entryGatesFor = (key: string): string[] => {
  const i = stageIdx(key);
  if (i <= 0) return [];
  return DEFAULT_GATES[STAGES[i - 1].key] || [];
};
