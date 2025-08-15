## BigQuery Setup

### Dataset
- Name: `hiring_router_mcp`

### Table
- Recommended name: `logging_events`
- Partitioning: by date of `timestamp`
- Clustering: `source, level`

### DDL
Edit `schema.sql` and replace `PROJECT_ID` with your project id, then run:

```bash
bq --location=US mk --dataset PROJECT_ID:hiring_router_mcp || true
bq query --use_legacy_sql=false < bigquery/schema.sql
```

### Service account permissions
Grant the service account used by the Worker these roles (minimum):
- `roles/bigquery.dataEditor` on dataset `hiring_router_mcp`

Optional (if you plan to run query jobs from the Worker):
- `roles/bigquery.jobUser` at the project level

### OAuth scope (Worker → BigQuery)
- `https://www.googleapis.com/auth/bigquery.insertdata` (for streaming inserts)

### Insert strategy
- Use `tabledata.insertAll` with `insertId = extra.request_id` when present, or a SHA-256 of the raw body.


