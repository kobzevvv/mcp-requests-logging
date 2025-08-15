## Logging Webhook: Contract and BigQuery Loading

This repository documents the webhook event format emitted by the producer service and a recommended Cloudflare Worker + BigQuery ingestion path. The Worker runs at your edge, validates the payload/signature, and forwards events to BigQuery.

### TL;DR
- **Format**: JSON over HTTP POST
- **Content-Type**: `application/json; charset=utf-8`
- **Auth**: Optional HMAC SHA-256 signature header `X-Signature: sha256=<hex>` over the raw body using `WEBHOOK_SECRET`
- **Schema stability**: Top-level contract with `schema_version` and `source`; event-specific fields live under `extra`
- **Recommended storage**: BigQuery table with top-level columns and an `extra` JSON column for flexible evolution

### Top-level JSON contract
Top-level fields are stable across all event types. Event-specific fields are nested under `extra`.

```json
{
  "schema_version": 1,
  "source": "hiring_router_mcp",
  "timestamp": "2025-01-15T12:34:56.789Z",
  "level": "INFO",
  "logger": "hiring_router_mcp.server",
  "message": "tool_call",
  "exc_info": null,
  "extra": { }
}
```

Field definitions:
- `schema_version` (integer): Version of this event schema (starts at 1 and increments on breaking changes)
- `source` (string): Logical source/producer identifier (e.g., `hiring_router_mcp`)
- `timestamp` (string): ISO-8601 UTC timestamp
- `level` (string): Log level (e.g., `DEBUG` | `INFO` | `WARNING` | `ERROR`)
- `logger` (string): Logger name (e.g., `hiring_router_mcp.server`)
- `message` (string): Event summary or event kind; mirrors `extra.event`
- `exc_info` (string | null): Present on errors; stack trace as string
- `extra` (object): Event-specific payload (see below)

### Event kinds and `extra` payloads
`extra.event` is one of: `tool_call`, `tool_result`, `tool_error`, `route_hiring_task`.

#### tool_call
```json
{
  "schema_version": 1,
  "source": "hiring_router_mcp",
  "timestamp": "2025-01-15T12:34:56.789Z",
  "level": "INFO",
  "logger": "hiring_router_mcp.server",
  "message": "tool_call",
  "extra": {
    "event": "tool_call",
    "request_id": "7e1a6a66-557a-47a2-9f2d-3a3c2c2f7fd0",
    "client_id": "acme-prod",
    "tool": "functions.codebase_search",
    "arg_keys": ["query", "target_directories", "explanation"]
  }
}
```

#### tool_result
```json
{
  "schema_version": 1,
  "source": "hiring_router_mcp",
  "timestamp": "2025-01-15T12:34:56.900Z",
  "level": "INFO",
  "logger": "hiring_router_mcp.server",
  "message": "tool_result",
  "extra": {
    "event": "tool_result",
    "request_id": "7e1a6a66-557a-47a2-9f2d-3a3c2c2f7fd0",
    "client_id": "acme-prod",
    "tool": "functions.codebase_search",
    "result_type": "object",
    "duration_ms": 142
  }
}
```

#### tool_error
```json
{
  "schema_version": 1,
  "source": "hiring_router_mcp",
  "timestamp": "2025-01-15T12:34:57.012Z",
  "level": "ERROR",
  "logger": "hiring_router_mcp.server",
  "message": "tool_error",
  "exc_info": "Traceback (most recent call last): ...",
  "extra": {
    "event": "tool_error",
    "request_id": "7e1a6a66-557a-47a2-9f2d-3a3c2c2f7fd0",
    "client_id": "acme-prod",
    "tool": "functions.codebase_search",
    "duration_ms": 95
  }
}
```

#### route_hiring_task
```json
{
  "schema_version": 1,
  "source": "hiring_router_mcp",
  "timestamp": "2025-01-15T12:35:10.101Z",
  "level": "INFO",
  "logger": "hiring_router_mcp.server",
  "message": "route_hiring_task",
  "extra": {
    "event": "route_hiring_task",
    "user_type": "recruiter",
    "user_hash": "1d3a8bb2d27f5b9c2b8b8a54c3e9b9c5c8f0c1d2e3f4a5b6c7d8e9f0a1b2c3d4",
    "description_length": 274,
    "context_keys": ["role", "years_experience", "location"],
    "routed_to": "functions.codebase_search"
  }
}
```

Notes:
- `user_hash` is the SHA-256 of a user identifier when available; raw identifiers are never sent.
- `client_id` may be `null` when not configured by the producer.

### Security: HMAC signature
If the producer configures a secret, each request includes an `X-Signature` header:

```
X-Signature: sha256=<hex>
```

Computation:
1) Take the raw HTTP request body (exact bytes)
2) Compute HMAC-SHA256 with secret `WEBHOOK_SECRET`
3) Hex-encode the digest and prefix with `sha256=`
4) Compare using a constant-time comparison

If `WEBHOOK_SECRET` is not provided, signature verification can be skipped.

### BigQuery schema (recommended)
Use top-level columns for stable fields and store `extra` as JSON to avoid schema churn.

- `schema_version` INT64
- `source` STRING
- `timestamp` TIMESTAMP
- `level` STRING
- `logger` STRING
- `message` STRING
- `exc_info` STRING (nullable)
- `extra` JSON

Example StandardSQL DDL:
```sql
CREATE TABLE `project_id.dataset_id.logging_events` (
  schema_version INT64,
  source STRING,
  timestamp TIMESTAMP,
  level STRING,
  logger STRING,
  message STRING,
  exc_info STRING,
  extra JSON
);
```

Row identity / deduplication:
- Use `insertId` when loading via the BigQuery `insertAll` API. A good value is `request_id` when present, otherwise a hash of the raw body.

### Producer → Worker → BigQuery flow
1) Producer POSTs JSON payload to the Worker
2) Worker verifies `Content-Type` and optional `X-Signature`
3) Worker forwards to BigQuery (recommended: `tabledata.insertAll`)
4) Worker replies 2xx as soon as the insert request is accepted; on validation/signature failure, return 400/401

### Environment variables (ingestion Worker)
- `WEBHOOK_SECRET` (optional): HMAC secret for signature verification
- `BIGQUERY_PROJECT_ID`: Target GCP project
- `BIGQUERY_DATASET`: Target dataset
- `BIGQUERY_TABLE`: Target table
- `GCP_CLIENT_EMAIL`: Service account client email
- `GCP_PRIVATE_KEY`: Service account private key (PEM). Maintain newlines as `\n` if stored in a single-line secret

### cURL example
```bash
curl -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json; charset=utf-8" \
  -H "X-Signature: sha256=$SIGNATURE_HEX" \
  --data-binary @event.json
```

### Versioning
- Current `schema_version`: 1
- Breaking changes will increment `schema_version` and be documented in this README

### Privacy
- No raw user identifiers are sent; `user_hash` is a SHA-256 hash when a user_id exists
- Only key names of arbitrary dictionaries are logged (`arg_keys`, `context_keys`), never raw values


