import { useState, useEffect, useCallback } from "react";
import { AlertTriangle, Loader2, Users, FileText, ShieldCheck, LogOut, Bell, Zap } from "lucide-react";
import { APP_STYLES } from "./styles/appStyles";
import { SEED_USERS } from "./constants";
import { SAMPLE_CLIENTS, SAMPLE_LEADS, SAMPLE_PROJECTS, SAMPLE_TASKS, SAMPLE_WORK_UPDATES } from "./data/sampleData";
import { tierLabel, nextClientId, findMatchingClient, uid } from "./lib/helpers";
import { loadList, saveList } from "./lib/storage";
import { supabase } from "./lib/supabase";
import { signIn } from "./lib/auth";
import { LoginPage } from "./pages/LoginPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { EmptyState } from "./components/ui";
import { NewRFQ } from "./pages/NewRFQ";
import { Dashboard } from "./pages/Dashboard";
import { Leads } from "./pages/Leads";
import { ProjectDetail } from "./pages/ProjectDetail";
import { DepartmentSelect } from "./pages/DepartmentSelect";
import { TaskManager } from "./pages/TaskManager";
import { WorkUpdates } from "./pages/WorkUpdates";
import { FinancePlaceholder } from "./pages/FinancePlaceholder";
import { Profile } from "./pages/Profile";
import { Reports } from "./pages/Reports";
import { UserManagement } from "./pages/UserManagement";
import { AuthSplash, AccountNotice } from "./pages/AccountScreens";

