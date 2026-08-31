# Supabase database workflow

FrameOS has a versioned Supabase/Postgres schema in `supabase/migrations` for
its daemon-private runtime data: jobs, agent sessions/runs, approvals, usage,
analysis cache, and searchable analysis segments. Project bundles remain the
lossless canonical JSON format.

## Local development

1. Start Docker Desktop.
2. Run `npm run supabase:start`.
3. Confirm connection details with `npm run supabase:status`.
4. Run `npm run supabase:reset` whenever you need a clean local database; it
   replays every migration.
5. Open local Studio at the URL printed by the status command.

The local direct Postgres URL is normally
`postgresql://postgres:postgres@127.0.0.1:54322/postgres`. Keep it in `.env`
as `FRAMEOS_DATABASE_URL`, never in browser code.

## Hosted Supabase later

Use the server-only pooled connection string from **Connect** in the Supabase
dashboard for Railway, set `FRAMEOS_DATABASE_URL` in Railway's encrypted
environment variables, then run `npx supabase db push --db-url "$FRAMEOS_DATABASE_URL"`
from CI. Do not use the anon key or service-role key for the daemon database
connection.

The migration deliberately places tables in the non-public `frameos` schema and
revokes Data API access. The daemon will use a direct Postgres driver; browser
clients continue to call the authenticated FrameOS API only.
