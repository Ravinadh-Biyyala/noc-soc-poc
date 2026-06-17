const { useState, useEffect, useRef, useCallback } = React;

/* ============================================================
   YASHODA DIAGNOSTIC THROUGHPUT COPILOT — Hackathon Demo
   Simulates: HIS/LIS/RIS events → Pub/Sub → BigQuery →
   Vertex AI Agent (tools) → Gemini Enterprise chat surface
   ============================================================ */

// ---------- Mock operational data (the "BigQuery" layer) ----------

const MODALITIES = [
  { key: "MRI", name: "MRI", slaMin: 90, queue: 9, inProgress: 3, delayed: 5, avgTat: 117, trend: "+12%" },
  { key: "CT", name: "CT Scan", slaMin: 60, queue: 7, inProgress: 2, delayed: 4, avgTat: 84, trend: "+8%" },
  { key: "XRAY", name: "X-Ray", slaMin: 30, queue: 11, inProgress: 4, delayed: 1, avgTat: 26, trend: "-3%" },
  { key: "LAB", name: "Lab Panel", slaMin: 120, queue: 23, inProgress: 9, delayed: 3, avgTat: 104, trend: "+2%" },
  { key: "USG", name: "Ultrasound", slaMin: 45, queue: 6, inProgress: 2, delayed: 0, avgTat: 38, trend: "-5%" },
];

const DELAYED_ORDERS = [
  { id: "RAD-30412", test: "MRI Brain (contrast)", unit: "Emergency", patient: "P. Lakshmi", delay: 42, reason: "Machine 3 — unplanned maintenance", critical: true },
  { id: "RAD-30418", test: "MRI Spine", unit: "Ortho OPD", patient: "K. Srinivas", delay: 35, reason: "Machine 3 — unplanned maintenance", critical: false },
  { id: "RAD-30421", test: "MRI Knee", unit: "Ortho OPD", patient: "A. Fatima", delay: 28, reason: "Queue backlog (Machine 3 offline)", critical: false },
  { id: "RAD-30409", test: "MRI Abdomen", unit: "Gastro ICU", patient: "R. Mohan", delay: 24, reason: "Contrast availability check", critical: true },
  { id: "RAD-30425", test: "MRI Brain", unit: "Neuro Ward", patient: "S. Devi", delay: 11, reason: "Patient prep pending", critical: false },
  { id: "RAD-30401", test: "CT Chest", unit: "Emergency", patient: "B. Naidu", delay: 31, reason: "Radiologist sign-off pending", critical: true },
  { id: "RAD-30406", test: "CT Angio", unit: "Cardiology", patient: "M. Reddy", delay: 22, reason: "Radiologist sign-off pending", critical: false },
  { id: "RAD-30415", test: "CT Abdomen", unit: "Surgery Ward", patient: "J. Kumar", delay: 17, reason: "Transport delay", critical: false },
  { id: "RAD-30419", test: "CT Brain", unit: "Emergency", patient: "V. Rao", delay: 9, reason: "Queue backlog", critical: false },
  { id: "LAB-88102", test: "Troponin-I", unit: "Emergency", patient: "G. Prasad", delay: 19, reason: "Analyzer recalibration", critical: true },
  { id: "LAB-88110", test: "CBC + CRP", unit: "Pediatrics", patient: "T. Anvi", delay: 14, reason: "Sample re-collection", critical: false },
  { id: "LAB-88097", test: "Renal Panel", unit: "Nephrology", patient: "D. Swamy", delay: 12, reason: "Batch queue", critical: false },
  { id: "RAD-30428", test: "X-Ray Chest", unit: "TB & Chest", patient: "N. Bee", delay: 8, reason: "Portable unit in use", critical: false },
];

const EVENT_TEMPLATES = [
  ["ORDER_CREATED", "New CT Abdomen order from Surgery Ward"],
  ["SAMPLE_COLLECTED", "Troponin-I sample collected — Emergency"],
  ["MRI_STARTED", "MRI Brain started on Machine 1"],
  ["MRI_COMPLETED", "MRI Spine completed on Machine 2"],
  ["REPORT_SIGNED", "CT Chest report signed — Dr. Anitha"],
  ["TAT_WARNING", "RAD-30431 approaching SLA (T-10 min)"],
  ["ESCALATION", "Escalation paged to Radiology Lead"],
  ["SAMPLE_RECEIVED", "CBC sample received at Central Lab"],
  ["ORDER_CREATED", "New MRI Knee order from Ortho OPD"],
  ["REPORT_SIGNED", "MRI Abdomen report signed — Dr. Verma"],
];

