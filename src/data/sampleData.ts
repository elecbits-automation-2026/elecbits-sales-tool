import { daysAgo } from "../constants";

/* ---------------------------------------------------------------------- */
/* Sample data — 5 clients, threaded through the whole process flow:       */
/* Lead -> Manager approval -> Client ID -> RFQ -> Dept Review -> Project  */
/* ID -> team allocation. Seeded only when storage is empty (see App).     */
/* ---------------------------------------------------------------------- */

const SAMPLE_CLIENTS = [
  { id: "CLT-0001", name: "Priya Nair", company: "Northwind Devices Inc.", email: "priya@northwinddevices.com", phone: "+91 98200 11122", createdBy: "Jamie Lin", createdAt: daysAgo(18) },
  { id: "CLT-0002", name: "Marcus Webb", company: "Solstice Robotics", email: "marcus@solsticerobotics.com", phone: "+91 98200 22233", createdBy: "Alex Rao", createdAt: daysAgo(15) },
  { id: "CLT-0003", name: "Ananya Iyer", company: "Vertex Circuits Ltd", email: "ananya@vertexcircuits.in", phone: "+91 98200 33344", createdBy: "Jamie Lin", createdAt: daysAgo(24) },
  { id: "CLT-0004", name: "David Kwon", company: "Halcyon Aerospace", email: "david@halcyonaero.com", phone: "+91 98200 44455", createdBy: "Alex Rao", createdAt: daysAgo(40) },
  { id: "CLT-0005", name: "Fatima Al-Sayed", company: "Bluepeak Instruments", email: "fatima@bluepeakinst.com", phone: "+91 98200 55566", createdBy: "Jamie Lin", createdAt: daysAgo(10) },
];

const SAMPLE_LEADS = [
  { id: "lead-0001", name: "Priya Nair", company: "Northwind Devices Inc.", email: "priya@northwinddevices.com", phone: "+91 98200 11122", notes: "Referral from a trade show — wants a custom enclosure build.", submittedBy: "Jamie Lin", status: "Approved", reviewedBy: "Alex Rao", reviewedAt: daysAgo(18), clientId: "CLT-0001", createdAt: daysAgo(19) },
  { id: "lead-0002", name: "Marcus Webb", company: "Solstice Robotics", email: "marcus@solsticerobotics.com", phone: "+91 98200 22233", notes: "Inbound from website contact form.", submittedBy: "Alex Rao", status: "Approved", reviewedBy: "Alex Rao", reviewedAt: daysAgo(15), clientId: "CLT-0002", createdAt: daysAgo(15) },
  { id: "lead-0003", name: "Ananya Iyer", company: "Vertex Circuits Ltd", email: "ananya@vertexcircuits.in", phone: "+91 98200 33344", notes: "Repeat client, second project this year.", submittedBy: "Jamie Lin", status: "Approved", reviewedBy: "Alex Rao", reviewedAt: daysAgo(24), clientId: "CLT-0003", createdAt: daysAgo(25) },
  { id: "lead-0004", name: "David Kwon", company: "Halcyon Aerospace", email: "david@halcyonaero.com", phone: "+91 98200 44455", notes: "Large ODM volume opportunity, high priority.", submittedBy: "Alex Rao", status: "Approved", reviewedBy: "Alex Rao", reviewedAt: daysAgo(40), clientId: "CLT-0004", createdAt: daysAgo(41) },
  { id: "lead-0005", name: "Fatima Al-Sayed", company: "Bluepeak Instruments", email: "fatima@bluepeakinst.com", phone: "+91 98200 55566", notes: "Small batch box build, tight timeline.", submittedBy: "Jamie Lin", status: "Approved", reviewedBy: "Alex Rao", reviewedAt: daysAgo(10), clientId: "CLT-0005", createdAt: daysAgo(11) },
  { id: "lead-0006", name: "Sana Malhotra", company: "Orbital Sensing Co.", email: "sana@orbitalsensing.com", phone: "+91 98200 66677", notes: "Cold outreach reply — needs qualification.", submittedBy: "Jamie Lin", status: "Pending", reviewedBy: null, reviewedAt: null, clientId: null, createdAt: daysAgo(1) },
];

