/* ─── COMPANY-WIDE TAXONOMY ────────────────────────────────────────────────
   The vocabularies this tool shares with the rest of Elecbits: the official
   client-ID nomenclature, the roles on the sales roster, and the 30-question
   LLD set the PMS also uses.

   These are NOT this tool's to invent. The industry codes and size codes come
   from EbClient_ID_Sheet and are the same numbers the PMS, ULM and Finance
   mint against — changing one here without changing it there produces two
   companies with the same official id. The LLD questions are the same set the
   PMS asks, so a customer answering them in Sales does not answer them again
   in delivery.                                                              */

/* ── Official client-ID nomenclature (EbClient_ID_Sheet) ──────────────────
   Eb-<industry 01-43>-<size>-<serial>. The serial comes from the shared
   core.numbering mint — never typed by hand. */
export const INDUSTRIES: [number, string][] = [
  [1, "Electric Vehicle"], [2, "EMS"], [3, "Just IoT"], [4, "IIoT"],
  [5, "Home Automation"], [6, "Medical & Healthcare"], [7, "Energy Meter & Metering"],
  [8, "Wearables"], [9, "Camera & Opticals"], [10, "Agri Tech/Farm Tech/Food Tech"],
  [11, "AR/VR/AI"], [12, "Education-Tech/EdTech"], [13, "Industrial/ Machine Setup"],
  [14, "ERP Solutions"], [15, "Robotics"], [16, "Information Technology"],
  [17, "Defence/Military"], [18, "Automotive"], [19, "Battery Manufacturer"],
  [20, "Consumer Electronics"], [21, "Other"], [22, "Government & Alliance"],
  [23, "Freelance/Individual/Personal"], [24, "Logistics/Fleet Management"],
  [25, "Fintech"], [26, "Aerospace"], [27, "BLDC"], [28, "Renewables"],
  [29, "Oil & Gas"], [30, "Smart home"], [31, "Research"], [32, "E-Mobility"],
  [33, "Infrastructure"], [34, "Toys and Games"], [35, "Incubator"],
  [36, "Security/ surveilance"], [37, "Electronics components manufacturing"],
  [38, "Drone tech"], [39, "Solar"], [40, "IT Hardware"], [41, "Display Manufacturers"],
  [42, "Industrial Applications"], [43, "Trader"],
];

export const ORG_SIZES: [string, string][] = [
  ["PL", "Proto Level — Small Hardware Startups"],
  ["ML", "Mid Level — Hardware Startups"],
  ["EL", "Enterprise Level — Large Product Companies"],
  ["EM", "EMS"],
  ["UN", "Individuals/Unknown"],
  ["GO", "Government Organisation"],
];

export const industryCodeOf = (label: string): number | null => {
  const m = INDUSTRIES.find(([, l]) => l.toLowerCase() === String(label || "").toLowerCase());
  return m ? m[0] : null;
};

/* ── LLD questions (30 — same set as the ODM PMS) ─────────────────────────── */
export const LLD_QUESTIONS = [
  { id: 1, sec: "Product", text: "What is the product you want to build? Describe it in one sentence." },
  { id: 2, sec: "Product", text: "What category does it fall into?" },
  { id: 3, sec: "Product", text: "What problem does it solve for the end user?" },
  { id: 4, sec: "Product", text: "Who is the target user?" },
  { id: 5, sec: "Product", text: "Any existing products or references we should study?" },
  { id: 6, sec: "Functions", text: "List the key features / functions this product must have." },
  { id: 7, sec: "Functions", text: "Which sensors or input devices are needed?" },
  { id: 8, sec: "Functions", text: "What outputs / actuators are required?" },
  { id: 9, sec: "Functions", text: "Does it need a user interface?" },
  { id: 10, sec: "Functions", text: "Any special processing needs (AI/ML, real-time, high-speed data)?" },
  { id: 11, sec: "Connectivity", text: "What wireless connectivity is needed?" },
  { id: 12, sec: "Connectivity", text: "Which wireless protocols are required (Wi-Fi, BLE, LoRa, Cellular, GPS…)?" },
  { id: 13, sec: "Connectivity", text: "Any wired interfaces needed (USB-C, Ethernet, RS-485, CAN…)?" },
  { id: 14, sec: "Connectivity", text: "Does it need cloud connectivity or a backend?" },
  { id: 15, sec: "Power", text: "How will the device be powered?" },
  { id: 16, sec: "Power", text: "If battery-powered, what is the expected battery life?" },
  { id: 17, sec: "Power", text: "Any power consumption constraints or targets?" },
  { id: 18, sec: "Power", text: "Does it need power-saving / sleep modes?" },
  { id: 19, sec: "Software", text: "Is there a companion mobile or web app?" },
  { id: 20, sec: "Software", text: "Does the firmware need OTA update capability?" },
  { id: 21, sec: "Software", text: "Any data logging, analytics or reporting requirements?" },
  { id: 22, sec: "Physical", text: "Approximate size constraints? (L × W × H in mm, or describe)" },
  { id: 23, sec: "Physical", text: "What environment will it operate in?" },
  { id: 24, sec: "Physical", text: "Enclosure material preference?" },
  { id: 25, sec: "Certs", text: "Which certifications are required (CE, FCC, BIS, RoHS, IP rating…)?" },
  { id: 26, sec: "Certs", text: "Any regulatory or compliance notes we should know about?" },
  { id: 27, sec: "Cost & Time", text: "What is the target unit cost (BOM) range?" },
  { id: 28, sec: "Cost & Time", text: "Expected production volume in the first year?" },
  { id: 29, sec: "Cost & Time", text: "Any hard deadline or launch date we must hit?" },
  { id: 30, sec: "Cost & Time", text: "Anything else we should know? Risks, constraints, special requests…" },
];

/* ── Roles on the sales roster ────────────────────────────────────────────
   These are sales-tool roles, stored in sales.people_detail.role. They are
   deliberately NOT core.people roles: the same person can be an agent here
   and an engineer in the PMS. */
export const ROLES = [
  { key: "admin", label: "Admin" },
  { key: "dept_head", label: "Dept Head" },
  { key: "agent", label: "Sales Agent" },
  { key: "finance", label: "Finance" },
];

/* `any`, not `string`: callers derive roles from untyped state
   (`[...new Set(users.map(u => u.role))]`), so a narrower type here would
   force a cast at the call site rather than catch anything. */
export const roleLabel = (r: any): string =>
  (ROLES.find((x) => x.key === r) || ({} as any)).label || r;
