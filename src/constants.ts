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

const DEPARTMENTS = ["Sales", "Finance", "Box Build", "ODM", "HR", "Product", "Marketing"];

// Departments that execute build work — projects only become visible to them
// once a PM explicitly assigns the project to that department.
const EXECUTION_DEPARTMENTS = ["Box Build", "ODM"];

// Departments allowed to see budget figures, regardless of tier.
const BUDGET_VISIBLE_DEPARTMENTS = ["Finance", "Box Build", "ODM"];

const TIERS = ["Main Admin", "Manager", "User"];

// name, email, password, department (null for Main Admin), tier
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

const DEFAULT_USERS = [
  { id: "u-admin", name: "Sam Okafor", email: "sam.okafor@elecbits.in", password: "admin123", department: null, additionalDepartments: [], tier: "Main Admin", active: true, createdAt: daysAgo(200) },

  { id: "u-sales-mgr", name: "Alex Rao", email: "alex.rao@elecbits.in", password: "sales123", department: "Sales", additionalDepartments: [], tier: "Manager", active: true, createdAt: daysAgo(180) },
  { id: "u-sales-usr", name: "Jamie Lin", email: "jamie.lin@elecbits.in", password: "salesuser123", department: "Sales", additionalDepartments: [], tier: "User", active: true, createdAt: daysAgo(150) },

  { id: "u-fin-mgr", name: "Priya Menon", email: "priya.menon@elecbits.in", password: "finance123", department: "Finance", additionalDepartments: [], tier: "Manager", active: true, createdAt: daysAgo(170) },
  { id: "u-fin-usr", name: "Omar Siddiqui", email: "omar.siddiqui@elecbits.in", password: "financeuser123", department: "Finance", additionalDepartments: [], tier: "User", active: true, createdAt: daysAgo(140) },

  { id: "u-bb-mgr", name: "Dana Fox", email: "dana.fox@elecbits.in", password: "boxbuild123", department: "Box Build", additionalDepartments: [], tier: "Manager", active: true, createdAt: daysAgo(160) },
  { id: "u-bb-usr", name: "Ravi Chandran", email: "ravi.chandran@elecbits.in", password: "boxbuilduser123", department: "Box Build", additionalDepartments: [], tier: "User", active: true, createdAt: daysAgo(130) },

  { id: "u-odm-mgr", name: "Leo Tanaka", email: "leo.tanaka@elecbits.in", password: "odm123", department: "ODM", additionalDepartments: [], tier: "Manager", active: true, createdAt: daysAgo(155) },
  { id: "u-odm-usr", name: "Yuki Sato", email: "yuki.sato@elecbits.in", password: "odmuser123", department: "ODM", additionalDepartments: [], tier: "User", active: true, createdAt: daysAgo(125) },

  { id: "u-hr-mgr", name: "Mira Hassan", email: "mira.hassan@elecbits.in", password: "hr123", department: "HR", additionalDepartments: [], tier: "Manager", active: true, createdAt: daysAgo(165) },
  { id: "u-hr-usr", name: "Grace Lin", email: "grace.lin@elecbits.in", password: "hruser123", department: "HR", additionalDepartments: [], tier: "User", active: true, createdAt: daysAgo(135) },

  { id: "u-prod-mgr", name: "Theo Brandt", email: "theo.brandt@elecbits.in", password: "product123", department: "Product", additionalDepartments: [], tier: "Manager", active: true, createdAt: daysAgo(145) },
  { id: "u-prod-usr", name: "Isla Wong", email: "isla.wong@elecbits.in", password: "productuser123", department: "Product", additionalDepartments: [], tier: "User", active: true, createdAt: daysAgo(120) },

  { id: "u-mktg-mgr", name: "Nina Osei", email: "nina.osei@elecbits.in", password: "marketing123", department: "Marketing", additionalDepartments: [], tier: "Manager", active: true, createdAt: daysAgo(150) },
  { id: "u-mktg-usr", name: "Marco Diaz", email: "marco.diaz@elecbits.in", password: "marketinguser123", department: "Marketing", additionalDepartments: [], tier: "User", active: true, createdAt: daysAgo(110) },
];



const TYPES = ["Box Build", "ODM"];

export {
  STAGES, APPROVAL_GATES, DEPARTMENTS, EXECUTION_DEPARTMENTS,
  BUDGET_VISIBLE_DEPARTMENTS, TIERS, daysAgo, DEFAULT_USERS, TYPES,
};
