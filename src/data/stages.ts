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
