## Deployment Guide: Cloudflare Worker → BigQuery

### 1) Prerequisites
- Cloudflare account with Workers enabled
- GCP project with BigQuery enabled
- Service account with `roles/bigquery.dataEditor` on dataset `hiring_router_mcp`
- Downloaded JSON key (use as `BIGQUERY_CREDS_JSON` secret)

### 2) BigQuery tables
Edit `PROJECT_ID` and run:
```bash
bq --location=US mk --dataset PROJECT_ID:hiring_router_mcp || true
bq query --use_legacy_sql=false < bigquery/schema.sql
bq query --use_legacy_sql=false < bigquery/schema_test.sql
```

### 3) Local auth to Cloudflare
```bash
npx wrangler login
npx wrangler whoami
```

### 4) Required secrets and vars
Set secrets (recommended: single JSON):
```bash
npx wrangler secret put BIGQUERY_CREDS_JSON
# optional HMAC
npx wrangler secret put WEBHOOK_SECRET
```

Set your GCP project id var:
```bash
# dev (uses table test_events_logging)
npx wrangler deploy --env dev --var BIGQUERY_PROJECT_ID=<your-project-id>
# prod (uses table logging_events)
npx wrangler deploy --env prod --var BIGQUERY_PROJECT_ID=qalearn
```

You can also persist `BIGQUERY_PROJECT_ID` under `[vars]` in `wrangler.toml` instead of passing `--var` each time.

### 5) Verify
Dev URL (after deploy): the URL printed by Wrangler for `--env dev`.
Prod URL: printed by Wrangler after `--env prod` deploy.

Send a test event (dev):
```bash
curl -i -X POST "$DEV_URL" \
  -H "Content-Type: application/json; charset=utf-8" \
  --data-binary @event.json
```

Check BigQuery table `hiring_router_mcp.test_events_logging` for a new row.

### 6) CI/CD (GitHub Actions)
We provide `github-workflows/ci.yml` as a template. Move it to `.github/workflows/ci.yml`.

Required GitHub Secrets:
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN` (Workers deploy perms)
- `BIGQUERY_CREDS_JSON`
- `BIGQUERY_PROJECT_ID`
- optional `WEBHOOK_SECRET`

Flow:
1. Install deps
2. Type-check
3. Deploy to `--env dev`
4. Send a test event to the Worker
5. Query BigQuery for the inserted row (using `insertId` = CI run id) and fail the job if not found
