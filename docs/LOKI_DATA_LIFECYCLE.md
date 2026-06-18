# Loki Data Lifecycle & Label Reference

> Source: Grafana Loki at `http://65.0.120.127:3100`. A bank **NOC/SOC telemetry
> feed** — device performance metrics, monitoring alarms, an AI diagnosis stream,
> and legacy host syslog. Snapshot below taken over a 30‑day window; **~1,055
> active streams (series)** across 5 families.
>
> Every line is **JSON** except the legacy syslog family (plain text). Loki indexes
> only the **labels** (the stream selector); everything else lives in the **line
> payload** and is parsed at query time (`| json`, `regexp`, `unwrap`).

---

## 1. Freshness & lifecycle (live vs historical)

The feed mixes **real‑time** and **batched/historical** producers — important when
choosing a query time‑range:

| Stream | Cadence | Typical latest sample |
|---|---|---|
| `ai-agent` incidents/rca/… | **real‑time** (emitted continuously, ~now) | minutes ago |
| `solarwinds` / `manageengine` alarms | batched bursts | hours ago (e.g. last burst ~17:00) |
| `metric` (cpu/interface/latency) | batched bursts | hours ago (e.g. ~19:00) |
| `system` syslog | static historical | days ago |

**Consequence:** an AI incident is stamped *now*, but the device events it relates
to may be **hours older**. Dashboards/traces therefore (a) default to a **24h**
range so metric/alarm bursts stay in‑window, and (b) reconstruct traces by
anchoring the AI diagnosis at the **end of the device's event sequence**, not the
incident's wall‑clock time. Picking a short range (e.g. 1h) can legitimately yield
empty metric panels because the newest samples are older than the window.

Lifecycle of one event:
```
producer (SolarWinds/ManageEngine/agent/promtail)
   → JSON/text line + indexed labels
   → Loki ingester (stream = unique label set)
   → query time: stream selector picks streams → | json / unwrap parses payload
   → app: canonical NOC functions (app/loki/noc.py) shape it → dashboard / traces / chat
```

---

## 2. Stream families (the 5 shapes)

### 2.1 Device performance metrics — `{metric, device_id}`
- **Selector:** `{metric="cpu_utilization_percent|interface_utilization_percent|latency_ms", device_id="…"}`
- **Labels:** `metric`, `device_id`, `service_name="unknown_service"`
- **Series:** ~336 (112 devices × 3 metrics)
- **Line payload:** `{"value": <float>}`
- **Read with:** `… | json | unwrap value` then `avg_over_time`/`max_over_time`/`topk`.
- **Note:** point‑in‑time gauges; an `unwrap … [24h]` over 112 devices is the
  heaviest query in the system (~10s+), so keep ranges reasonable.

### 2.2 Monitoring alarms — `{source=solarwinds|manageengine, …}`
- **Selector:** `{source=~"solarwinds|manageengine", category, device_id, model, severity}`
- **Labels:** `source`, `category`, `device_id`, `model`, `severity`, `service_name`
- **Series:** ~676 (333 SolarWinds + 343 ManageEngine)
- **Line payload:** `{"alert_id": "AL-#####", "status": "open" | "resolved", "message": "…"}`
- **Volume:** high — ~220k lines/24h (critical ~25k / warning ~68k / info ~127k).
- **Role:** the raw symptom stream; the precursor "spans" in a trace.

### 2.3 AI diagnosis stream — `{source=ai-agent, agent=…}`
- **Selector:** `{source="ai-agent", agent="incident|rca|recommendation|anomaly|summary", incident_type, severity}`
- **Labels:** `source`, `agent`, `incident_type`, `severity`, `service_name`
- **Series:** ~36. **No `device_id` label** — the device lives inside the payload
  (`affected_assets`), so incident↔device correlation is by **line content**, not a
  shared label.
- **Keyed by `incident_id`** across all five `agent` stages (all emitted together).
- **Per‑agent payload:**

| `agent` | Payload keys (metadata) |
|---|---|
| `incident` | `incident_id, type, source, severity, incident, summary, root_cause, confidence, recommendation[], affected_assets[], early_warning` |
| `rca` | `incident_id, root_cause, rca_summary, confidence, affected_assets[], affected_assets_text, evidence[]` |
| `recommendation` | `incident_id, recommendation[], recommendation_text, escalation_team, automatable, severity, timestamp` |
| `anomaly` | `incident_id, early_warning, kind, risk, warning, asset, observed, threshold, timestamp` |
| `summary` | `incident_id, incident, summary, severity, type, timestamp` |

### 2.4 Legacy host syslog — `{job=system}`
- **Selector:** `{job="system", filename="/var/log/…"}`
- **Labels:** `job="system"`, `filename`, `service_name="system"`
- **Series:** 6 (one per log file). **Line payload:** plain syslog **text** (not JSON).
- **Files:** `auth.log` (SSH brute‑force → Security panel), `kern.log`,
  `dpkg.log`, `alternatives.log`, `cloud-init.log`, `cloud-init-output.log`.
- **Structured fields** (IP, user, process) are extracted via `regexp` at query time.

### 2.5 Probe / test — `{app=postman}`
- **Labels:** `app="postman"`, `environment="dev"`, `service_name="postman"`.
- **Series:** 1. A synthetic/probe stream; not used by the app. Excluded from NOC views.

---

## 3. Label catalog