const SUGGESTED = [
  "Which MRI scans are delayed today?",
  "Why are CT scans delayed?",
  "Show diagnostics violating SLA",
  "Any critical patients at risk?",
];

// ---------- Simulated Vertex AI Agent (tool routing) ----------

function fmt(n) { return n.toString(); }

function runAgent(query) {
  const q = query.toLowerCase();
  const mri = MODALITIES[0];
  const ct = MODALITIES[1];

  if (q.includes("mri")) {
    const rows = DELAYED_ORDERS.filter(o => o.test.startsWith("MRI"));
    const avg = Math.round(rows.reduce((s, o) => s + o.delay, 0) / rows.length);
    return {
      trace: [
        { node: "Gemini Enterprise", detail: "Intent: list delayed MRI studies" },
        { node: "Diagnostic Monitoring Agent", detail: "Selected tool getDelayedMRIs()" },
        { node: "Cloud Run · diagnostic-api", detail: "GET /mri-delays" },
        { node: "BigQuery · radiology_queue", detail: `SELECT … WHERE modality='MRI' AND delay>0 → ${rows.length} rows` },
      ],
      text: `${rows.length} MRI studies are currently delayed (avg ${avg} min against a ${mri.slaMin}-min SLA). The primary bottleneck is Machine 3, which went into unplanned maintenance at 10:42 — it accounts for 3 of the 5 delays. RAD-30412 (Emergency, contrast study) and RAD-30409 (Gastro ICU) are flagged critical.`,
      rows,
      followup: "Ask “Why are CT scans delayed?” or “Escalate RAD-30412”.",
    };
  }

  if (q.includes("why") || q.includes("root cause") || (q.includes("ct") && !q.includes("critical"))) {
    const rows = DELAYED_ORDERS.filter(o => o.test.startsWith("CT"));
    return {
      trace: [
        { node: "Gemini Enterprise", detail: "Intent: root-cause analysis for CT delays" },
        { node: "Root Cause Agent", detail: "Selected tools getTATBreaches(), getQueueEvents()" },
        { node: "Cloud Run · tat-monitor", detail: "GET /tat-breaches?modality=CT" },
        { node: "BigQuery · diagnostic_events", detail: "Joined order timeline across 4 delayed CT studies" },
      ],
      text: `CT delays today trace to two causes. First, radiologist sign-off is the largest contributor — 2 of 4 delayed studies completed scanning on time but are waiting on reports (avg 19 min in the sign-off queue; only one radiologist is rostered until 14:00). Second, inter-ward transport added 17 min to RAD-30415. Scanner capacity itself is healthy — both CT machines are running at 82% utilisation with no faults.`,
      rows,
      followup: "Ask “Show diagnostics violating SLA” to see the full breach list.",
    };
  }

  if (q.includes("sla") || q.includes("breach") || q.includes("violat") || q.includes("tat")) {
    const rows = DELAYED_ORDERS.filter(o => o.delay >= 15);
    return {
      trace: [
        { node: "Gemini Enterprise", detail: "Intent: list SLA / TAT breaches" },
        { node: "Operations Copilot Agent", detail: "Selected tool getTATBreaches()" },
        { node: "Cloud Run · tat-monitor", detail: "GET /tat-breaches?threshold=15" },
        { node: "BigQuery · diagnostic_orders", detail: `${rows.length} orders past SLA threshold` },
      ],
      text: `${rows.length} diagnostics have breached SLA by 15 minutes or more. Emergency is the most affected unit (3 breaches), and 4 of the breaches involve patients flagged critical. The escalation-service has already paged the Radiology Lead for RAD-30412; the remaining critical breaches have no open escalation yet.`,
      rows,
      followup: "Ask “Any critical patients at risk?” to filter by acuity.",
    };
  }

  if (q.includes("critical") || q.includes("risk") || q.includes("patient")) {
    const rows = DELAYED_ORDERS.filter(o => o.critical);
    return {
      trace: [
        { node: "Gemini Enterprise", detail: "Intent: critical patients with delayed diagnostics" },
        { node: "Diagnostic Monitoring Agent", detail: "Selected tool getCriticalPatients()" },
        { node: "Cloud Run · diagnostic-api", detail: "GET /critical-tests" },
        { node: "BigQuery · diagnostic_orders ⋈ HIS acuity feed", detail: `${rows.length} critical-acuity matches` },
      ],
      text: `${rows.length} critical-acuity patients have a delayed diagnostic right now. The highest risk is G. Prasad in Emergency — a Troponin-I delayed 19 min by analyzer recalibration, which directly gates a cardiac decision. Recommend immediate escalation for LAB-88102 and re-routing RAD-30412 to Machine 1's next slot (frees in ~8 min).`,
      rows,
      followup: "Ask “Which MRI scans are delayed today?” for the modality view.",
    };
  }

  return {
    trace: [
      { node: "Gemini Enterprise", detail: "Intent: general / unmatched" },
      { node: "Operations Copilot Agent", detail: "No matching tool — returning capabilities" },
    ],
    text: `I can answer live operational questions over the hospital's diagnostic pipeline. Try asking about delayed MRI or CT studies, SLA breaches, root causes, or critical patients at risk. Each answer is built by calling Cloud Run tools over BigQuery — not from static reports.`,
    rows: null,
    followup: null,
  };
}