const SAMPLE_PROJECTS = [
  // 1. Box Build — approved at Dept Review, now in Technical Review, assigned to the Box Build team.
  {
    id: "RFQ-0001",
    projectId: "PRJ-BB-0001",
    clientId: "CLT-0001",
    type: "Box Build",
    department: "Box Build",
    stage: "Technical Review",
    technicalScope: "Custom enclosure with 4-layer PCB, requires thermal management, target volume 5,000 units/quarter.",
    budget: "45000",
    timeline: "8 weeks",
    notes: [],
    architectureSummary: "",
    stakeholders: [],
    approvals: [{ id: "appr-1", stage: "Dept Review", approver: "Dana Fox", decision: "Approved", comment: "Capacity confirmed, taking this on.", createdAt: daysAgo(16) }],
    history: [
      { id: "h1", from: null, to: "Dept Review", by: "Jamie Lin", at: daysAgo(18) },
      { id: "h2", from: "Dept Review", to: "Technical Review", by: "Dana Fox", at: daysAgo(16), note: "Approved at Dept Review" },
      { id: "h3", label: "Project ID PRJ-BB-0001 assigned", by: "Dana Fox", at: daysAgo(16) },
      { id: "h4", label: "Ravi Chandran assigned to project as Lead Engineer", by: "Dana Fox", at: daysAgo(15) },
    ],
    createdBy: "Jamie Lin",
    assignedTo: "Jamie Lin",
    assignees: [{ id: "as1", name: "Ravi Chandran", roleInProject: "Lead Engineer" }],
    callLogs: [{ id: "cl1", by: "Jamie Lin", at: daysAgo(17) }, { id: "cl2", by: "Jamie Lin", at: daysAgo(12) }],
    createdAt: daysAgo(18),
    updatedAt: daysAgo(15),
  },
  // 2. ODM — still waiting on the department head's review; no Project ID yet.
  {
    id: "RFQ-0002",
    projectId: null,
    clientId: "CLT-0002",
    type: "ODM",
    department: "ODM",
    stage: "Dept Review",
    technicalScope: "Full ODM production of a wireless sensor module, including firmware validation and packaging.",
    budget: "120000",
    timeline: "14 weeks",
    notes: [],
    architectureSummary: "",
    stakeholders: [],
    approvals: [],
    history: [{ id: "h1", from: null, to: "Dept Review", by: "Alex Rao", at: daysAgo(15) }],
    createdBy: "Alex Rao",
    assignedTo: "Alex Rao",
    assignees: [],
    callLogs: [{ id: "cl1", by: "Alex Rao", at: daysAgo(14) }],
    createdAt: daysAgo(15),
    updatedAt: daysAgo(15),
  },
  // 3. Box Build — further along, in Quotation, two approvals logged.
  {
    id: "RFQ-0003",
    projectId: "PRJ-BB-0002",
    clientId: "CLT-0003",
    type: "Box Build",
    department: "Box Build",
    stage: "Quotation",
    technicalScope: "Second-generation enclosure revision with improved cable routing and EMI shielding.",
    budget: "62000",
    timeline: "6 weeks",
    notes: [
      {
        id: "n1",
        author: "Jamie Lin",
        createdAt: daysAgo(20),
        compiled: "Client need: revision of last year's enclosure with better EMI shielding.\nBudget signal: flexible, prioritizing quality.\nTimeline: 6 weeks, tied to their trade show date.",
        questions: { need: "Revision with better EMI shielding", budget: "Flexible", timeline: "6 weeks", scope: "", risks: "" },
      },
    ],
    architectureSummary: "",
    stakeholders: [],
    approvals: [
      { id: "appr-1", stage: "Dept Review", approver: "Dana Fox", decision: "Approved", comment: "Known client, straightforward revision.", createdAt: daysAgo(23) },
      { id: "appr-2", stage: "Technical Review", approver: "Dana Fox", decision: "Approved", comment: "Design review passed.", createdAt: daysAgo(19) },
    ],
    history: [
      { id: "h1", from: null, to: "Dept Review", by: "Jamie Lin", at: daysAgo(24) },
      { id: "h2", from: "Dept Review", to: "Technical Review", by: "Dana Fox", at: daysAgo(23), note: "Approved at Dept Review" },
      { id: "h3", label: "Project ID PRJ-BB-0002 assigned", by: "Dana Fox", at: daysAgo(23) },
      { id: "h4", label: "Ravi Chandran assigned to project as Assembly Lead", by: "Dana Fox", at: daysAgo(22) },
      { id: "h5", from: "Technical Review", to: "Quotation", by: "Dana Fox", at: daysAgo(19), note: "Approved at Technical Review" },
    ],
    createdBy: "Jamie Lin",
    assignedTo: "Jamie Lin",
    assignees: [{ id: "as1", name: "Ravi Chandran", roleInProject: "Assembly Lead" }],
    callLogs: [{ id: "cl1", by: "Jamie Lin", at: daysAgo(21) }],
    createdAt: daysAgo(24),
    updatedAt: daysAgo(19),
  },
  // 4. ODM — Won, full pipeline complete with a two-person execution team.
  {
    id: "RFQ-0004",
    projectId: "PRJ-ODM-0001",
    clientId: "CLT-0004",
    type: "ODM",
    department: "ODM",
    stage: "Won",
    technicalScope: "High-volume ODM run of an avionics telemetry unit, 10,000 units, full production + QA.",
    budget: "480000",
    timeline: "20 weeks",
    notes: [
      {
        id: "n1",
        author: "Alex Rao",
        createdAt: daysAgo(38),
        compiled: "Client need: high-volume telemetry unit production.\nBudget signal: strong, enterprise procurement process.\nTimeline: 20 weeks with staged delivery.\nRisks: certification lead time is the main schedule risk.",
        questions: { need: "High-volume telemetry unit", budget: "Strong / enterprise", timeline: "20 weeks staged", scope: "10,000 units", risks: "Certification lead time" },
      },
    ],
    architectureSummary: "Overview: Modular telemetry unit built around a certified RF front-end and redundant power stage.\nKey components: RF transceiver module, redundant power supply, ruggedized enclosure, onboard diagnostics.\nConsiderations: Certification lead time is the critical path; staged delivery reduces inventory risk for the client.",
    stakeholders: [{ id: "st1", name: "Elena Ford", role: "Program Manager", department: "Halcyon Aerospace" }],
    approvals: [
      { id: "appr-1", stage: "Dept Review", approver: "Leo Tanaka", decision: "Approved", comment: "Strategic account, prioritizing capacity.", createdAt: daysAgo(39) },
      { id: "appr-2", stage: "Technical Review", approver: "Leo Tanaka", decision: "Approved", comment: "Design validated against spec.", createdAt: daysAgo(32) },
      { id: "appr-3", stage: "Quotation", approver: "Leo Tanaka", decision: "Approved", comment: "Pricing signed off by finance.", createdAt: daysAgo(24) },
    ],
    history: [
      { id: "h1", from: null, to: "Dept Review", by: "Alex Rao", at: daysAgo(40) },
      { id: "h2", from: "Dept Review", to: "Technical Review", by: "Leo Tanaka", at: daysAgo(39), note: "Approved at Dept Review" },
      { id: "h3", label: "Project ID PRJ-ODM-0001 assigned", by: "Leo Tanaka", at: daysAgo(39) },
      { id: "h4", label: "Yuki Sato assigned to project as Assembly Lead", by: "Leo Tanaka", at: daysAgo(38) },
      { id: "h5", label: "Leo Tanaka assigned to project as Program Oversight", by: "Leo Tanaka", at: daysAgo(38) },
      { id: "h6", from: "Technical Review", to: "Quotation", by: "Leo Tanaka", at: daysAgo(32), note: "Approved at Technical Review" },
      { id: "h7", from: "Quotation", to: "Approval", by: "Leo Tanaka", at: daysAgo(24), note: "Approved at Quotation" },
      { id: "h8", from: "Approval", to: "Won", by: "Alex Rao", at: daysAgo(20) },
    ],
    createdBy: "Alex Rao",
    assignedTo: "Alex Rao",
    assignees: [
      { id: "as1", name: "Yuki Sato", roleInProject: "Assembly Lead" },
      { id: "as2", name: "Leo Tanaka", roleInProject: "Program Oversight" },
    ],
    callLogs: [
      { id: "cl1", by: "Alex Rao", at: daysAgo(37) },
      { id: "cl2", by: "Alex Rao", at: daysAgo(28) },
      { id: "cl3", by: "Alex Rao", at: daysAgo(21) },
    ],
    createdAt: daysAgo(40),
    updatedAt: daysAgo(20),
  },
  // 5. Box Build — rejected at Dept Review, so it never received a Project ID.
  {
    id: "RFQ-0005",
    projectId: null,
    clientId: "CLT-0005",
    type: "Box Build",
    department: "Box Build",
    stage: "Lost",
    technicalScope: "Small batch enclosure build, 200 units, two-week turnaround requested.",
    budget: "15000",
    timeline: "2 weeks",
    notes: [],
    architectureSummary: "",
    stakeholders: [],
    approvals: [{ id: "appr-1", stage: "Dept Review", approver: "Dana Fox", decision: "Rejected", comment: "Timeline isn't feasible with current capacity.", createdAt: daysAgo(9) }],
    history: [
      { id: "h1", from: null, to: "Dept Review", by: "Jamie Lin", at: daysAgo(10) },
      { id: "h2", from: "Dept Review", to: "Lost", by: "Dana Fox", at: daysAgo(9), note: "Rejected at Dept Review" },
    ],
    createdBy: "Jamie Lin",
    assignedTo: "Jamie Lin",
    assignees: [],
    callLogs: [{ id: "cl1", by: "Jamie Lin", at: daysAgo(10) }],
    createdAt: daysAgo(10),
    updatedAt: daysAgo(9),
  },
];

