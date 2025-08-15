## Cloudflare Worker Spec: Logging Webhook → BigQuery

This document defines the Cloudflare Worker endpoint that receives logging events from the producer service and forwards them to BigQuery.

### Endpoint
- **Method**: POST
- **Path**: `/` (root) or `/ingest` (choose one and keep consistent)
- **Content-Type**: `application/json; charset=utf-8`
- **Auth**: Optional HMAC signature `X-Signature: sha256=<hex>` over the raw request body using `WEBHOOK_SECRET`

### Expected request body
See `README.md` for the full event schema. All events include:
- `schema_version` INT
- `source` STRING
- `timestamp` ISO-8601 UTC
- `level` STRING
- `logger` STRING
- `message` STRING
- `exc_info` STRING | null
- `extra` OBJECT (contains event-specific fields)

### Validation
1) `Content-Type` must include `application/json`
2) Parse JSON body
3) Validate required top-level fields exist and have expected types
4) If `WEBHOOK_SECRET` exists, compute HMAC-SHA256 over the raw body and compare against `X-Signature` using constant-time comparison
5) On failure, return `400` or `401` with a short error code; never echo the raw payload

### BigQuery load
Preferred approach is the BigQuery `tabledata.insertAll` API with a service account.

Row mapping:
```json
{
  "json": {
    "schema_version": <number>,
    "source": <string>,
    "timestamp": <string>,
    "level": <string>,
    "logger": <string>,
    "message": <string>,
    "exc_info": <string|null>,
    "extra": <object>
  },
  "insertId": <string> // optional but recommended
}
```

`insertId` recommendation: use `extra.request_id` when present; otherwise compute a hash of the raw body.

### Environment variables
- `WEBHOOK_SECRET` (optional): HMAC secret for signature verification
- `BIGQUERY_PROJECT_ID`: GCP project id
- `BIGQUERY_DATASET`: BigQuery dataset name
- `BIGQUERY_TABLE`: BigQuery table name
- `GCP_CLIENT_EMAIL`: Service account client email
- `GCP_PRIVATE_KEY`: Service account private key (PEM). Encode newlines as `\n` in Workers Secrets

### Worker outline (TypeScript)
```ts
export interface Env {
  WEBHOOK_SECRET?: string;
  BIGQUERY_PROJECT_ID: string;
  BIGQUERY_DATASET: string;
  BIGQUERY_TABLE: string;
  GCP_CLIENT_EMAIL: string;
  GCP_PRIVATE_KEY: string; // with \n newlines
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

    const contentType = request.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('application/json')) {
      return new Response('Unsupported Media Type', { status: 415 });
    }

    const rawBody = await request.arrayBuffer();
    const bodyText = new TextDecoder().decode(rawBody);

    // Optional HMAC verification
    if (env.WEBHOOK_SECRET) {
      const given = request.headers.get('x-signature') || '';
      const expected = await hmacSha256Hex(env.WEBHOOK_SECRET, rawBody);
      if (!safeCompare(given, `sha256=${expected}`)) {
        return new Response('Unauthorized', { status: 401 });
      }
    }

    let payload: any;
    try {
      payload = JSON.parse(bodyText);
    } catch {
      return new Response('Bad Request', { status: 400 });
    }

    // Minimal schema validation
    const required = ['schema_version', 'source', 'timestamp', 'level', 'logger', 'message', 'extra'];
    for (const key of required) {
      if (!(key in payload)) return new Response('Bad Request', { status: 400 });
    }

    const insertId = payload?.extra?.request_id || (await sha256Hex(rawBody));
    const bqResp = await insertIntoBigQuery(env, [{ json: payload, insertId }]);
    if (!bqResp.ok) {
      return new Response('Upstream Error', { status: 502 });
    }

    return new Response('OK', { status: 200 });
  },
};

async function hmacSha256Hex(secret: string, data: ArrayBuffer): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, data);
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let res = 0;
  for (let i = 0; i < a.length; i++) res |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return res === 0;
}

async function insertIntoBigQuery(env: Env, rows: Array<{ json: unknown; insertId?: string }>): Promise<Response> {
  // Use BigQuery streaming insert API; you can call via a GCP fetch with an OAuth token minted from the service account
  // For Workers, implement a minimal JWT-based OAuth 2.0 service account flow (JWT Bearer) and call the REST endpoint.
  // Endpoint: https://bigquery.googleapis.com/bigquery/v2/projects/{projectId}/datasets/{datasetId}/tables/{tableId}/insertAll
  return new Response(null, { status: 200 });
}
```

Note: The example omits the full Google OAuth 2.0 JWT flow. In production, generate an access token using the service account key in the Worker and call the `insertAll` endpoint.

### Responses
- 200 OK: Insert accepted
- 400 Bad Request: Invalid JSON or missing required fields
- 401 Unauthorized: Signature verification failed
- 415 Unsupported Media Type: Wrong content type
- 502 Bad Gateway: BigQuery insert error


