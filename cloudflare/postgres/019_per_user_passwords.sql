-- Per-user password hashes to replace the shared APP_PASSWORD_HASH.
-- Seed with the existing shared hash for all roles so existing logins keep working.
-- Admin can later update individual hashes via a settings endpoint or direct SQL.

CREATE TABLE IF NOT EXISTS ra_user_passwords (
  user_id text PRIMARY KEY,
  password_hash text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Seed from known users (ids from shared/roles.ts). Use a placeholder; real deploy should copy APP_PASSWORD_HASH.
-- In production, run: UPDATE ra_user_passwords SET password_hash = current_setting('app.password_hash') WHERE password_hash = 'SEED';
INSERT INTO ra_user_passwords (user_id, password_hash)
VALUES
  ('admin@ra.local', 'SEED_FROM_ENV'),
  ('cfo@ra.local', 'SEED_FROM_ENV'),
  ('treasury@ra.local', 'SEED_FROM_ENV'),
  ('recon_ops@ra.local', 'SEED_FROM_ENV'),
  ('auditor@ra.local', 'SEED_FROM_ENV'),
  ('viewer@ra.local', 'SEED_FROM_ENV')
ON CONFLICT (user_id) DO NOTHING;
