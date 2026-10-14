CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT '',
  phone text NOT NULL UNIQUE CHECK (phone ~ '^254[0-9]{9}$'),
  marketing_consent boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS surveys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key uuid NOT NULL UNIQUE,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  visit_date date NOT NULL,
  client_name text NOT NULL DEFAULT '',
  client_phone text NOT NULL DEFAULT '',
  client_type text NOT NULL CHECK (client_type IN ('new', 'returning')),
  services jsonb NOT NULL DEFAULT '[]'::jsonb,
  service_ratings jsonb NOT NULL DEFAULT '[]'::jsonb,
  overall_rating smallint CHECK (overall_rating BETWEEN 1 AND 5),
  staff_rating smallint CHECK (staff_rating BETWEEN 1 AND 5),
  cleanliness_rating smallint CHECK (cleanliness_rating BETWEEN 1 AND 5),
  wait_time_rating smallint CHECK (wait_time_rating BETWEEN 1 AND 5),
  feedback_type text NOT NULL DEFAULT 'other',
  feedback_text text NOT NULL DEFAULT '',
  recommendation text NOT NULL DEFAULT '',
  improvements text NOT NULL DEFAULT '',
  employee_shoutout text NOT NULL DEFAULT '',
  how_did_you_hear text NOT NULL DEFAULT '',
  marketing_consent boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS loyalty_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  survey_id uuid REFERENCES surveys(id) ON DELETE RESTRICT,
  transaction_type text NOT NULL CHECK (transaction_type IN ('earn', 'redeem', 'adjustment')),
  points integer NOT NULL CHECK (points <> 0),
  reason text NOT NULL,
  visit_date date,
  created_by uuid REFERENCES admins(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS one_loyalty_award_per_customer_visit
  ON loyalty_transactions(customer_id, visit_date)
  WHERE transaction_type = 'earn';
CREATE INDEX IF NOT EXISTS surveys_created_at_idx ON surveys(created_at DESC);
CREATE INDEX IF NOT EXISTS surveys_customer_id_idx ON surveys(customer_id);
CREATE INDEX IF NOT EXISTS loyalty_customer_created_idx ON loyalty_transactions(customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS schema_migrations (
  filename text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