// True when the page was opened from a password-reset email link, which carries
// `type=recovery` in the URL hash (e.g. #access_token=…&type=recovery).
function isRecoveryUrl() {
  try {
    return new URLSearchParams(window.location.hash.replace(/^#/, "")).get("type") === "recovery";
  } catch {
    return false;
  }
}

export default function App() {
  const [loading, setLoading] = useState(true);
  const [clients, setClients] = useState([]);
  const [projects, setProjects] = useState([]);
  const [users, setUsers] = useState([]);
  const [workUpdates, setWorkUpdates] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [leads, setLeads] = useState([]);
  const [view, setView] = useState("dashboard"); // dashboard | new | detail | users
  const [selectedId, setSelectedId] = useState(null);
  const [department, setDepartment] = useState(null);
  const [tier, setTier] = useState(null);
  const [userName, setUserName] = useState("");
  const [userId, setUserId] = useState(null);
  const [saveError, setSaveError] = useState("");

  // --- Supabase Auth session ---
  const [session, setSession] = useState(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [deptChosen, setDeptChosen] = useState(false);
  // A "forgot password" reset link lands on #...&type=recovery. Detect it
  // synchronously on first render — Supabase strips the hash asynchronously as it
  // establishes the recovery session, so reading it now (not relying solely on the
  // async PASSWORD_RECOVERY event) reliably wins that race.
  const [recovery, setRecovery] = useState(isRecoveryUrl);

  // Track the session on mount and whenever it changes (sign in / out / refresh).
  // Skip the initial session read when arriving via a recovery link, or we'd route
  // that temporary session into the app instead of the set-new-password screen.
  useEffect(() => {
    let active = true;
    if (recovery) {
      setAuthChecking(false);
    } else {
      supabase.auth.getSession().then(({ data }) => {
        if (!active) return;
        setSession(data.session);
        setAuthChecking(false);
      });
    }
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === "PASSWORD_RECOVERY") { setRecovery(true); setAuthChecking(false); return; }
      setSession(s);
      if (!s) {
        // Signed out — clear everything so the next login re-loads fresh.
        setDataLoaded(false);
        setDeptChosen(false);
        setDepartment(null);
        setUserName("");
        setTier(null);
        setUserId(null);
      }
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Load (and, on first run, seed) the collections once we have a session.
  // RLS only permits reads/writes for authenticated users, so this must run
  // after sign-in — not on mount.
  useEffect(() => {
    if (!session || dataLoaded) return;
    let active = true;
    (async () => {
      setLoading(true);
      const [c, p, u, w, t, l] = await Promise.all([
        loadList("crm-clients"),
        loadList("crm-projects"),
        loadList("crm-users"),
        loadList("crm-work-updates"),
        loadList("crm-tasks"),
        loadList("crm-leads"),
      ]);
      if (!active) return;
      if (u.length === 0) {
        // First run — seed only the bootstrap admin (from env). Everyone else is
        // created dynamically via the Employees screen. If no bootstrap admin is
        // configured, seed nothing (SEED_USERS is empty).
        setUsers(SEED_USERS);
        if (SEED_USERS.length) saveList("crm-users", SEED_USERS);
      } else {
        setUsers(u);
      }
      if (c.length === 0 && p.length === 0 && l.length === 0) {
        // First run — seed the linked sample dataset (leads -> clients -> RFQs -> dept review -> project IDs).
        setClients(SAMPLE_CLIENTS);
        saveList("crm-clients", SAMPLE_CLIENTS);
        setProjects(SAMPLE_PROJECTS);
        saveList("crm-projects", SAMPLE_PROJECTS);
        setLeads(SAMPLE_LEADS);
        saveList("crm-leads", SAMPLE_LEADS);
      } else {
        setClients(c);
        setProjects(p);
        setLeads(l);
      }
      if (t.length === 0) {
        setTasks(SAMPLE_TASKS);
        saveList("crm-tasks", SAMPLE_TASKS);
      } else {
        setTasks(t);
      }
      if (w.length === 0) {
        setWorkUpdates(SAMPLE_WORK_UPDATES);
        saveList("crm-work-updates", SAMPLE_WORK_UPDATES);
      } else {
        setWorkUpdates(w);
      }
      setDataLoaded(true);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [session, dataLoaded]);

  const persistClients = useCallback(async (list) => {
    setClients(list);
    const ok = await saveList("crm-clients", list);
    if (!ok) setSaveError("Couldn't save — check your connection and try again.");
  }, []);

  const persistProjects = useCallback(async (list) => {
    setProjects(list);
    const ok = await saveList("crm-projects", list);
    if (!ok) setSaveError("Couldn't save — check your connection and try again.");
  }, []);

  const persistUsers = useCallback(async (list) => {
    setUsers(list);
    const ok = await saveList("crm-users", list);
    if (!ok) setSaveError("Couldn't save — check your connection and try again.");
  }, []);

  const persistWorkUpdates = useCallback(async (list) => {
    setWorkUpdates(list);
    const ok = await saveList("crm-work-updates", list);
    if (!ok) setSaveError("Couldn't save — check your connection and try again.");
  }, []);

  function handleCreateWorkUpdate(entry) {
    persistWorkUpdates([...workUpdates, entry]);
  }

  const persistTasks = useCallback(async (list) => {
    setTasks(list);
    const ok = await saveList("crm-tasks", list);
    if (!ok) setSaveError("Couldn't save — check your connection and try again.");
  }, []);

  function handleCreateTask(newTask) {
    persistTasks([...tasks, newTask]);
  }

  function handleUpdateTask(updated) {
    persistTasks(tasks.map((t) => (t.id === updated.id ? updated : t)));
  }

  function handleCreateClient(newClient) {
    persistClients([...clients, newClient]);
  }

  const persistLeads = useCallback(async (list) => {
    setLeads(list);
    const ok = await saveList("crm-leads", list);
    if (!ok) setSaveError("Couldn't save — check your connection and try again.");
  }, []);

  function approveLeadRecord(lead, approverName) {
    const match = findMatchingClient(clients, lead.email);
    let clientId = match?.id;
    if (!match) {
      const newClient = {
        id: nextClientId(clients),
        name: lead.name,
        company: lead.company,
        email: lead.email,
        phone: lead.phone,
        createdBy: lead.submittedBy,
        createdAt: new Date().toISOString(),
      };
      persistClients([...clients, newClient]);
      clientId = newClient.id;
    }
    const now = new Date().toISOString();
    persistLeads(
      leads.some((l) => l.id === lead.id)
        ? leads.map((l) => (l.id === lead.id ? { ...l, status: "Approved", reviewedBy: approverName, reviewedAt: now, clientId } : l))
        : [...leads, { ...lead, status: "Approved", reviewedBy: approverName, reviewedAt: now, clientId }]
    );
  }

  function handleSubmitLead(leadForm, autoApprove) {
    const now = new Date().toISOString();
    const newLead = {
      id: uid(),
      ...leadForm,
      submittedBy: userName,
      status: "Pending",
      reviewedBy: null,
      reviewedAt: null,
      clientId: null,
      createdAt: now,
    };
    if (autoApprove) {
      approveLeadRecord(newLead, userName);
    } else {
      persistLeads([...leads, newLead]);
    }
  }

  function handleApproveLead(lead) {
    approveLeadRecord(lead, userName);
  }

  function handleRejectLead(lead, reason) {
    persistLeads(
      leads.map((l) =>
        l.id === lead.id ? { ...l, status: "Rejected", reviewedBy: userName, reviewedAt: new Date().toISOString(), rejectionReason: reason } : l
      )
    );
  }

  function handleCreateProject(newProject) {
    persistProjects([...projects, newProject]);
  }

  function handleUpdateProject(updated) {
    persistProjects(projects.map((p) => (p.id === updated.id ? updated : p)));
  }

  // Calls the admin serverless function with the caller's access token.
  async function callAdmin(payload) {
    const token = session?.access_token;
    const res = await fetch("/api/admin", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Request failed.");
    return json;
  }

  // Creating a user also provisions a Supabase Auth login so they can sign in.
  async function handleCreateUser(newUser) {
    setSaveError("");
    try {
      const { authId } = await callAdmin({
        action: "create",
        email: newUser.email,
        password: newUser.password,
      });
      persistUsers([...users, { ...newUser, authId }]);
    } catch (e) {
      setSaveError(e.message || "Couldn't create a login for this user.");
    }
  }

  function handleSaveUser(updated) {
    persistUsers(users.map((u) => (u.id === updated.id ? updated : u)));
  }

  // Removing a user also deletes their Supabase Auth login (best effort).
  async function handleDeleteUser(id) {
    const target = users.find((u) => u.id === id);
    persistUsers(users.filter((u) => u.id !== id));
    if (target) {
      try {
        await callAdmin({ action: "delete", authId: target.authId, email: target.email });
      } catch (e) {
        setSaveError(e.message || "User removed, but their login could not be deleted.");
      }
    }
  }

  const selectedProject = projects.find((p) => p.id === selectedId);
  const selectedClient = selectedProject && clients.find((c) => c.id === selectedProject.clientId);
  const isMainAdmin = tier === "Main Admin";
  const canCreateRFQ = isMainAdmin || department === "Sales";

  async function handleSignOut() {
    await supabase.auth.signOut();
    // onAuthStateChange clears the rest of the state.
  }

  // Called by the LoginPage's "Sign In" button. signIn() authenticates and gates
  // on the crm-users profile (missing / pending / deactivated → signed back out
  // with a precise message). On success the onAuthStateChange listener above sets
  // the session and the normal load → department-picker flow takes over.
  async function handleLogin(email, password) {
    const res = await signIn(email, password);
    if (res.success) return { success: true };
    return { success: false, error: res.error };
  }

  // The signed-in user's app profile (tier / department / name) comes from the
  // crm-users collection, matched by their auth email.
  const me =
    session && users.find((u) => (u.email || "").toLowerCase() === (session.user.email || "").toLowerCase());

  // 0. Arrived from a password-reset email link → set-new-password screen. This
  // takes priority over any session the link also established.
  if (recovery) {
    return (
      <ResetPasswordPage
        onDone={() => {
          window.location.hash = "";
          setRecovery(false);
          setSession(null);
          setDataLoaded(false);
        }}
      />
    );
  }

  // 1. Still checking for an existing session.
  if (authChecking) {
    return <AuthSplash />;
  }

  // 2. Not signed in → login screen.
  if (!session) {
    return <LoginPage onLogin={handleLogin} />;
  }

  // 3. Signed in, but collections still loading.
  if (loading || !dataLoaded) {
    return <AuthSplash message="Loading your workspace…" />;
  }

  // 4. Authenticated, but no matching app profile / pending / deactivated.
  if (!me) {
    return <AccountNotice title="No profile found" body={`No employee record is linked to ${session.user.email}. Ask your Main Admin to add you on the Employees page.`} onSignOut={handleSignOut} />;
  }
  if (me.status === "pending") {
    return <AccountNotice title="Awaiting approval" body="Your account is awaiting admin approval. You'll be able to sign in once a Main Admin activates it." onSignOut={handleSignOut} />;
  }
  if (me.active === false) {
    return <AccountNotice title="Account deactivated" body="This account has been deactivated. Contact your Main Admin." onSignOut={handleSignOut} />;
  }

  // 5. Pick a department before entering the app.
  if (!deptChosen) {
    return (
      <div className="app-shell">
        <style>{APP_STYLES}</style>
        <DepartmentSelect
          user={me}
          onSelect={(dept) => {
            setUserName(me.name);
            setTier(me.tier);
            setUserId(me.id);
            setDepartment(dept);
            setDeptChosen(true);
          }}
          onBack={handleSignOut}
        />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <style>{APP_STYLES}</style>

      <header className="topbar">
        <div className="topbar-left">
          <div className="brand">
            <Zap size={20} className="brand-bolt" fill="currentColor" />
            <span className="brand-text">Elecbits</span>
          </div>
          <div className="topbar-divider" />
          <div className="topbar-product">
            <span className="topbar-product-name">Sales OS</span>
            <span className="topbar-product-tag">RFQ · Approvals · Pipeline</span>
          </div>
        </div>
        <div className="topbar-right">
          <button className="topbar-bell" title="Notifications">
            <Bell size={18} />
          </button>
          <div className="topbar-user">
            <div className="topbar-user-info">
              <div className="topbar-user-name">{userName}</div>
              <div className="topbar-user-role">{tierLabel(tier)}</div>
            </div>
            <div className="topbar-avatar">{userName ? userName[0].toUpperCase() : "?"}</div>
          </div>
          <button className="topbar-signout" title="Sign out" onClick={handleSignOut}>
            <LogOut size={17} />
          </button>
        </div>
      </header>

      <div className="role-banner">
        <ShieldCheck size={15} />
        <strong>
          {tier}
          {tier === "Main Admin" ? " (Special Access)" : tier === "Manager" ? " (Department Head)" : ""}
        </strong>
        <span className="role-banner-dept">· Dept: {department || "All"}</span>
      </div>

      <nav className="nav-tabs-bar">
        <span className="nav-tabs-label">MENU</span>
        <button className={`nav-tab ${view === "dashboard" ? "active" : ""}`} onClick={() => setView("dashboard")}>
          Dashboard
        </button>
        {(isMainAdmin || department === "Sales") && (
          <button className={`nav-tab ${view === "leads" ? "active" : ""}`} onClick={() => setView("leads")}>
            Leads
          </button>
        )}
        {canCreateRFQ && (
          <button className={`nav-tab ${view === "new" ? "active" : ""}`} onClick={() => setView("new")}>
            New RFQ
          </button>
        )}
        {(isMainAdmin || (department === "Sales" && tier === "Manager")) && (
          <button className={`nav-tab ${view === "reports" ? "active" : ""}`} onClick={() => setView("reports")}>
            Reports
          </button>
        )}
        {isMainAdmin && (
          <button className={`nav-tab ${view === "users" ? "active" : ""}`} onClick={() => setView("users")}>
            Users
          </button>
        )}
        <button className={`nav-tab ${view === "tasks" ? "active" : ""}`} onClick={() => setView("tasks")}>
          Tasks
        </button>
        <button className={`nav-tab ${view === "workupdates" ? "active" : ""}`} onClick={() => setView("workupdates")}>
          Work Updates
        </button>
        <button className={`nav-tab ${view === "finance" ? "active" : ""}`} onClick={() => setView("finance")}>
          Finance
        </button>
        <button className={`nav-tab ${view === "profile" ? "active" : ""}`} onClick={() => setView("profile")}>
          Profile
        </button>
      </nav>

      {saveError && (
        <div className="save-error">
          <AlertTriangle size={12} /> {saveError}
        </div>
      )}

      <main className="main">
        {loading ? (
          <div className="empty-state">
            <Loader2 size={22} className="spin" />
            <div className="empty-title">Loading pipeline…</div>
          </div>
        ) : view === "dashboard" ? (
          <Dashboard
            clients={clients}
            projects={projects}
            users={users}
            department={department}
            tier={tier}
            userName={userName}
            onOpen={(id) => {
              setSelectedId(id);
              setView("detail");
            }}
            onNew={() => setView("new")}
          />
        ) : view === "leads" ? (
          <Leads
            leads={leads}
            clients={clients}
            userName={userName}
            tier={tier}
            onSubmitLead={handleSubmitLead}
            onApproveLead={handleApproveLead}
            onRejectLead={handleRejectLead}
          />
        ) : view === "new" ? (
          <NewRFQ
            clients={clients}
            projects={projects}
            userName={userName}
            onCreateProject={handleCreateProject}
            onCancel={() => setView("dashboard")}
            onDone={(projectId) => {
              if (projectId) {
                setSelectedId(projectId);
                setView("detail");
              } else {
                setView("dashboard");
              }
            }}
          />
        ) : view === "reports" ? (
          <Reports clients={clients} projects={projects} users={users} />
        ) : view === "users" ? (
          <UserManagement
            users={users}
            currentUserId={userId}
            onCreate={handleCreateUser}
            onSave={handleSaveUser}
            onDelete={handleDeleteUser}
          />
        ) : view === "finance" ? (
          <FinancePlaceholder />
        ) : view === "tasks" ? (
          <TaskManager
            tasks={tasks}
            projects={projects}
            clients={clients}
            users={users}
            workUpdates={workUpdates}
            userId={userId}
            userName={userName}
            department={department}
            tier={tier}
            onCreate={handleCreateTask}
            onUpdate={handleUpdateTask}
          />
        ) : view === "workupdates" ? (
          <WorkUpdates
            updates={workUpdates}
            userId={userId}
            userName={userName}
            department={department}
            tier={tier}
            onCreate={handleCreateWorkUpdate}
          />
        ) : view === "profile" ? (
          <Profile users={users} userId={userId} userName={userName} department={department} tier={tier} />
        ) : selectedProject ? (
          <ProjectDetail
            project={selectedProject}
            client={selectedClient}
            users={users}
            projects={projects}
            department={department}
            tier={tier}
            userName={userName}
            onUpdate={handleUpdateProject}
            onBack={() => setView("dashboard")}
          />
        ) : (
          <EmptyState icon={FileText} title="Project not found" body="It may have been removed." />
        )}
      </main>
    </div>
  );
}
