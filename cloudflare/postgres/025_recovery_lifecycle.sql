-- Recovery lifecycle per exception / review item (additive, idempotent).
-- An exception with no row here is implicitly 'identified' with
-- expected_amount = ra_exception_rows.leakage.
CREATE TABLE IF NOT EXISTS ra_recovery_items (
  exception_id       text PRIMARY KEY,
  area               text NOT NULL,
  category           text NOT NULL,
  state              text NOT NULL CHECK (state IN ('identified','claimed','disputed','partially_recovered','recovered','written_off','closed')),
  expected_amount    numeric(18,2) NOT NULL,
  recovered_amount   numeric(18,2) NOT NULL DEFAULT 0,
  written_off_amount numeric(18,2) NOT NULL DEFAULT 0,
  owner              text,
  due_date           date,
  sla_days           integer NOT NULL DEFAULT 30,
  opened_at          timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  closed_at          timestamptz,
  last_actor         text,
  version            integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS ra_recovery_items_state ON ra_recovery_items (state);

CREATE TABLE IF NOT EXISTS ra_recovery_history (
  id              bigserial PRIMARY KEY,
  exception_id    text NOT NULL,
  from_state      text NOT NULL,
  to_state        text NOT NULL,
  amount_delta    numeric(18,2) NOT NULL DEFAULT 0,
  recovered_total numeric(18,2) NOT NULL DEFAULT 0,
  owner           text,
  due_date        date,
  actor           text NOT NULL,
  role            text,
  note            text,
  at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ra_recovery_history_ex ON ra_recovery_history (exception_id, at DESC);

-- One row per book exception with its effective recovery state. Figures are SQL only.
CREATE OR REPLACE VIEW v_ra_recovery_tracker AS
SELECT
  e.area || ':' || e.category || ':' || e.ref_id                       AS exception_id,
  e.area, e.category, e.ref_id, e.merchant_id, e.ts,
  ROUND(e.leakage::numeric, 2)                                         AS potential_amount,
  COALESCE(r.state, 'identified')                                      AS state,
  COALESCE(r.expected_amount, ROUND(e.leakage::numeric, 2))            AS expected_amount,
  COALESCE(r.recovered_amount, 0)                                      AS recovered_amount,
  COALESCE(r.written_off_amount, 0)                                    AS written_off_amount,
  r.owner, r.due_date, r.sla_days, r.opened_at, r.updated_at, r.closed_at, COALESCE(r.version, 0) AS version,
  (r.due_date IS NOT NULL AND r.closed_at IS NULL
     AND COALESCE(r.state,'identified') NOT IN ('recovered','written_off','closed')
     AND r.due_date < CURRENT_DATE)                                    AS overdue
FROM ra_exception_rows e
LEFT JOIN ra_recovery_items r
  ON r.exception_id = e.area || ':' || e.category || ':' || e.ref_id
WHERE e.area NOT IN ('aml','network_risk','kyc','success','interfaces','anomalies','files');