const SAMPLE_TASKS = [
  { id: "task-1", title: "Send updated quote to Vertex Circuits", description: "Reflect the EMI shielding revision in the quote.", projectId: "RFQ-0003", assignedTo: "Jamie Lin", createdBy: "Alex Rao", department: "Sales", status: "In Progress", dueDate: null, history: [{ id: "th1", from: null, to: "To Do", by: "Alex Rao", at: daysAgo(6) }], createdAt: daysAgo(6), updatedAt: daysAgo(3) },
  { id: "task-2", title: "Order enclosure prototype", description: "Kick off prototype run for Northwind's enclosure.", projectId: "RFQ-0001", assignedTo: "Ravi Chandran", createdBy: "Dana Fox", department: "Box Build", status: "To Do", dueDate: null, history: [{ id: "th1", from: null, to: "To Do", by: "Dana Fox", at: daysAgo(14) }], createdAt: daysAgo(14), updatedAt: daysAgo(14) },
  { id: "task-3", title: "Final QC pass on telemetry units", description: "Sign off before shipment to Halcyon Aerospace.", projectId: "RFQ-0004", assignedTo: "Yuki Sato", createdBy: "Leo Tanaka", department: "ODM", status: "Done", dueDate: null, history: [{ id: "th1", from: null, to: "To Do", by: "Leo Tanaka", at: daysAgo(25) }, { id: "th2", from: "To Do", to: "Done", by: "Yuki Sato", at: daysAgo(21) }], createdAt: daysAgo(25), updatedAt: daysAgo(21) },
  { id: "task-4", title: "Follow up with Solstice Robotics", description: "Check in while their RFQ is in Dept Review.", projectId: "RFQ-0002", assignedTo: "Alex Rao", createdBy: "Alex Rao", department: "Sales", status: "To Do", dueDate: null, history: [{ id: "th1", from: null, to: "To Do", by: "Alex Rao", at: daysAgo(3) }], createdAt: daysAgo(3), updatedAt: daysAgo(3) },
];

