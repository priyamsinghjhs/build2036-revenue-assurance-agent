# Always-on Postgres

Neon free-tier compute sleeps after inactivity. That adds cold-start latency on the first request of the day and can time out recon.

## Recommended

Use an always-on Postgres:

- Neon Launch (or Scale) with autosuspend disabled, or
- A small always-on instance (RDS, Cloud SQL, self-hosted) with connection pooling

Set `DATABASE_URL` to the always-on connection string:

```bash
npx wrangler secret put DATABASE_URL
```

## Keep-alive

The daily cron (`15 2 * * *`) and `/healthz` both touch the database. On an always-on instance that is enough. If you stay on a sleeping tier, add a more frequent cron or an external ping to `/healthz` every 5 minutes.

## Indexes

Migration `0037_indexes_and_incremental.sql` adds indexes on:

- merchant_id + date (`ts`) on authorizations, captures, exceptions
- recon area + date on exception rows
- watermark table for incremental daily recon

## Incremental recon

`incrementalRecon.ts` reconciles one day at a time. A day is skipped when its source hash matches the watermark, so prior days are not re-run unless data changed.
