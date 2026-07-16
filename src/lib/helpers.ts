import {
  TrendingUp, Landmark, Building2, Cpu, Users, Package, Megaphone, ShieldCheck,
} from "lucide-react";
import { BUDGET_VISIBLE_DEPARTMENTS } from "../constants";

function roleTone(department, tier) {
  if (tier === "Main Admin") return "amber";
  if (department && BUDGET_VISIBLE_DEPARTMENTS.includes(department)) return "green";
  return "default";
}

// Friendlier tier names for display — internal tier values ("Manager"/"User") are unchanged
// everywhere permissions are checked, this is purely cosmetic.
function tierLabel(tier) {
  if (tier === "Manager") return "Department Head";
  if (tier === "User") return "Employee";
  return tier || "—";
}

function roleLabel(department, tier) {
  return tier === "Main Admin" ? "Main Admin" : `${department} · ${tierLabel(tier)}`;
}

// A user can belong to one primary department plus any number of additional ones
// (assigned by Main Admin), so team-membership checks need to consider both.
function belongsToDept(user, dept) {
  if (!user) return false;
  return user.department === dept || (user.additionalDepartments || []).includes(dept);
}

function departmentIcon(dept) {
  switch (dept) {
    case "Sales": return TrendingUp;
    case "Finance": return Landmark;
    case "Box Build": return Building2;
    case "ODM": return Cpu;
    case "HR": return Users;
    case "Product": return Package;
    case "Marketing": return Megaphone;
    default: return ShieldCheck;
  }
}



function pad(n, len) {
  return String(n).padStart(len, "0");
}

function nextClientId(clients) {
  // Placeholder format (CLT-0001) — swap this out once the final Client ID format is provided.
  const max = clients.reduce((m, c) => {
    const n = parseInt((c.id || "").split("-")[1] || "0", 10);
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 0);
  return `CLT-${pad(max + 1, 4)}`;
}

function nextRfqId(projects) {
  // Stable reference assigned the moment an RFQ is submitted, before any department approval.
  const max = projects.reduce((m, p) => {
    const n = parseInt((p.id || "").split("-")[1] || "0", 10);
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 0);
  return `RFQ-${pad(max + 1, 4)}`;
}

function nextProjectId(projects, type) {
  // Placeholder format (PRJ-BB-0001 / PRJ-ODM-0001) — swap out once the final format is provided.
  // Only assigned once the department head approves at the "Dept Review" gate.
  const prefix = type === "Box Build" ? "BB" : "ODM";
  const sameType = projects.filter((p) => p.type === type && p.projectId);
  const max = sameType.reduce((m, p) => {
    const n = parseInt((p.projectId || "").split("-")[2] || "0", 10);
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 0);
  return `PRJ-${prefix}-${pad(max + 1, 4)}`;
}

function findMatchingClient(clients, email) {
  if (!email) return null;
  const norm = email.trim().toLowerCase();
  return clients.find((c) => (c.email || "").trim().toLowerCase() === norm) || null;
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function timeAgo(iso) {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export {
  roleTone, tierLabel, roleLabel, belongsToDept, departmentIcon, pad,
  nextClientId, nextRfqId, nextProjectId, findMatchingClient, uid, timeAgo,
};