const SAMPLE_WORK_UPDATES = [
  { id: "wu-1", userId: "u-sales-usr", userName: "Jamie Lin", department: "Sales", tier: "User", date: daysAgo(2).slice(0, 10), hours: 6, summary: "Followed up with Northwind Devices on RFQ-0001 and logged a call with Vertex Circuits about the revised quote.", createdAt: daysAgo(2) },
  { id: "wu-2", userId: "u-sales-mgr", userName: "Alex Rao", department: "Sales", tier: "Manager", date: daysAgo(1).slice(0, 10), hours: 5, summary: "Reviewed pending lead from Orbital Sensing Co. and checked in with Solstice Robotics while their RFQ sits in Dept Review.", createdAt: daysAgo(1) },
  { id: "wu-3", userId: "u-bb-usr", userName: "Ravi Chandran", department: "Box Build", tier: "User", date: daysAgo(1).slice(0, 10), hours: 7, summary: "Started prototype build for Northwind's enclosure (RFQ-0001) and continued assembly work on the Vertex Circuits revision.", createdAt: daysAgo(1) },
  { id: "wu-4", userId: "u-odm-usr", userName: "Yuki Sato", department: "ODM", tier: "User", date: daysAgo(21).slice(0, 10), hours: 8, summary: "Completed final QC pass on the Halcyon Aerospace telemetry units ahead of shipment.", createdAt: daysAgo(21) },
];


export {
  SAMPLE_CLIENTS, SAMPLE_LEADS, SAMPLE_PROJECTS, SAMPLE_TASKS, SAMPLE_WORK_UPDATES,
};
