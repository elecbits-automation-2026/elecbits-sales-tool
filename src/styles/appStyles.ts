export const APP_STYLES = `
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap');

        .app-shell {
          --bg: #eef1f8;
          --page-bg: #f4f6fb;
          --panel: #ffffff;
          --panel-2: #f5f7fb;
          --border: #e4e8f1;
          --border-strong: #d6dcea;
          --text: #0f1729;
          --text-dim: #5b6478;
          --text-faint: #94a0b8;
          --blue: #3d5afe;
          --blue-dark: #2b3fd6;
          --blue-bright: #5b6bff;
          --indigo: #6366f1;
          --purple: #a855f7;
          --purple-dark: #7c3aed;
          --purple-bg: #faf5ff;
          --purple-border: #f3e8ff;
          --cyan: #0ea5b7;
          --green: #16a34a;
          --green-bg: #ecfdf3;
          --amber: #d97706;
          --amber-bg: #fffaeb;
          --red: #dc2626;
          --red-bg: #fef2f2;
          --font-mono: 'IBM Plex Mono', monospace;
          --font-sans: 'Inter', sans-serif;

          font-family: var(--font-sans);
          color: var(--text);
          background: var(--page-bg);
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          box-sizing: border-box;
        }
        .app-shell *, .app-shell *::before, .app-shell *::after { box-sizing: border-box; }

        /* ---------------- Login screen ---------------- */
        .login-screen {
          width: 100%;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 40px 20px;
          background:
            radial-gradient(1200px 700px at 15% 90%, rgba(255,255,255,0.05), transparent 60%),
            linear-gradient(135deg, #060a1f 0%, #101c52 28%, #1f3aa0 62%, #3453c9 100%);
        }
        .login-layout {
          display: flex;
          align-items: flex-start;
          gap: 22px;
        }
        .login-card {
          background: var(--panel);
          border-radius: 18px;
          padding: 40px 44px 34px;
          width: 420px;
          box-shadow: 0 30px 70px rgba(5,10,35,0.35);
        }
        .test-users-panel {
          background: rgba(255,255,255,0.08);
          border: 1px solid rgba(255,255,255,0.16);
          backdrop-filter: blur(6px);
          border-radius: 18px;
          padding: 22px 20px;
          width: 270px;
          max-height: 86vh;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .test-users-title { display: flex; align-items: center; gap: 7px; color: #fff; font-weight: 700; font-size: 13px; }
        .test-users-hint { color: rgba(255,255,255,0.65); font-size: 11.5px; margin: -4px 0 4px; line-height: 1.4; }
        .test-user-group { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; }
        .test-user-group-label { color: rgba(255,255,255,0.55); font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; font-family: var(--font-mono); margin-top: 4px; }
        .test-user-card {
          text-align: left; background: rgba(255,255,255,0.92); border: 1px solid rgba(255,255,255,0.5);
          border-radius: 10px; padding: 9px 11px; cursor: pointer; transition: transform 0.1s ease, background 0.1s ease;
          font-family: var(--font-sans); width: 100%;
        }
        .test-user-card:hover { background: #fff; transform: translateY(-1px); }
        .test-user-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
        .test-user-name { font-size: 12.5px; font-weight: 700; color: var(--text); }
        .test-user-email { font-size: 11px; color: var(--text-dim); }
        .test-user-pw { font-size: 11px; color: var(--text-faint); margin-top: 2px; }
        .login-brand {
          display: flex;
          align-items: center;
          gap: 8px;
          font-family: var(--font-sans);
          font-weight: 800;
          font-size: 28px;
          letter-spacing: -0.02em;
        }
        .brand-bolt { color: #f5a623; flex-shrink: 0; }
        .login-brand .brand-text,
        .brand .brand-text {
          background: linear-gradient(90deg, var(--blue), var(--indigo));
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
        }
        .login-product { font-size: 14px; color: var(--text-dim); margin-top: 6px; font-weight: 500; }
        .login-tagline { font-size: 12.5px; color: var(--text-faint); margin-top: 2px; }
        .login-divider { height: 1px; background: var(--border); margin: 20px 0 22px; }
        .login-heading { font-family: var(--font-sans); font-size: 24px; font-weight: 700; margin: 0 0 6px; letter-spacing: -0.01em; }
        .login-sub { font-size: 13.5px; color: var(--text-dim); margin: 0 0 22px; }
        .input-icon-wrap {
          display: flex; align-items: center; gap: 8px;
          border: 1px solid var(--border-strong); border-radius: 9px; padding: 0 12px;
          background: var(--panel); transition: border-color 0.12s ease;
        }
        .input-icon-wrap:focus-within { border-color: var(--blue); box-shadow: 0 0 0 3px rgba(61,90,254,0.12); }
        .input-icon-wrap svg { color: var(--text-faint); flex-shrink: 0; }
        .input-icon-wrap input { border: none; padding: 11px 0; background: transparent; }
        .input-icon-wrap input:focus { border: none; box-shadow: none; }
        .login-submit {
          width: 100%; justify-content: center; padding: 12px; font-size: 14.5px; border-radius: 9px;
          background: linear-gradient(90deg, var(--blue), var(--indigo)); margin-top: 6px;
          box-shadow: 0 10px 24px rgba(61,90,254,0.28);
        }
        .login-footer { display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: 20px; font-size: 13px; }
        .login-footer a { color: var(--blue); text-decoration: none; font-weight: 600; }
        .login-footer a:hover { text-decoration: underline; }
        .login-footer-dot { color: var(--text-faint); }
        .login-footer-secondary { text-align: center; font-size: 13px; color: var(--text-dim); margin-top: 8px; }
        .login-footer-secondary a { color: var(--blue); font-weight: 600; text-decoration: none; }
        .login-footer-secondary a:hover { text-decoration: underline; }

        .dept-select-card {
          background: var(--panel);
          border-radius: 18px;
          padding: 40px 44px;
          width: 100%;
          max-width: 620px;
          box-shadow: 0 30px 70px rgba(5,10,35,0.35);
        }
        .dept-select-sub { text-align: center; font-size: 12.5px; color: var(--text-dim); margin: 10px 0 22px; }
        .dept-select-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 8px; }
        .dept-select-btn {
          display: flex; flex-direction: column; align-items: center; gap: 6px;
          background: var(--panel-2); border: 1px solid var(--border-strong); border-radius: 12px;
          padding: 20px 12px; cursor: pointer; color: var(--text); font-family: var(--font-sans);
          font-weight: 600; font-size: 13.5px; transition: border-color 0.12s ease, transform 0.12s ease;
        }
        .dept-select-btn:hover { border-color: var(--blue); transform: translateY(-2px); color: var(--blue-dark); }
        .dept-select-btn-admin { border-color: rgba(217,119,6,0.4); background: var(--amber-bg); color: var(--amber); }
        .dept-select-btn-sub { font-size: 10.5px; font-weight: 500; color: var(--text-faint); text-transform: uppercase; letter-spacing: 0.04em; }

        /* Top bar */
        .topbar {
          background: var(--panel);
          border-bottom: 1px solid var(--border);
          padding: 12px 32px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
        }
        .topbar-left { display: flex; align-items: center; gap: 14px; }
        .brand {
          display: flex;
          align-items: center;
          gap: 8px;
          font-weight: 800;
          font-size: 20px;
          letter-spacing: -0.01em;
        }
        .topbar-divider { width: 1px; height: 30px; background: var(--border); }
        .topbar-product { display: flex; flex-direction: column; line-height: 1.25; }
        .topbar-product-name { font-size: 14px; font-weight: 700; color: var(--text); }
        .topbar-product-tag { font-size: 11.5px; color: var(--text-faint); }
        .topbar-right { display: flex; align-items: center; gap: 18px; }
        .topbar-bell { color: var(--text-dim); background: none; border: none; cursor: pointer; padding: 4px; }
        .topbar-bell:hover { color: var(--text); }
        .topbar-user { display: flex; align-items: center; gap: 10px; }
        .topbar-user-info { text-align: right; line-height: 1.3; }
        .topbar-user-name { font-size: 13.5px; font-weight: 700; color: var(--text); }
        .topbar-user-role { font-size: 11.5px; color: var(--text-faint); }
        .topbar-avatar {
          width: 34px; height: 34px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
          background: linear-gradient(135deg, var(--purple), var(--purple-dark)); color: #fff; font-weight: 700; font-size: 13.5px;
          flex-shrink: 0;
        }
        .topbar-signout { color: var(--text-faint); background: none; border: none; cursor: pointer; padding: 6px; border-radius: 6px; }
        .topbar-signout:hover { color: var(--red); background: var(--red-bg); }

        /* Role banner */
        .role-banner {
          background: var(--purple-bg);
          border-bottom: 1px solid var(--purple-border);
          padding: 9px 32px;
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
          color: var(--purple-dark);
        }
        .role-banner strong { font-weight: 700; }
        .role-banner-dept { color: var(--text-dim); }

        /* Nav tabs */
        .nav-tabs-bar { background: var(--panel); border-bottom: 1px solid var(--border); padding: 0 32px; display: flex; align-items: center; gap: 26px; overflow-x: auto; }
        .nav-tabs-label { font-size: 10.5px; font-weight: 700; letter-spacing: 0.08em; color: var(--text-faint); font-family: var(--font-mono); padding: 14px 0; flex-shrink: 0; }
        .nav-tab {
          background: none; border: none; border-bottom: 2px solid transparent; padding: 14px 2px; margin-bottom: -1px;
          font-size: 13.5px; font-weight: 600; color: var(--text-dim); cursor: pointer; white-space: nowrap;
        }
        .nav-tab:hover { color: var(--text); }
        .nav-tab.active { color: var(--blue-dark); border-bottom-color: var(--blue); }

        .save-error { font-size: 11px; color: var(--red); display: flex; align-items: center; gap: 5px; padding: 6px 32px 0; }

        /* Quick actions row (dashboard) */
        .quick-actions { display: flex; align-items: center; gap: 22px; overflow-x: auto; padding-bottom: 4px; border-bottom: 1px solid var(--border); }
        .quick-action { display: flex; align-items: center; gap: 7px; background: none; border: none; color: var(--text-dim); font-size: 13px; font-weight: 500; cursor: pointer; white-space: nowrap; padding: 4px 0; }
        .quick-action:hover { color: var(--blue-dark); }
        .quick-action.active { color: var(--blue-dark); font-weight: 700; }

        /* Task manager kanban */
        .kanban { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; align-items: start; }
        .kanban-col { background: var(--panel-2); border: 1px solid var(--border); border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
        .kanban-col-header { display: flex; align-items: center; justify-content: space-between; font-size: 12.5px; font-weight: 700; color: var(--text-dim); padding: 2px 4px; }
        .kanban-col-body { display: flex; flex-direction: column; gap: 8px; min-height: 40px; }
        .task-card { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 6px; }
        .task-card-title { font-size: 13.5px; font-weight: 600; color: var(--text); }
        .task-card-desc { font-size: 12px; color: var(--text-dim); line-height: 1.4; }
        .task-card-meta { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .task-card-actions { display: flex; gap: 6px; margin-top: 4px; }

        /* Main */
        .main { flex: 1; padding: 28px 32px 60px; width: 100%; max-width: 1180px; margin: 0 auto; }
        .view { display: flex; flex-direction: column; gap: 22px; }
        .view-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
        h1 { font-family: var(--font-sans); font-size: 22px; font-weight: 700; margin: 0 0 4px; letter-spacing: -0.015em; color: var(--text); }
        h2 { font-family: var(--font-sans); font-size: 18px; font-weight: 700; margin: 8px 0; }
        .view-sub { color: var(--text-dim); font-size: 13px; margin: 0; }

        /* Buttons */
        .btn {
          display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-sans);
          font-size: 13px; font-weight: 600; padding: 8px 14px; border-radius: 8px; border: 1px solid transparent;
          cursor: pointer; transition: filter 0.12s ease, box-shadow 0.12s ease;
        }
        .btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .btn:hover:not(:disabled) { filter: brightness(1.05); }
        .btn-primary { background: linear-gradient(90deg, var(--blue), var(--indigo)); color: #fff; box-shadow: 0 6px 16px rgba(61,90,254,0.22); }
        .btn-secondary { background: var(--panel-2); color: var(--text); border-color: var(--border-strong); }
        .btn-ghost { background: transparent; color: var(--text-dim); border-color: var(--border); }
        .btn-danger { background: var(--red-bg); color: var(--red); border-color: #fecaca; }
        .btn-sm { padding: 5px 10px; font-size: 12px; }
        .icon-btn { background: none; border: none; color: var(--text-dim); cursor: pointer; padding: 4px; }
        .icon-btn:hover { color: var(--text); }

        /* Stats */
        .stat-row { display: flex; gap: 12px; }
        .stat-card { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 16px 18px; flex: 1; cursor: pointer; transition: border-color 0.12s ease, transform 0.12s ease; }
        .stat-card:hover { border-color: var(--border-strong); transform: translateY(-1px); }
        .stat-card-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
        .stat-icon-badge { width: 30px; height: 30px; border-radius: 8px; display: flex; align-items: center; justify-content: center; background: rgba(61,90,254,0.1); color: var(--blue-dark); flex-shrink: 0; }
        .stat-green .stat-icon-badge { background: var(--green-bg); color: var(--green); }
        .stat-amber .stat-icon-badge { background: var(--amber-bg); color: var(--amber); }
        .stat-value { font-family: var(--font-sans); font-size: 24px; font-weight: 700; color: var(--blue-dark); }
        .stat-green .stat-value { color: var(--green); }
        .stat-amber .stat-value { color: var(--amber); }
        .stat-label { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-faint); font-weight: 700; margin-bottom: 6px; }
        .stat-link { font-size: 12px; color: var(--blue); font-weight: 600; margin-top: 6px; display: inline-flex; align-items: center; gap: 3px; }

        /* Sales overview (v2 cards) */
        .stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
        .stat-card-v2 { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 16px 18px; cursor: pointer; transition: border-color 0.12s ease, transform 0.12s ease; }
        .stat-card-v2:hover { border-color: var(--border-strong); transform: translateY(-1px); }
        .stat-card-v2-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
        .stat-v2-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-faint); font-weight: 700; }
        .stat-icon-purple { background: var(--purple-bg); color: var(--purple-dark); }
        .stat-icon-blue { background: rgba(61,90,254,0.1); color: var(--blue-dark); }
        .stat-icon-green { background: var(--green-bg); color: var(--green); }
        .stat-icon-amber { background: var(--amber-bg); color: var(--amber); }

        /* Admin Console — Employees */
        .admin-console-title { display: flex; align-items: center; gap: 12px; }
        .employee-list { display: flex; flex-direction: column; gap: 10px; }
        .employee-card { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 16px 18px; }
        .employee-card.inactive { opacity: 0.6; }
        .employee-card-top { margin-bottom: 12px; }
        .employee-name-row { display: flex; align-items: center; gap: 8px; }
        .employee-card-controls { display: grid; grid-template-columns: 1fr 1fr 1fr auto; gap: 10px; align-items: end; }
        .employee-card-controls .field { margin-bottom: 0; }
        .employee-dept-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
        .chip-remove { background: none; border: none; color: inherit; cursor: pointer; display: inline-flex; align-items: center; margin-left: 4px; padding: 0; }
        .chip-remove:hover { color: var(--red); }

        .team-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; }
        .team-list li { display: flex; align-items: center; gap: 10px; padding: 8px; border-radius: 8px; }
        .team-list li:hover { background: var(--panel-2); }
        .team-avatar {
          width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center;
          background: rgba(61,90,254,0.12); color: var(--blue-dark); font-size: 11.5px; font-weight: 700;
        }
        .team-info { flex: 1; min-width: 0; }

        .stage-bars { display: flex; flex-direction: column; gap: 14px; }
        .stage-bar-label { display: flex; align-items: center; justify-content: space-between; font-size: 13px; margin-bottom: 6px; }
        .stage-bar-track { height: 6px; border-radius: 4px; background: var(--panel-2); overflow: hidden; }
        .stage-bar-fill { height: 100%; border-radius: 4px; }
        .stage-bar-blue { background: var(--blue); }
        .stage-bar-purple { background: var(--purple); }
        .stage-bar-amber { background: var(--amber); }
        .stage-bar-orange { background: #f97316; }
        .stage-bar-cyan { background: var(--cyan); }
        .stage-bar-green { background: var(--green); }
        .stage-bar-red { background: var(--red); }

        /* Toolbar */
        .toolbar { display: flex; gap: 10px; }
        .search-box { display: flex; align-items: center; gap: 8px; background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 7px 10px; flex: 1; color: var(--text-faint); }
        .search-box input { background: none; border: none; outline: none; color: var(--text); font-size: 13px; width: 100%; font-family: var(--font-sans); }
        select {
          background: var(--panel); border: 1px solid var(--border); border-radius: 8px; color: var(--text);
          padding: 7px 10px; font-size: 13px; font-family: var(--font-sans);
        }

        /* Table */
        .table-wrap { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        thead th { text-align: left; padding: 10px 16px; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-faint); font-family: var(--font-mono); border-bottom: 1px solid var(--border); background: var(--panel-2); }
        tbody td { padding: 12px 16px; border-bottom: 1px solid var(--border); vertical-align: middle; }
        tbody tr:last-child td { border-bottom: none; }
        tbody tr { cursor: pointer; }
        tbody tr:hover { background: var(--panel-2); }
        .mono { font-family: var(--font-mono); font-size: 12.5px; color: var(--text-dim); }
        .cell-primary { font-weight: 600; color: var(--text); }
        .cell-sub { color: var(--text-faint); font-size: 12px; }
        .row-arrow { color: var(--text-faint); }

        /* Chips */
        .chip { display: inline-flex; align-items: center; padding: 3px 9px; border-radius: 20px; font-size: 11.5px; font-weight: 600; font-family: var(--font-mono); border: 1px solid; }
        .chip-default { background: var(--panel-2); color: var(--text-dim); border-color: var(--border); }
        .chip-amber { background: var(--amber-bg); color: var(--amber); border-color: #fde68a; }
        .chip-green { background: var(--green-bg); color: var(--green); border-color: #bbf7d0; }
        .chip-red { background: var(--red-bg); color: var(--red); border-color: #fecaca; }
        .type-badge { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--text-dim); font-weight: 500; }

        /* Empty state */
        .empty-state { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 60px 20px; color: var(--text-faint); text-align: center; background: var(--panel); border: 1px dashed var(--border-strong); border-radius: 12px; }
        .not-connected-panel { display: flex; flex-direction: column; align-items: center; text-align: center; padding: 36px 20px; }
        .empty-title { font-family: var(--font-sans); font-weight: 600; font-size: 14px; color: var(--text-dim); }
        .empty-body { font-size: 12.5px; max-width: 280px; }

        /* Panels & forms */
        .panel { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 20px; box-shadow: 0 1px 2px rgba(15,23,41,0.03); }
        .panel-title { font-family: var(--font-sans); font-size: 12.5px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-dim); font-weight: 700; display: flex; align-items: center; gap: 7px; margin: 0 0 14px; }
        .panel-title-row { display: flex; align-items: center; justify-content: space-between; }
        .panel-title-row .panel-title { margin-bottom: 0; }
        .detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
        .field { display: flex; flex-direction: column; gap: 5px; margin-bottom: 12px; }
        .field-label { font-size: 11.5px; color: var(--text-dim); font-weight: 600; }
        .field-hint { font-size: 11.5px; color: var(--text-faint); }
        input, textarea {
          background: var(--panel); border: 1px solid var(--border-strong); border-radius: 8px; padding: 9px 11px;
          color: var(--text); font-size: 13px; font-family: var(--font-sans); outline: none; resize: vertical; width: 100%;
          transition: border-color 0.12s ease, box-shadow 0.12s ease;
        }
        input::placeholder, textarea::placeholder { color: var(--text-faint); }
        input:focus, textarea:focus, select:focus { border-color: var(--blue); box-shadow: 0 0 0 3px rgba(61,90,254,0.1); }
        .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .form-actions { display: flex; justify-content: space-between; margin-top: 6px; }
        .form-panel { max-width: 640px; }

        .mode-toggle { display: flex; gap: 6px; margin-bottom: 16px; }
        .mode-toggle button { flex: 1; padding: 8px; border-radius: 8px; border: 1px solid var(--border); background: var(--panel-2); color: var(--text-dim); cursor: pointer; font-size: 13px; font-family: var(--font-sans); font-weight: 500; }
        .mode-toggle button.active { border-color: var(--blue); color: var(--blue-dark); background: rgba(61,90,254,0.08); }

        .segmented { display: flex; gap: 6px; }
        .segmented button { display: flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 8px; border: 1px solid var(--border); background: var(--panel-2); color: var(--text-dim); cursor: pointer; font-size: 13px; font-family: var(--font-sans); font-weight: 500; }
        .segmented button.active { border-color: var(--blue); color: var(--blue-dark); background: rgba(61,90,254,0.08); }

        .wizard-progress { display: flex; gap: 18px; }
        .wizard-step { display: flex; align-items: center; gap: 7px; font-size: 12.5px; color: var(--text-faint); font-family: var(--font-mono); }
        .wizard-step.active { color: var(--blue-dark); }
        .wizard-step.past { color: var(--green); }
        .wizard-dot { width: 18px; height: 18px; border-radius: 50%; border: 1px solid currentColor; display: flex; align-items: center; justify-content: center; font-size: 10.5px; }

        .id-callout { display: flex; align-items: center; gap: 8px; background: var(--green-bg); border: 1px solid #bbf7d0; color: var(--green); padding: 10px 14px; border-radius: 8px; font-size: 13px; font-weight: 500; }
        .done-panel { text-align: center; padding: 40px 20px; max-width: 480px; }
        .done-icon { color: var(--green); margin-bottom: 8px; }
        .id-row { display: flex; justify-content: center; gap: 40px; margin: 20px 0; }
        .big { font-size: 17px; color: var(--blue-dark); }

        /* Stage stepper — signature element */
        .stepper-panel { display: flex; flex-direction: column; gap: 16px; }
        .stepper { display: flex; align-items: center; overflow-x: auto; padding: 6px 2px; }
        .step-node { display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 84px; }
        .step-dot {
          width: 26px; height: 26px; border-radius: 6px; border: 1.5px solid var(--border-strong);
          display: flex; align-items: center; justify-content: center; font-family: var(--font-mono);
          font-size: 11px; color: var(--text-faint); background: var(--panel-2);
        }
        .step-node.done .step-dot { border-color: var(--green); color: var(--green); background: var(--green-bg); }
        .step-node.current .step-dot { border-color: var(--blue); color: var(--blue-dark); background: rgba(61,90,254,0.1); box-shadow: 0 0 0 4px rgba(61,90,254,0.1); }
        .step-node.lost .step-dot { border-color: var(--red); color: var(--red); background: var(--red-bg); }
        .step-label { font-size: 10.5px; color: var(--text-faint); text-align: center; font-family: var(--font-mono); white-space: nowrap; }
        .step-node.done .step-label, .step-node.current .step-label { color: var(--text-dim); font-weight: 600; }
        .step-gate-mark { color: var(--amber); margin-left: 2px; }
        .step-trace { flex: 1; min-width: 20px; height: 1.5px; background: var(--border-strong); margin: 0 -4px 18px; }
        .step-trace.done { background: var(--green); }
        .stage-controls { display: flex; gap: 10px; border-top: 1px solid var(--border); padding-top: 14px; }
        .finance-note { font-size: 12px; color: var(--text-faint); border-top: 1px solid var(--border); padding-top: 12px; }

        /* Detail header */
        .back-link { display: inline-flex; align-items: center; gap: 4px; background: none; border: none; color: var(--text-faint); font-size: 12.5px; cursor: pointer; padding: 0; width: fit-content; }
        .back-link:hover { color: var(--text-dim); }
        .detail-header { display: flex; align-items: flex-start; justify-content: space-between; }
        .detail-ids { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
        .id-chip { background: var(--panel-2); border: 1px solid var(--border-strong); padding: 3px 8px; border-radius: 6px; font-size: 12px; color: var(--blue-dark); font-weight: 600; }
        .id-chip.subtle { color: var(--text-dim); font-weight: 500; }

        .kv { display: flex; justify-content: space-between; gap: 12px; padding: 7px 0; border-bottom: 1px solid var(--border); font-size: 13px; }
        .kv:last-child { border-bottom: none; }
        .kv span:first-child { color: var(--text-faint); }
        .arch-text { font-size: 13px; line-height: 1.6; color: var(--text-dim); white-space: pre-wrap; margin: 0 0 12px; }

        .note-list { display: flex; flex-direction: column; gap: 10px; }
        .note-card { background: var(--panel-2); border: 1px solid var(--border); border-radius: 8px; padding: 12px; transition: background 0.3s ease, border-color 0.3s ease; }
        .note-card-new { background: var(--green-bg); border-color: #bbf7d0; animation: note-pulse 1.2s ease 2; }
        @keyframes note-pulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(22,163,74,0); } 50% { box-shadow: 0 0 0 4px rgba(22,163,74,0.15); } }
        .note-meta { display: flex; justify-content: space-between; font-size: 11px; color: var(--text-faint); margin-bottom: 6px; font-family: var(--font-mono); }
        .note-text { font-size: 12.5px; color: var(--text-dim); white-space: pre-wrap; line-height: 1.5; }

        .stake-list, .approval-list, .history-list { list-style: none; padding: 0; margin: 0 0 12px; display: flex; flex-direction: column; gap: 10px; }
        .stake-list li { display: flex; flex-direction: column; gap: 2px; padding-bottom: 8px; border-bottom: 1px solid var(--border); }
        .stake-list li:last-child { border-bottom: none; }
        .approval-list li { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding-bottom: 8px; border-bottom: 1px solid var(--border); }
        .approval-list li:last-child { border-bottom: none; }
        .approval-comment { flex-basis: 100%; font-size: 12px; color: var(--text-faint); margin-top: 2px; }
        .history-list li { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--text-dim); }
        .history-list li .cell-sub { margin-left: auto; }

        .inline-form { display: flex; gap: 8px; margin-top: 4px; }
        .inline-form input { flex: 1; }

        .inline-warning { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--amber); margin-top: 8px; }

        .ai-result { margin-top: 12px; }

        .ai-suggestion-list { display: flex; flex-direction: column; gap: 10px; margin: 12px 0; }
        .ai-suggestion-card { display: flex; gap: 10px; background: var(--panel-2); border: 1px solid var(--border); border-radius: 10px; padding: 12px; }
        .ai-suggestion-check { padding-top: 3px; }
        .ai-suggestion-check input { width: 16px; height: 16px; }
        .ai-suggestion-body { flex: 1; display: flex; flex-direction: column; gap: 6px; }
        .ai-suggestion-title { font-weight: 600; font-size: 13.5px; border: 1px solid transparent; background: transparent; padding: 4px 6px; border-radius: 6px; }
        .ai-suggestion-title:focus { border-color: var(--border-strong); background: var(--panel); }
        .ai-suggestion-desc { font-size: 12.5px; color: var(--text-dim); border: 1px solid transparent; background: transparent; padding: 4px 6px; border-radius: 6px; resize: vertical; }
        .ai-suggestion-desc:focus { border-color: var(--border-strong); background: var(--panel); }
        .ai-suggestion-body select { width: fit-content; font-size: 12px; }
        .ai-result-label { font-size: 11px; color: var(--text-faint); margin-bottom: 6px; font-family: var(--font-mono); }

        .spin { animation: spin 0.9s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }

        /* Modal */
        .modal-backdrop { position: fixed; inset: 0; background: rgba(15,23,41,0.45); display: flex; align-items: center; justify-content: center; z-index: 50; padding: 20px; }
        .modal { background: var(--panel); border: 1px solid var(--border); border-radius: 14px; width: 100%; max-width: 520px; max-height: 86vh; display: flex; flex-direction: column; box-shadow: 0 30px 60px rgba(15,23,41,0.25); }
        .modal-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid var(--border); }
        .modal-header h3 { margin: 0; font-family: var(--font-sans); font-weight: 700; font-size: 14px; display: flex; align-items: center; gap: 8px; }
        .modal-body { padding: 18px 20px; overflow-y: auto; }
        .modal-actions { display: flex; justify-content: flex-end; gap: 10px; padding: 14px 20px; border-top: 1px solid var(--border); }

        @media (max-width: 860px) {
          .topbar { padding: 10px 16px; flex-wrap: wrap; }
          .topbar-user-info { display: none; }
          .role-banner, .nav-tabs-bar { padding-left: 16px; padding-right: 16px; }
          .main { padding: 18px 16px; }
          .detail-grid, .grid-2 { grid-template-columns: 1fr; }
          .stat-row { flex-wrap: wrap; }
          .stat-grid { grid-template-columns: repeat(2, 1fr); }
          .kanban { grid-template-columns: 1fr; }
          .employee-card-controls { grid-template-columns: 1fr 1fr; }
          .login-card { padding: 30px 24px; }
          .login-layout { flex-direction: column; align-items: center; }
          .login-card, .test-users-panel { width: 100%; max-width: 380px; }
          .dept-select-card { padding: 30px 22px; }
          .dept-select-grid { grid-template-columns: 1fr 1fr; }
        }
`;