| Label | Cardinality | Values (or shape) | Appears on | Meaning |
|---|---|---|---|---|
| `service_name` | 3 | `unknown_service`, `system`, `postman` | **all** | Promtail service tag; mostly `unknown_service`. |
| `source` | 3 | `solarwinds`, `manageengine`, `ai-agent` | alarms, AI | Producer of the line. |
| `severity` | 4 | `critical`, `high`, `warning`, `info` | alarms, AI | Severity. (`high` is used mainly by AI incidents.) |
| `category` | 9 | network(49), security(42), server(6), application(5), wireless(5), platform(2), storage(2), cloud(1), physical(1) | alarms | Device class. **1 device is missing this label** (see §6). |
| `device_id` | ~113 | `RTR-…`, `SW-…`, `FW-…`, `SRV-…`, `VPN-…`, `WLC-…`, `AP-…`, `NAC-…`, `PFM-…`, `APP-…`, `CLOUD-…` | alarms, metrics | The asset. Naming = `ROLE-SITE-MODEL-NN` (site e.g. `DC1-MUM`, `BR-xxx`, `ATM-SITE`). |
| `model` | ~47 | `IPSec VPN Tunnel`, `Cisco Catalyst C9300`, `FortiGate 601E`, `VMware AD/DNS Server`, … | alarms | Vendor/model of the device. |
| `metric` | 3 | `cpu_utilization_percent`, `interface_utilization_percent`, `latency_ms` | metrics | Which performance metric the value is. |
| `agent` | 5 | `incident`, `rca`, `recommendation`, `anomaly`, `summary` | AI | Which AI pipeline stage produced the line. |
| `incident_type` | 3 | `network`, `security`, `unknown` | AI | NOC (network) vs SOC (security) classification. |
| `job` | 1 | `system` | syslog | Promtail job for host logs. |
| `filename` | 6 | `/var/log/{auth,kern,dpkg,alternatives,cloud-init,cloud-init-output}.log` | syslog | Source log file. |
| `app` | 1 | `postman` | probe | Probe/test stream only. |
| `environment` | 1 | `dev` | probe | Probe/test stream only. |

In‑payload (NOT labels, parsed at query time): `value` (metrics); `alert_id`,
`status` (`open`/`resolved`), `message` (alarms); `incident_id`, `root_cause`,
`recommendation`, `evidence`, `affected_assets`, `confidence`, `escalation_team`,
`automatable`, `observed`, `threshold` (AI).

---

## 4. Label relationships (co-occurrence)

`source` (or `metric`/`job`/`app`) is the **discriminator** — it determines which
other labels are present:

```
source=ai-agent                → agent · incident_type · severity            (NO device_id)
source∈{solarwinds,manageengine} → category · device_id · model · severity
metric=…                        → device_id                                  (NO source/category)
job=system                      → filename
app=postman                     → environment
```

- `device_id` is the **join key** between the **metric** family and the **alarm**
  family (same device appears in both). It is *absent* from the AI stream.
- `incident_id` is the **join key** within the AI stream (links incident→rca→
  recommendation→anomaly→summary) and the **correlation key** to a device (via the
  `affected_assets` payload, not a label).
- `category` ↔ `model`: each `category` contains a set of `model`s (e.g.
  `network` → Cisco Catalyst/ISR/FortiGate; `server` → Exchange/VMware).
- `severity` is shared across alarms and AI but `high` is effectively AI‑only.

---

## 5. How the app consumes each family

The canonical functions in `services/agents-py/app/loki/noc.py` are the only place
LogQL is written; the dashboard, Traces page, and chat all call them.

| Family / label | Functions | Surfaces |
|---|---|---|
| `category` + `device_id` (alarms) | `device_inventory`, `events_by_category` | Device‑availability donut, Alarms‑by‑category |
| `severity` (alarms) | `alarms_by_severity`, `alarm_trend`, `top_alarms` | KPI counts, Alarm‑volume trend, Top‑critical‑alarms |
| `metric` + `device_id` | `top_devices_by_metric`, `metric_trend`, `device_health` | Top CPU / WAN / latency, device drawer/trend |
| `agent`/`incident_type`/`incident_id` | `incidents`, `incident_detail`, `early_warnings`, `recent_incident_traces`, `incident_trace` | Incident summary, diagnosis drawer, **Traces** waterfall |
| `job=system` (`auth.log`) | `security_events` | Security posture / SSH brute‑force |

---

## 6. Query patterns & gotchas

- **Metrics need `unwrap`:** `sum/avg/topk … (avg_over_time({metric=…} | json | unwrap value [range]))`. Plain `count_over_time` counts lines, not the value.
- **OR within one label:** Loki ANDs matchers, so use a regex alternation — `{device_id=~"a|b"}`, never two `device_id="…"` matchers.
- **Incident ↔ device correlation:** the AI stream has no `device_id` label; correlate by line content: `{source="ai-agent"} |= "INC-…"` to get `affected_assets`, then `{source=~"solarwinds|manageengine", device_id="…"}` for that device's events. (See [INVESTIGATION] below.)
- **Time‑bounded label discovery:** Loki's `/labels` & `/label/{n}/values` only return values seen in the queried window; the app uses a wide `loki_label_window` (30d) so every value (all devices) shows up.
- **Batched freshness:** metric/alarm data can be hours old (see §1) — query ≥24h to keep it in‑window.
- **`status` field:** alarms carry `open` / `resolved` (some empty) in the payload, not as a label.
- **Heavy query:** `top_devices_by_metric` over 24h × 112 devices is the slowest (~10s+); the service `loki_timeout` must exceed it under parallel dashboard load.

[INVESTIGATION] One‑query unified pull for an incident + its device:
```logql
{source=~"ai-agent|solarwinds|manageengine"} |~ `INC-88d49c6dee|VPN-DC1-MUM-04`
```

---

## 7. Snapshot totals (30d window)

- Active series: **~1,055** — alarms ~676, metrics ~336, AI ~36, syslog 6, probe 1.
- Devices: **~113** across 9 categories; **112** report performance metrics.
- Alarm volume: ~220k/24h. AI incidents: low volume (critical/high are the
  "major" ones traced in real time).
