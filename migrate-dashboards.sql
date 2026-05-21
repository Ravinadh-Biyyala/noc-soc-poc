CREATE TABLE IF NOT EXISTS user_dashboards (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  flat_table_name TEXT NOT NULL UNIQUE,
  source_dataset_ids JSONB NOT NULL DEFAULT '[]',
  row_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ready',
  agent_log TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dashboard_charts (
  id SERIAL PRIMARY KEY,
  dashboard_id INTEGER NOT NULL REFERENCES user_dashboards(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  chart_type TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dashboard_charts_dashboard_id ON dashboard_charts(dashboard_id);
