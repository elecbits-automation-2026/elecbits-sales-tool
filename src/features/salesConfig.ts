/* ---------------------------------------------------------------------- */
/* Sales OS — pipeline / KPI / expenses configuration                      */
/*                                                                          */
/* These constants drive the HubSpot-style deal pipeline, the AI stage      */
/* transition forms, the KPI metrics, and the expense categories. They are  */
/* deliberately kept in one place so an admin-editable version (stored in   */
/* the `crm-stage-forms` collection) can override the defaults at runtime.  */
/* ---------------------------------------------------------------------- */

// The full client journey, as requested: lead → first meeting → physical
// meeting → RFQ → project ID creation → PM added → quote/LLD → negotiation →
// closure to PO. "Won" / "Lost" are the two terminal outcome columns.
export const PIPELINE_STAGES = [
  "Lead",
  "First Meeting",
  "Physical Meeting",
  "RFQ",
  "Project ID Creation",
  "PM Added",
  "Quote / LLD",
  "Negotiation / Discussion",
  "Closure to PO",
];

export const OUTCOME_STAGES = ["Won", "Lost"];
export const ALL_STAGES = [...PIPELINE_STAGES, ...OUTCOME_STAGES];

// A short colour token per stage for the board headers / chips.
export const STAGE_COLOR: Record<string, string> = {
  Lead: "slate",
  "First Meeting": "blue",
  "Physical Meeting": "indigo",
  RFQ: "purple",
  "Project ID Creation": "cyan",
  "PM Added": "teal",
  "Quote / LLD": "amber",
  "Negotiation / Discussion": "orange",
  "Closure to PO": "green",
  Won: "green",
  Lost: "red",
};

// Stages where a structural value is captured as part of the transition — the
// Pipeline uses these to prompt for the Project ID / PM name inline.
export const STAGE_CAPTURES: Record<string, { field: string; label: string; placeholder: string }> = {
  "Project ID Creation": { field: "projectId", label: "Project ID", placeholder: "PRJ-BB-0001" },
  "PM Added": { field: "pmName", label: "Project Manager", placeholder: "Assigned PM name" },
};

/* ---------------------------------------------------------------------- */
/* Default AI stage-transition question sets.                              */
/*                                                                          */
/* Keyed by the stage the deal is MOVING INTO. When a sales agent drags a   */
/* card, the AI intake chat is seeded with these questions, then adapts —   */
/* probing deeper on weak/negative answers (e.g. "not interested" →         */
/* "what did you pitch, and what was their exact objection?").              */
/* An admin can edit these on the KPI / Config page; overrides live in the  */
/* `crm-stage-forms` collection and win over these defaults.                */
/* ---------------------------------------------------------------------- */
export const DEFAULT_STAGE_FORMS: Record<string, string[]> = {
  "First Meeting": [
    "How did the first meeting come about, and who did you speak to?",
    "What did you pitch — walk me through the story you told them.",
    "What is their actual pain point or need in their own words?",
    "What is the next concrete step you agreed on?",
  ],
  "Physical Meeting": [
    "Who from their side attended the physical meeting (names + roles)?",
    "What did you demo or show them, and how did they react?",
    "What technical or commercial requirements did they confirm?",
    "Any competitors or existing vendors mentioned?",
  ],
  RFQ: [
    "What exactly are they asking us to quote (scope in detail)?",
    "What quantities, timeline and budget signal did they give?",
    "What are the must-have vs nice-to-have requirements?",
    "Who is the decision maker and what is their buying process?",
  ],
  "Project ID Creation": [
    "Confirm the finalised scope this Project ID will track.",
    "Which department will execute (Box Build / ODM) and why?",
    "Any special compliance, certification or IP considerations?",
  ],
  "PM Added": [
    "Who is the assigned Project Manager and why them?",
    "What is the kickoff plan and first milestone?",
    "What does the PM need from the client to start?",
  ],
  "Quote / LLD": [
    "Summarise the quote / LLD you sent (headline number + what's included).",
    "How was the number justified to the client?",
    "What is the client's reaction so far, and expected turnaround?",
  ],
  "Negotiation / Discussion": [
    "What specifically is being negotiated (price, terms, scope, timeline)?",
    "What is the client pushing back on, and what leverage do we have?",
    "What is your recommended concession and walk-away point?",
  ],
  "Closure to PO": [
    "What are the agreed final terms (value, payment terms, delivery)?",
    "What is the expected PO date and PO number if known?",
    "Any final blockers between us and a signed PO?",
  ],
  Won: [
    "Confirm the won value and the received/expected PO reference.",
    "What was the deciding factor that won this deal?",
    "What must happen next for smooth delivery hand-off?",
  ],
  Lost: [
    "What did you pitch, and what was the exact reason they said no?",
    "Was it price, timing, competitor, or fit — be specific.",
    "Is there any realistic path to revive this later? When would we re-approach?",
    "What would you do differently on a deal like this next time?",
  ],
};

// A generic set used for the "Lead → First Meeting" edges not covered above.
export const GENERIC_STAGE_FORM = [
  "What happened in this stage — give me the short story.",
  "What is the client's current sentiment and level of interest?",
  "What is the next step and by when?",
];

/* ---------------------------------------------------------------------- */
/* KPI metrics — what dept heads set for agents, and admin sets for heads.  */
/* Each metric is derived automatically from the data the tool already      */
/* captures, so attainment is measured, not self-reported.                  */
/* ---------------------------------------------------------------------- */
export const KPI_METRICS = [
  { key: "companiesAdded", label: "New companies added", unit: "companies", money: false },
  { key: "dealsCreated", label: "New deals opened", unit: "deals", money: false },
  { key: "meetingsHeld", label: "Meetings held (1st + physical)", unit: "meetings", money: false },
  { key: "stageAdvances", label: "Deals advanced a stage", unit: "advances", money: false },
  { key: "dealsWon", label: "Deals won", unit: "deals", money: false },
  { key: "revenueWon", label: "Revenue won", unit: "INR", money: true },
  { key: "activityLogs", label: "Client interactions logged", unit: "logs", money: false },
];

export const KPI_METRIC_KEYS = KPI_METRICS.map((m) => m.key);

// A deal untouched for this many days is flagged "stalled" (the firing tool).
export const STALE_DEAL_DAYS = 7;

// Company records missing any of these are flagged "incomplete" (no info missed).
export const REQUIRED_COMPANY_FIELDS = ["whatTheyDo", "industry"];

export const EXPENSE_CATEGORIES = [
  "Travel — Flight",
  "Travel — Train / Bus",
  "Travel — Cab / Fuel",
  "Accommodation",
  "Client Meals / Entertainment",
  "Samples / Demo Units",
  "Other",
];
