// Migrations du schéma. Chaque version est appliquée une seule fois (PRAGMA user_version).
// Ne JAMAIS modifier une migration publiée : ajouter une nouvelle version.

const TS = `created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))`

export const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE assets (
  kind TEXT PRIMARY KEY CHECK (kind IN ('logo','signature','cachet')),
  mime TEXT NOT NULL,
  data BLOB NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE reminder_templates (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email','whatsapp','courrier')),
  tone TEXT NOT NULL CHECK (tone IN ('courtois','ferme','mise_en_demeure')),
  subject TEXT,
  body TEXT NOT NULL,
  requires_legal_review INTEGER NOT NULL DEFAULT 0,
  legal_validated INTEGER NOT NULL DEFAULT 0,
  ${TS},
  deleted_at TEXT
);

CREATE TABLE reminder_scenarios (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE reminder_steps (
  id INTEGER PRIMARY KEY,
  scenario_id INTEGER NOT NULL REFERENCES reminder_scenarios(id),
  position INTEGER NOT NULL,
  offset_days INTEGER NOT NULL,
  channel TEXT NOT NULL,
  template_id INTEGER NOT NULL REFERENCES reminder_templates(id),
  label TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE companies (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  short_name TEXT,
  type TEXT NOT NULL DEFAULT 'petrolier',
  parent_company_id INTEGER REFERENCES companies(id),
  niu TEXT, rccm TEXT, address TEXT, city TEXT, phone TEXT, email TEXT,
  default_currency TEXT NOT NULL DEFAULT 'XAF',
  payment_terms_days INTEGER NOT NULL DEFAULT 60,
  billing_notes TEXT,
  notes TEXT,
  reminder_scenario_id INTEGER REFERENCES reminder_scenarios(id),
  is_demo INTEGER NOT NULL DEFAULT 0,
  ${TS},
  deleted_at TEXT
);
CREATE UNIQUE INDEX ux_companies_name ON companies(name COLLATE NOCASE) WHERE deleted_at IS NULL;

CREATE TABLE contacts (
  id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  role TEXT NOT NULL,
  full_name TEXT NOT NULL,
  job_title TEXT, email TEXT, phone TEXT, whatsapp TEXT, third_party_name TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  ${TS},
  deleted_at TEXT
);
CREATE INDEX ix_contacts_company ON contacts(company_id);

CREATE TABLE conventions (
  id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  reference TEXT NOT NULL,
  title TEXT,
  start_date TEXT NOT NULL,
  end_date TEXT,
  payment_terms_days INTEGER NOT NULL,
  terms_start TEXT NOT NULL DEFAULT 'depot',
  required_documents TEXT NOT NULL DEFAULT '[]',
  billing_format_notes TEXT,
  penalty_type TEXT NOT NULL DEFAULT 'aucune',
  penalty_rate REAL NOT NULL DEFAULT 0,
  penalty_fixed_minor INTEGER NOT NULL DEFAULT 0,
  penalty_grace_days INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'XAF',
  status TEXT NOT NULL DEFAULT 'active',
  is_demo INTEGER NOT NULL DEFAULT 0,
  ${TS},
  deleted_at TEXT
);
CREATE INDEX ix_conventions_company ON conventions(company_id);

-- Bons de prise en charge. AUCUNE donnée médicale : seulement nom/matricule.
CREATE TABLE coverage_vouchers (
  id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  convention_id INTEGER REFERENCES conventions(id),
  number TEXT NOT NULL,
  patient_name TEXT,
  patient_matricule TEXT,
  beneficiary_type TEXT NOT NULL DEFAULT 'salarie',
  subcontractor_name TEXT,
  po_number TEXT,
  issue_date TEXT,
  valid_until TEXT,
  ceiling_minor INTEGER,
  currency TEXT NOT NULL DEFAULT 'XAF',
  status TEXT NOT NULL DEFAULT 'actif',
  is_demo INTEGER NOT NULL DEFAULT 0,
  ${TS},
  deleted_at TEXT
);
CREATE UNIQUE INDEX ux_vouchers ON coverage_vouchers(company_id, number COLLATE NOCASE) WHERE deleted_at IS NULL;

-- Factures et avoirs. Le numéro est unique, corbeille comprise.
CREATE TABLE invoices (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'facture' CHECK (kind IN ('facture','avoir')),
  corrects_invoice_id INTEGER REFERENCES invoices(id),
  company_id INTEGER NOT NULL REFERENCES companies(id),
  convention_id INTEGER REFERENCES conventions(id),
  voucher_id INTEGER REFERENCES coverage_vouchers(id),
  po_number TEXT,
  patient_name TEXT,
  patient_matricule TEXT,
  beneficiary_type TEXT NOT NULL DEFAULT 'salarie',
  subcontractor_name TEXT,
  service_date TEXT,
  issue_date TEXT NOT NULL,
  deposit_date TEXT,
  due_date TEXT NOT NULL,
  due_date_manual INTEGER NOT NULL DEFAULT 0,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL DEFAULT 'XAF',
  workflow_status TEXT NOT NULL DEFAULT 'brouillon',
  status TEXT NOT NULL DEFAULT 'brouillon',
  status_changed_at TEXT,
  paid_minor INTEGER NOT NULL DEFAULT 0,
  credited_minor INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  ${TS},
  deleted_at TEXT
);
CREATE UNIQUE INDEX ux_invoices_number ON invoices(number COLLATE NOCASE);
CREATE INDEX ix_invoices_company_status ON invoices(company_id, status);
CREATE INDEX ix_invoices_status_due ON invoices(status, due_date);
CREATE INDEX ix_invoices_issue ON invoices(issue_date);
CREATE INDEX ix_invoices_voucher ON invoices(voucher_id);
CREATE INDEX ix_invoices_corrects ON invoices(corrects_invoice_id);
CREATE INDEX ix_invoices_patient ON invoices(patient_name, patient_matricule);

CREATE TABLE invoice_events (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  message TEXT NOT NULL,
  details TEXT
);
CREATE INDEX ix_invoice_events ON invoice_events(invoice_id, at);

CREATE TABLE payments (
  id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  received_at TEXT NOT NULL,
  method TEXT NOT NULL,
  reference TEXT,
  bank_name TEXT,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL DEFAULT 'XAF',
  notes TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  ${TS},
  deleted_at TEXT
);
CREATE INDEX ix_payments_company ON payments(company_id, received_at);

CREATE TABLE payment_allocations (
  id INTEGER PRIMARY KEY,
  payment_id INTEGER NOT NULL REFERENCES payments(id),
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  UNIQUE (payment_id, invoice_id)
);
CREATE INDEX ix_alloc_invoice ON payment_allocations(invoice_id);

CREATE TABLE reminder_tasks (
  id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  step_id INTEGER NOT NULL REFERENCES reminder_steps(id),
  planned_for TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'a_envoyer' CHECK (status IN ('a_envoyer','envoyee','reportee','ignoree')),
  postponed_to TEXT,
  done_at TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX ix_tasks_status ON reminder_tasks(status, planned_for);

CREATE TABLE reminder_task_invoices (
  task_id INTEGER NOT NULL REFERENCES reminder_tasks(id) ON DELETE CASCADE,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  PRIMARY KEY (task_id, invoice_id)
);
CREATE INDEX ix_task_invoices_invoice ON reminder_task_invoices(invoice_id);

CREATE TABLE reminders (
  id INTEGER PRIMARY KEY,
  task_id INTEGER REFERENCES reminder_tasks(id),
  company_id INTEGER NOT NULL REFERENCES companies(id),
  contact_id INTEGER REFERENCES contacts(id),
  template_id INTEGER REFERENCES reminder_templates(id),
  channel TEXT NOT NULL,
  tone TEXT,
  delivery TEXT NOT NULL,
  recipient TEXT,
  subject TEXT,
  body TEXT NOT NULL,
  sent_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  is_demo INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX ix_reminders_company ON reminders(company_id, sent_at);

CREATE TABLE reminder_invoices (
  reminder_id INTEGER NOT NULL REFERENCES reminders(id) ON DELETE CASCADE,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  PRIMARY KEY (reminder_id, invoice_id)
);
CREATE INDEX ix_reminder_invoices_invoice ON reminder_invoices(invoice_id);

CREATE TABLE attachments (
  id INTEGER PRIMARY KEY,
  owner_type TEXT NOT NULL,
  owner_id INTEGER NOT NULL,
  category TEXT,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  size INTEGER NOT NULL,
  mime TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);
CREATE INDEX ix_attachments_owner ON attachments(owner_type, owner_id);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  summary TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT
);
CREATE INDEX ix_audit_at ON audit_log(at);

CREATE TABLE import_jobs (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  kind TEXT NOT NULL,
  file_name TEXT NOT NULL,
  rows_ok INTEGER NOT NULL,
  rows_error INTEGER NOT NULL,
  report_json TEXT
);
`
  },
  {
    // V2 : rejets détaillés, bordereaux, journal des échanges et promesses, rapprochement bancaire, contentieux
    version: 2,
    sql: `
ALTER TABLE coverage_vouchers ADD COLUMN notes TEXT;

CREATE TABLE rejections (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  rejected_at TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  reason_text TEXT,
  missing_document TEXT,
  corrective_action TEXT,
  client_contact_id INTEGER REFERENCES contacts(id),
  redeposit_due TEXT,
  redeposited_at TEXT,
  status TEXT NOT NULL DEFAULT 'ouvert' CHECK (status IN ('ouvert','redepose','clos')),
  is_demo INTEGER NOT NULL DEFAULT 0,
  ${TS}
);
CREATE INDEX ix_rejections_invoice ON rejections(invoice_id);
CREATE INDEX ix_rejections_status ON rejections(status, redeposit_due);

-- Reprise des rejets saisis en V1 (historique de la facture)
INSERT INTO rejections (invoice_id, rejected_at, reason_code, reason_text, status, is_demo)
SELECT e.invoice_id,
       COALESCE(json_extract(e.details, '$.date'), substr(e.at, 1, 10)),
       COALESCE(json_extract(e.details, '$.reason_code'), 'autre'),
       json_extract(e.details, '$.reason_text'),
       CASE WHEN i.workflow_status = 'rejetee' THEN 'ouvert' ELSE 'redepose' END,
       i.is_demo
FROM invoice_events e JOIN invoices i ON i.id = e.invoice_id
WHERE e.type = 'rejet';

CREATE TABLE deposit_batches (
  id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  reference TEXT NOT NULL,
  period_start TEXT,
  period_end TEXT,
  deposit_date TEXT NOT NULL,
  deposit_mode TEXT NOT NULL DEFAULT 'main_propre',
  acknowledgment_ref TEXT,
  notes TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  ${TS},
  deleted_at TEXT
);
CREATE TABLE deposit_batch_invoices (
  batch_id INTEGER NOT NULL REFERENCES deposit_batches(id) ON DELETE CASCADE,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  PRIMARY KEY (batch_id, invoice_id)
);
CREATE INDEX ix_batch_invoices_invoice ON deposit_batch_invoices(invoice_id);

CREATE TABLE activities (
  id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  contact_id INTEGER REFERENCES contacts(id),
  type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  summary TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 0,
  ${TS},
  deleted_at TEXT
);
CREATE INDEX ix_activities_company ON activities(company_id, occurred_at);
CREATE TABLE activity_invoices (
  activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  PRIMARY KEY (activity_id, invoice_id)
);
CREATE INDEX ix_activity_invoices_invoice ON activity_invoices(invoice_id);

CREATE TABLE promises (
  id INTEGER PRIMARY KEY,
  activity_id INTEGER NOT NULL REFERENCES activities(id),
  company_id INTEGER NOT NULL REFERENCES companies(id),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL DEFAULT 'XAF',
  promised_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'en_attente',
  paid_since_minor INTEGER NOT NULL DEFAULT 0,
  evaluated_at TEXT,
  acknowledged_at TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  ${TS}
);
CREATE INDEX ix_promises_status ON promises(status, promised_date);

CREATE TABLE bank_statements (
  id INTEGER PRIMARY KEY,
  file_name TEXT NOT NULL,
  bank_name TEXT,
  currency TEXT NOT NULL DEFAULT 'XAF',
  imported_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  is_demo INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE bank_statement_lines (
  id INTEGER PRIMARY KEY,
  statement_id INTEGER NOT NULL REFERENCES bank_statements(id) ON DELETE CASCADE,
  op_date TEXT NOT NULL,
  label TEXT NOT NULL,
  reference TEXT,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'non_rapproche' CHECK (status IN ('non_rapproche','rapproche','ignore')),
  payment_id INTEGER REFERENCES payments(id),
  fingerprint TEXT NOT NULL
);
CREATE INDEX ix_bank_lines_status ON bank_statement_lines(status);
CREATE UNIQUE INDEX ux_bank_lines_fp ON bank_statement_lines(fingerprint);
ALTER TABLE payments ADD COLUMN bank_line_id INTEGER REFERENCES bank_statement_lines(id);

CREATE TABLE litigation_cases (
  id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  reference TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  handler_type TEXT NOT NULL,
  handler_name TEXT,
  handler_contact TEXT,
  procedure TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ouvert',
  closed_at TEXT,
  outcome_notes TEXT,
  notes TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  ${TS},
  deleted_at TEXT
);
CREATE TABLE litigation_invoices (
  case_id INTEGER NOT NULL REFERENCES litigation_cases(id) ON DELETE CASCADE,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  PRIMARY KEY (case_id, invoice_id)
);
CREATE INDEX ix_litigation_invoices_invoice ON litigation_invoices(invoice_id);
CREATE TABLE litigation_steps (
  id INTEGER PRIMARY KEY,
  case_id INTEGER NOT NULL REFERENCES litigation_cases(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  due_date TEXT,
  done_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE litigation_costs (
  id INTEGER PRIMARY KEY,
  case_id INTEGER NOT NULL REFERENCES litigation_cases(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  label TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL DEFAULT 'XAF'
);
`
  },
  {
    // V3 : historique des rapports mensuels, suivi des versions vues (« Quoi de neuf »)
    version: 3,
    sql: `
CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE monthly_reports (
  id INTEGER PRIMARY KEY,
  month TEXT NOT NULL UNIQUE,
  generated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  file_path TEXT,
  auto INTEGER NOT NULL DEFAULT 0,
  emailed_to TEXT,
  comment TEXT,
  kpis_json TEXT NOT NULL
);

-- Base existante (V1/V2) : l'utilisatrice verra les nouveautés de la V3 au prochain démarrage
INSERT OR IGNORE INTO app_meta (key, value) SELECT 'last_seen_version', '1.1.0' WHERE EXISTS (SELECT 1 FROM companies);
`
  }
]