// ---------- Small components ----------

function StatusDot({ color }) {
  return <span className="dot" style={{ background: color }} />;
}

function TatBar({ avg, sla }) {
  const pct = Math.min((avg / sla) * 100, 130);
  const over = avg > sla;
  return (
    <div className="tatbar">
      <div className="tatbar-track">
        <div className="tatbar-sla" style={{ left: `${Math.min((sla / (sla * 1.3)) * 100, 100)}%` }} />
        <div className="tatbar-fill" style={{ width: `${Math.min((avg / (sla * 1.3)) * 100, 100)}%`, background: over ? "var(--red)" : "var(--teal)" }} />
      </div>
      <span className="mono" style={{ color: over ? "var(--red)" : "var(--ink-soft)", fontSize: 11 }}>
        {avg}m / {sla}m
      </span>
    </div>
  );
}

function Trace({ steps, done }) {
  return (
    <div className="trace">
      <div className="trace-label">AGENT TRACE</div>
      {steps.map((s, i) => (
        <div key={i} className={`trace-step ${i < done ? "on" : ""}`}>
          <div className="trace-rail">
            <span className={`trace-node ${i < done ? "on" : ""}`} />
            {i < steps.length - 1 && <span className="trace-line" />}
          </div>
          <div>
            <div className="trace-name">{s.node}</div>
            <div className="trace-detail mono">{s.detail}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function OrderTable({ rows }) {
  return (
    <div className="otable">
      <div className="otable-row otable-head">
        <span>ORDER</span><span>TEST</span><span>UNIT</span><span>DELAY</span>
      </div>
      {rows.slice(0, 6).map(o => (
        <div className="otable-row" key={o.id}>
          <span className="mono">{o.id}{o.critical && <em className="crit">CRIT</em>}</span>
          <span>{o.test}</span>
          <span className="muted">{o.unit}</span>
          <span className="mono" style={{ color: o.delay >= 20 ? "var(--red)" : "var(--amber)" }}>+{o.delay}m</span>
        </div>
      ))}
      {rows.length > 6 && <div className="otable-more muted">+ {rows.length - 6} more in console</div>}
    </div>
  );
}

// ---------- Main app ----------

function App() {
  const [tab, setTab] = useState("board"); // mobile only
  const [clock, setClock] = useState(new Date());
  const [events, setEvents] = useState([
    { t: "11:02", type: "TAT_WARNING", msg: "RAD-30412 breached SLA (+42 min)" },
    { t: "10:58", type: "ESCALATION", msg: "Escalation paged to Radiology Lead" },
    { t: "10:42", type: "TAT_WARNING", msg: "MRI Machine 3 — unplanned maintenance" },
  ]);
  const [messages, setMessages] = useState([
    {
      role: "agent",
      text: "Good morning. I'm watching 56 active diagnostic orders across 5 modalities. 13 are delayed and 4 involve critical-acuity patients. Ask me anything about live throughput.",
      trace: null, rows: null, followup: null, done: 0,
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const chatRef = useRef(null);
  const evIdx = useRef(0);

  // Live clock
  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Simulated Pub/Sub event stream
  useEffect(() => {
    const id = setInterval(() => {
      const [type, msg] = EVENT_TEMPLATES[evIdx.current % EVENT_TEMPLATES.length];
      evIdx.current += 1;
      const now = new Date();
      const t = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      setEvents(prev => [{ t, type, msg }, ...prev].slice(0, 14));
    }, 6500);
    return () => clearInterval(id);
  }, []);

  // Auto-scroll chat
  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages, busy]);

  const ask = useCallback((q) => {
    const query = (q || "").trim();
    if (!query || busy) return;
    setInput("");
    setBusy(true);
    setMessages(prev => [...prev, { role: "user", text: query }]);

    const result = runAgent(query);
    const msg = { role: "agent", text: "", trace: result.trace, rows: null, followup: null, done: 0, pendingRows: result.rows, pendingText: result.text, pendingFollow: result.followup };

    setMessages(prev => [...prev, msg]);

    // Animate the trace steps, then reveal the answer
    let step = 0;
    const total = result.trace.length;
    const tick = setInterval(() => {
      step += 1;
      setMessages(prev => {
        const next = [...prev];
        const last = { ...next[next.length - 1] };
        last.done = step;
        if (step >= total) {
          last.text = last.pendingText;
          last.rows = last.pendingRows;
          last.followup = last.pendingFollow;
        }
        next[next.length - 1] = last;
        return next;
      });
      if (step >= total) {
        clearInterval(tick);
        setBusy(false);
      }
    }, 520);
  }, [busy]);

  const totalDelayed = MODALITIES.reduce((s, m) => s + m.delayed, 0);
  const breaches = DELAYED_ORDERS.filter(o => o.delay >= 15).length;
  const criticals = DELAYED_ORDERS.filter(o => o.critical).length;
  const hh = String(clock.getHours()).padStart(2, "0");
  const mm = String(clock.getMinutes()).padStart(2, "0");
  const ss = String(clock.getSeconds()).padStart(2, "0");

  return (
    <div className="app">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
        :root{
          --paper:#F4F7F8; --panel:#FFFFFF; --ink:#10222E; --ink-soft:#5A6B75;
          --line:#DCE4E8; --teal:#0B7C77; --teal-deep:#085E5A; --amber:#B96E00;
          --red:#C2382C; --red-bg:#FBEDEB; --amber-bg:#FCF3E4; --teal-bg:#E6F2F1;
          --mono:'IBM Plex Mono',ui-monospace,monospace; --sans:'IBM Plex Sans',system-ui,sans-serif;
        }
        *{box-sizing:border-box;margin:0;padding:0}
        .app{min-height:100vh;background:var(--paper);color:var(--ink);font-family:var(--sans);display:flex;flex-direction:column}
        .mono{font-family:var(--mono)}
        .muted{color:var(--ink-soft)}
        .dot{width:8px;height:8px;border-radius:50%;display:inline-block}

        /* Top bar */
        .topbar{background:var(--ink);color:#E9F1F0;padding:10px 20px;display:flex;align-items:center;gap:16px;flex-wrap:wrap}
        .brand{font-weight:700;letter-spacing:.02em}
        .brand small{display:block;font-weight:400;font-size:11px;color:#9FB4B2;letter-spacing:.12em}
        .topbar .spacer{flex:1}
        .sys{display:flex;align-items:center;gap:8px;font-size:12px;color:#B9CCCA}
        .sys .mono{color:#E9F1F0}
        .clock{font-family:var(--mono);font-size:18px;font-weight:600;font-variant-numeric:tabular-nums}
        .clock span{color:#6F8886}

        /* Layout */
        .main{flex:1;display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,.85fr);gap:16px;padding:16px 20px;max-width:1400px;width:100%;margin:0 auto}
        .tabs{display:none}
        @media(max-width:920px){
          .main{grid-template-columns:1fr}
          .tabs{display:flex;gap:8px;padding:12px 16px 0}
          .tabs button{flex:1;padding:9px;border:1px solid var(--line);background:var(--panel);border-radius:8px;font-family:var(--sans);font-weight:600;font-size:13px;color:var(--ink-soft);cursor:pointer}
          .tabs button.on{background:var(--ink);color:#fff;border-color:var(--ink)}
          .hide-m{display:none !important}
        }

        .panel{background:var(--panel);border:1px solid var(--line);border-radius:12px}
        .panel-h{padding:12px 16px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:8px}
        .panel-h h2{font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--ink)}
        .panel-h .tag{margin-left:auto;font-size:11px;color:var(--ink-soft);font-family:var(--mono)}

        /* KPI strip */
        .kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px}
        .kpi{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
        .kpi .v{font-family:var(--mono);font-size:30px;font-weight:600;line-height:1.1}
        .kpi .l{font-size:12px;color:var(--ink-soft);margin-top:2px}
        .kpi.red{border-left:4px solid var(--red)} .kpi.red .v{color:var(--red)}
        .kpi.amber{border-left:4px solid var(--amber)} .kpi.amber .v{color:var(--amber)}
        .kpi.teal{border-left:4px solid var(--teal)} .kpi.teal .v{color:var(--teal-deep)}

        /* Modality table */
        .mod-row{display:grid;grid-template-columns:110px 1fr 70px 70px;gap:10px;align-items:center;padding:11px 16px;border-bottom:1px solid var(--line);font-size:13px}
        .mod-row:last-child{border-bottom:none}
        .mod-name{font-weight:600}
        .mod-sub{font-size:11px;color:var(--ink-soft)}
        .pill{font-family:var(--mono);font-size:12px;text-align:center;padding:3px 0;border-radius:6px}
        .pill.q{background:var(--teal-bg);color:var(--teal-deep)}
        .pill.d{background:var(--red-bg);color:var(--red)}
        .pill.d.zero{background:#EEF2F4;color:var(--ink-soft)}
        .tatbar{display:flex;align-items:center;gap:8px}
        .tatbar-track{flex:1;height:8px;background:#EAEFF1;border-radius:4px;position:relative;overflow:visible}
        .tatbar-fill{height:100%;border-radius:4px;transition:width .6s}
        .tatbar-sla{position:absolute;top:-3px;width:2px;height:14px;background:var(--ink);opacity:.45}

        /* Event feed */
        .feed{max-height:240px;overflow-y:auto}
        .ev{display:flex;gap:10px;padding:8px 16px;border-bottom:1px solid var(--line);font-size:12.5px;animation:slidein .35s ease}
        .ev:last-child{border-bottom:none}
        .ev .t{font-family:var(--mono);color:var(--ink-soft);flex-shrink:0}
        .ev .type{font-family:var(--mono);font-size:10.5px;font-weight:600;padding:1px 6px;border-radius:4px;flex-shrink:0;align-self:center}
        .ev .type.ORDER_CREATED,.ev .type.SAMPLE_COLLECTED,.ev .type.SAMPLE_RECEIVED{background:#EEF2F4;color:var(--ink-soft)}
        .ev .type.MRI_STARTED,.ev .type.MRI_COMPLETED,.ev .type.REPORT_SIGNED{background:var(--teal-bg);color:var(--teal-deep)}
        .ev .type.TAT_WARNING{background:var(--amber-bg);color:var(--amber)}
        .ev .type.ESCALATION{background:var(--red-bg);color:var(--red)}
        @keyframes slidein{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}

        /* Copilot */
        .copilot{display:flex;flex-direction:column;min-height:520px;max-height:calc(100vh - 120px)}
        .chat{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:14px}
        .msg{max-width:92%;font-size:13.5px;line-height:1.55}
        .msg.user{align-self:flex-end;background:var(--ink);color:#F2F7F6;padding:9px 14px;border-radius:12px 12px 2px 12px}
        .msg.agent{align-self:flex-start;width:92%}
        .agent-head{display:flex;align-items:center;gap:8px;margin-bottom:6px}
        .agent-avatar{width:22px;height:22px;border-radius:6px;background:linear-gradient(135deg,var(--teal),#0F4C6B);color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;font-family:var(--mono)}
        .agent-name{font-size:11px;font-weight:700;letter-spacing:.08em;color:var(--ink-soft)}
        .bubble{background:var(--panel);border:1px solid var(--line);border-radius:2px 12px 12px 12px;padding:12px 14px}
        .followup{margin-top:8px;font-size:12px;color:var(--teal-deep)}

        /* Trace */
        .trace{background:#0F2230;border-radius:8px;padding:12px 14px;margin-bottom:10px}
        .trace-label{font-family:var(--mono);font-size:10px;letter-spacing:.18em;color:#5E7E8C;margin-bottom:8px}
        .trace-step{display:flex;gap:10px;opacity:.28;transition:opacity .4s}
        .trace-step.on{opacity:1}
        .trace-rail{display:flex;flex-direction:column;align-items:center;width:12px;flex-shrink:0}
        .trace-node{width:9px;height:9px;border-radius:50%;border:2px solid #3E5E6E;background:transparent;margin-top:4px}
        .trace-node.on{background:#33C2BB;border-color:#33C2BB;box-shadow:0 0 8px rgba(51,194,187,.5)}
        .trace-line{flex:1;width:2px;background:#24404F;min-height:14px;margin:2px 0}
        .trace-name{font-size:12px;font-weight:600;color:#D8E7E5}
        .trace-detail{font-size:11px;color:#7FA0AC;padding-bottom:8px;word-break:break-word}

        /* Result table inside chat */
        .otable{margin-top:10px;border:1px solid var(--line);border-radius:8px;overflow:hidden}
        .otable-row{display:grid;grid-template-columns:108px 1fr 90px 52px;gap:8px;padding:7px 10px;font-size:12px;border-bottom:1px solid var(--line);align-items:center}
        .otable-row:last-child{border-bottom:none}
        .otable-head{background:#F1F5F6;font-family:var(--mono);font-size:10px;letter-spacing:.1em;color:var(--ink-soft)}
        .otable .crit{font-style:normal;font-family:var(--mono);font-size:9px;background:var(--red);color:#fff;border-radius:3px;padding:1px 4px;margin-left:5px}
        .otable-more{padding:6px 10px;font-size:11px}

        /* Input */
        .suggest{display:flex;gap:8px;flex-wrap:wrap;padding:0 16px 10px}
        .suggest button{font-family:var(--sans);font-size:12px;padding:6px 11px;border-radius:99px;border:1px solid var(--line);background:#F7FAFA;color:var(--teal-deep);cursor:pointer}
        .suggest button:hover{background:var(--teal-bg);border-color:var(--teal)}
        .suggest button:disabled{opacity:.5;cursor:default}
        .inputrow{display:flex;gap:8px;padding:12px 16px;border-top:1px solid var(--line)}
        .inputrow input{flex:1;font-family:var(--sans);font-size:14px;padding:10px 14px;border:1px solid var(--line);border-radius:10px;outline:none;background:#FBFDFD}
        .inputrow input:focus{border-color:var(--teal);box-shadow:0 0 0 3px rgba(11,124,119,.12)}
        .inputrow button{font-family:var(--sans);font-weight:600;font-size:14px;padding:10px 18px;border:none;border-radius:10px;background:var(--teal);color:#fff;cursor:pointer}
        .inputrow button:disabled{background:#9CC4C2;cursor:default}
        .archnote{font-size:10.5px;color:var(--ink-soft);font-family:var(--mono);padding:0 16px 12px;letter-spacing:.02em}

        @media(prefers-reduced-motion:reduce){
          .ev{animation:none} .trace-step{transition:none} .tatbar-fill{transition:none}
        }
        button:focus-visible,input:focus-visible{outline:2px solid var(--teal);outline-offset:2px}
      `}</style>

      {/* ---------------- Top bar ---------------- */}
      <header className="topbar">
        <div className="brand">
          YASHODA HOSPITALS
          <small>DIAGNOSTIC THROUGHPUT CONSOLE</small>
        </div>
        <div className="spacer" />
        <div className="sys hide-m"><StatusDot color="#33C2BB" /> Pub/Sub <span className="mono">live</span></div>
        <div className="sys hide-m"><StatusDot color="#33C2BB" /> BigQuery <span className="mono">ok</span></div>
        <div className="sys hide-m"><StatusDot color="#E8A33D" /> MRI-3 <span className="mono">maint</span></div>
        <div className="clock">{hh}:{mm}<span>:{ss}</span></div>
      </header>

      {/* Mobile tabs */}
      <div className="tabs">
        <button className={tab === "board" ? "on" : ""} onClick={() => setTab("board")}>Operations board</button>
        <button className={tab === "chat" ? "on" : ""} onClick={() => setTab("chat")}>Copilot</button>
      </div>

      <div className="main">
        {/* ---------------- Left: Operations board ---------------- */}
        <div className={tab === "chat" ? "hide-m" : ""}>
          <div className="kpis">
            <div className="kpi red"><div className="v">{totalDelayed}</div><div className="l">Delayed diagnostics</div></div>
            <div className="kpi amber"><div className="v">{breaches}</div><div className="l">SLA breaches (≥15 min)</div></div>
            <div className="kpi teal"><div className="v">{criticals}</div><div className="l">Critical patients waiting</div></div>
          </div>

          <div className="panel" style={{ marginBottom: 16 }}>
            <div className="panel-h">
              <h2>Modality throughput</h2>
              <span className="tag">avg TAT vs SLA · today</span>
            </div>
            {MODALITIES.map(m => (
              <div className="mod-row" key={m.key}>
                <div>
                  <div className="mod-name">{m.name}</div>
                  <div className="mod-sub">{m.inProgress} in progress · {m.trend} vs LW</div>
                </div>
                <TatBar avg={m.avgTat} sla={m.slaMin} />
                <div className="pill q">{m.queue} queue</div>
                <div className={`pill d ${m.delayed === 0 ? "zero" : ""}`}>{m.delayed} late</div>
              </div>
            ))}
          </div>

          <div className="panel">
            <div className="panel-h">
              <h2>Live event stream</h2>
              <span className="tag">Pub/Sub · diagnostic_events</span>
            </div>
            <div className="feed">
              {events.map((e, i) => (
                <div className="ev" key={`${e.t}-${i}`}>
                  <span className="t">{e.t}</span>
                  <span className={`type ${e.type}`}>{e.type}</span>
                  <span>{e.msg}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ---------------- Right: Copilot ---------------- */}
        <div className={`panel copilot ${tab === "board" ? "hide-m" : ""}`}>
          <div className="panel-h">
            <h2>Operations copilot</h2>
            <span className="tag">Gemini Enterprise surface</span>
          </div>

          <div className="chat" ref={chatRef}>
            {messages.map((m, i) =>
              m.role === "user" ? (
                <div className="msg user" key={i}>{m.text}</div>
              ) : (
                <div className="msg agent" key={i}>
                  <div className="agent-head">
                    <div className="agent-avatar">DX</div>
                    <div className="agent-name">DIAGNOSTIC AGENT</div>
                  </div>
                  {m.trace && <Trace steps={m.trace} done={m.done} />}
                  {m.text && (
                    <div className="bubble">
                      {m.text}
                      {m.rows && <OrderTable rows={m.rows} />}
                      {m.followup && <div className="followup">→ {m.followup}</div>}
                    </div>
                  )}
                </div>
              )
            )}
          </div>

          <div className="suggest">
            {SUGGESTED.map(s => (
              <button key={s} onClick={() => ask(s)} disabled={busy}>{s}</button>
            ))}
          </div>
          <div className="inputrow">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && ask(input)}
              placeholder="Ask about delays, SLA breaches, root causes…"
              aria-label="Ask the diagnostic agent"
            />
            <button onClick={() => ask(input)} disabled={busy || !input.trim()}>
              {busy ? "Running…" : "Ask"}
            </button>
          </div>
          <div className="archnote">HIS/LIS/RIS → Pub/Sub → BigQuery → Vertex AI Agent → Gemini Enterprise</div>
        </div>
      </div>
    </div>
  );
}

window.App = App;