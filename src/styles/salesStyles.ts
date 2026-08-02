/* Additional styles for the Sales-OS feature modules (Companies, Pipeline,
   AI intake chat, KPIs, Performance, Knowledge, Expenses). Injected alongside
   APP_STYLES so it inherits the same design tokens (var(--...)). */
export const SALES_STYLES = `
        .app-shell .subhead-row { display: flex; align-items: center; justify-content: space-between; margin: 16px 0 8px; border-top: 1px solid var(--border); padding-top: 12px; }
        .app-shell .subhead { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 700; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.04em; }
        .app-shell .contact-row { border: 1px solid var(--border); border-radius: 10px; padding: 10px; margin-bottom: 8px; background: var(--panel-2); }
        .app-shell .contact-row-actions { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
        .app-shell .contact-row-actions .chip { cursor: pointer; border: none; }
        .app-shell .text-danger { color: var(--red) !important; }

        /* ---- Pipeline board ---- */
        .app-shell .pipeline-board { display: flex; gap: 12px; overflow-x: auto; padding-bottom: 12px; }
        .app-shell .pipe-col { flex: 0 0 224px; background: var(--panel-2); border: 1px solid var(--border); border-radius: 12px; display: flex; flex-direction: column; min-height: 120px; }
        .app-shell .pipe-col.pipe-outcome { background: #eef2fb; }
        .app-shell .pipe-col-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; border-bottom: 2px solid var(--border); position: sticky; top: 0; }
        .app-shell .pipe-col-name { display: flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 700; color: var(--text); }
        .app-shell .pipe-col-body { padding: 8px; display: flex; flex-direction: column; gap: 8px; flex: 1; }
        .app-shell .pipe-col.pipe-blue .pipe-col-head { border-bottom-color: var(--blue); }
        .app-shell .pipe-col.pipe-indigo .pipe-col-head { border-bottom-color: var(--indigo); }
        .app-shell .pipe-col.pipe-purple .pipe-col-head { border-bottom-color: var(--purple); }
        .app-shell .pipe-col.pipe-cyan .pipe-col-head { border-bottom-color: var(--cyan); }
        .app-shell .pipe-col.pipe-teal .pipe-col-head { border-bottom-color: #14b8a6; }
        .app-shell .pipe-col.pipe-amber .pipe-col-head { border-bottom-color: var(--amber); }
        .app-shell .pipe-col.pipe-orange .pipe-col-head { border-bottom-color: #ea580c; }
        .app-shell .pipe-col.pipe-green .pipe-col-head { border-bottom-color: var(--green); }
        .app-shell .pipe-col.pipe-red .pipe-col-head { border-bottom-color: var(--red); }
        .app-shell .pipe-col.pipe-slate .pipe-col-head { border-bottom-color: var(--text-faint); }
        .app-shell .pipe-card { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 9px 10px; box-shadow: 0 1px 2px rgba(15,23,41,0.04); cursor: grab; }
        .app-shell .pipe-card:active { cursor: grabbing; }
        .app-shell .pipe-card.stale { border-color: var(--red); box-shadow: 0 0 0 1px var(--red-bg); }
        .app-shell .pipe-card-top { display: flex; align-items: center; gap: 4px; cursor: pointer; }
        .app-shell .pipe-grip { color: var(--text-faint); flex-shrink: 0; }
        .app-shell .pipe-card-title { font-size: 13px; font-weight: 600; color: var(--text); line-height: 1.25; }
        .app-shell .pipe-card-company { font-size: 12px; color: var(--text-dim); margin: 3px 0; cursor: pointer; }
        .app-shell .pipe-card-meta { display: flex; align-items: center; justify-content: space-between; font-size: 11.5px; }
        .app-shell .pipe-stale-flag { display: inline-flex; align-items: center; gap: 3px; font-size: 10.5px; color: var(--red); font-weight: 600; margin-top: 4px; }
        .app-shell .pipe-card-actions { display: flex; gap: 4px; margin-top: 7px; padding-top: 7px; border-top: 1px solid var(--border); }
        .app-shell .pipe-card-actions .btn { padding: 3px 7px; font-size: 11px; }

        /* ---- AI intake chat modal ---- */
        .app-shell .chat-modal { max-width: 560px; display: flex; flex-direction: column; }
        .app-shell .chat-scroll { padding: 16px 20px; overflow-y: auto; flex: 1; max-height: 52vh; display: flex; flex-direction: column; gap: 12px; }
        .app-shell .chat-intro { background: var(--panel-2); border: 1px dashed var(--border-strong); border-radius: 10px; padding: 10px 12px; font-size: 12.5px; color: var(--text-dim); display: flex; gap: 8px; align-items: flex-start; }
        .app-shell .chat-msg { display: flex; gap: 8px; align-items: flex-start; }
        .app-shell .chat-msg.chat-agent { flex-direction: row-reverse; }
        .app-shell .chat-avatar { width: 26px; height: 26px; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; background: var(--panel-2); color: var(--text-dim); border: 1px solid var(--border); }
        .app-shell .chat-agent .chat-avatar { background: var(--blue); color: #fff; border-color: var(--blue); }
        .app-shell .chat-bubble { position: relative; background: var(--panel-2); border: 1px solid var(--border); border-radius: 12px; padding: 9px 12px; font-size: 13px; line-height: 1.45; max-width: 80%; color: var(--text); }
        .app-shell .chat-agent .chat-bubble { background: var(--blue); color: #fff; border-color: var(--blue); }
        .app-shell .chat-summary { padding: 14px 20px; border-top: 1px solid var(--border); }
        .app-shell .chat-summary textarea { width: 100%; }
        .app-shell .chat-input-row { display: flex; gap: 8px; align-items: flex-end; padding: 12px 16px; border-top: 1px solid var(--border); }
        .app-shell .chat-input-row textarea { flex: 1; resize: none; }
        .app-shell .chat-send { padding: 9px 12px; }
        .app-shell .chat-mic { width: 38px; height: 38px; border-radius: 9px; border: 1px solid var(--border-strong); background: var(--panel); color: var(--text-dim); display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; }
        .app-shell .chat-mic.recording { background: var(--red); color: #fff; border-color: var(--red); animation: pulse 1.2s infinite; }
        @keyframes pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(220,38,38,0.4);} 50% { box-shadow: 0 0 0 6px rgba(220,38,38,0);} }
        .app-shell .chat-panel { padding: 0; overflow: hidden; }
        .app-shell .knowledge-scroll { max-height: 46vh; }
        .app-shell .copy-btn { position: absolute; top: 6px; right: 6px; background: transparent; border: none; color: var(--text-faint); cursor: pointer; opacity: 0.6; }
        .app-shell .copy-btn:hover { opacity: 1; }
        .app-shell .tpl-chips { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
        .app-shell .tpl-chip { cursor: pointer; border: 1px solid var(--border-strong); }
        .app-shell .kb-link { display: inline-flex; align-items: center; gap: 3px; color: var(--blue); }

        /* ---- KPI setting ---- */
        .app-shell .kpi-set-list { display: flex; flex-direction: column; gap: 8px; }
        .app-shell .kpi-set-row { border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
        .app-shell .kpi-set-head { width: 100%; display: flex; align-items: center; gap: 10px; padding: 11px 12px; background: var(--panel); border: none; cursor: pointer; text-align: left; }
        .app-shell .kpi-set-head .chip { margin-left: auto; }
        .app-shell .kpi-set-body { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 14px; padding: 14px; background: var(--panel-2); border-top: 1px solid var(--border); }
        .app-shell .playbook-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 14px; }

        /* ---- Performance scorecards ---- */
        .app-shell .scorecard.scorecard-danger { border-color: var(--red); background: var(--red-bg); }
        .app-shell .attainment-hero { text-align: center; padding: 8px 0 14px; }
        .app-shell .attainment-num { font-size: 42px; font-weight: 800; font-family: var(--font-mono); line-height: 1; }
        .app-shell .kpi-bars { display: flex; flex-direction: column; gap: 10px; }
        .app-shell .kpi-bar-row { display: flex; flex-direction: column; gap: 4px; }
        .app-shell .kpi-bar-label { display: flex; justify-content: space-between; font-size: 12.5px; }
        .app-shell .kpi-bar-track { height: 7px; background: var(--border); border-radius: 4px; overflow: hidden; }
        .app-shell .kpi-bar-fill { height: 100%; border-radius: 4px; }
        .app-shell .kpi-bar-ok { background: var(--green); }
        .app-shell .kpi-bar-danger { background: var(--red); }
        .app-shell tr.row-danger { background: var(--red-bg); }

        /* ---- Health banner (the "firing tool") ---- */
        .app-shell .health-banner { display: flex; flex-direction: column; gap: 6px; padding: 12px 16px; border-radius: 12px; margin-bottom: 16px; border: 1px solid var(--border); }
        .app-shell .health-banner.health-danger { background: var(--red-bg); border-color: var(--red); }
        .app-shell .health-banner.health-ok { background: var(--green-bg); border-color: #bbf7d0; }
        .app-shell .health-title { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 13.5px; }
        .app-shell .health-banner.health-danger .health-title { color: var(--red); }
        .app-shell .health-banner.health-ok .health-title { color: var(--green); }
        .app-shell .health-alert { display: flex; align-items: center; gap: 7px; font-size: 12.5px; color: var(--text); }
        .app-shell .health-alert .dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
        .app-shell .health-alert .dot.danger { background: var(--red); }
        .app-shell .health-alert .dot.warn { background: var(--amber); }

        @media (max-width: 860px) {
          .app-shell .kpi-set-body, .app-shell .playbook-grid { grid-template-columns: 1fr; }
          .app-shell .pipe-col { flex-basis: 200px; }
        }
`;
