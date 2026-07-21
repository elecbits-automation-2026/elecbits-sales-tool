/* ---------------------------------------------------------------------- */
/* Constants & helpers                                                     */
/* ---------------------------------------------------------------------- */

const STAGES = [
  "Dept Review",
  "Technical Review",
  "Quotation",
  "Approval",
  "Won",
  "Lost",
];

// Leaving these stages requires a logged approval before the project can move on.
// "Dept Review" can only be approved by the receiving department's Manager (or Main Admin) — see canApproveGate.
const APPROVAL_GATES = ["Dept Review", "Technical Review", "Quotation"];

// Sales creates RFQs/leads; Box Build and ODM execute the build work; Product is
// also part of the tool. These are the only departments the Sales tool uses.
const DEPARTMENTS = ["Sales", "ODM", "Box Build", "Product"];

// Departments that execute build work — projects only become visible to them
// once a PM explicitly assigns the project to that department.
const EXECUTION_DEPARTMENTS = ["Box Build", "ODM"];

// Departments allowed to see budget figures, regardless of tier.
const BUDGET_VISIBLE_DEPARTMENTS = ["Box Build", "ODM"];

const TIERS = ["Main Admin", "Manager", "User"];

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

// Bootstrap Main Admin — the ONE account seeded on first run so someone can log
// in and create everyone else through the Employees screen. Its identity comes
// from env vars (set in .env.local), so no real people are hardcoded here:
//   VITE_BOOTSTRAP_ADMIN_EMAIL  — the admin's @elecbits.in email
//   VITE_BOOTSTRAP_ADMIN_NAME   — display name (optional)
// The matching Supabase Auth login (email + password) is created out-of-band by
// scripts/seed-auth.mjs, so no password is stored in the browser bundle.
const BOOTSTRAP_ADMIN_EMAIL = (import.meta.env.VITE_BOOTSTRAP_ADMIN_EMAIL || "").trim().toLowerCase();
const BOOTSTRAP_ADMIN_NAME = (import.meta.env.VITE_BOOTSTRAP_ADMIN_NAME || "Main Admin").trim();

const BOOTSTRAP_ADMIN = BOOTSTRAP_ADMIN_EMAIL
  ? {
      id: "u-admin",
      name: BOOTSTRAP_ADMIN_NAME,
      email: BOOTSTRAP_ADMIN_EMAIL,
      password: "", // auth handled by Supabase; never stored client-side
      department: null,
      additionalDepartments: [],
      tier: "Main Admin",
      active: true,
      createdAt: daysAgo(0),
    }
  : null;

// Seeded into the crm-users collection on first run. Just the bootstrap admin
// now — all other users are created dynamically via the Employees screen (which
// provisions a real Supabase Auth login through /api/admin).
const SEED_USERS = BOOTSTRAP_ADMIN ? [BOOTSTRAP_ADMIN] : [];



const TYPES = ["Box Build", "ODM"];

export {
  STAGES, APPROVAL_GATES, DEPARTMENTS, EXECUTION_DEPARTMENTS,
  BUDGET_VISIBLE_DEPARTMENTS, TIERS, daysAgo, BOOTSTRAP_ADMIN, SEED_USERS, TYPES,
};
