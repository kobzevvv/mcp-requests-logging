export interface Env {
  WEBHOOK_SECRET?: string;
  BIGQUERY_PROJECT_ID: string;
  BIGQUERY_DATASET: string;
  BIGQUERY_TABLE: string;
  // Choose one credential style:
  // 1) Single JSON secret containing the full service account key
  BIGQUERY_CREDS_JSON?: string;
  // 2) Separate fields
  GCP_CLIENT_EMAIL?: string;
  GCP_PRIVATE_KEY?: string; // with \n newlines
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

    const contentType = request.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('application/json')) {
      return new Response('Unsupported Media Type', { status: 415 });
    }

    const rawBody = await request.arrayBuffer();
    const bodyText = new TextDecoder().decode(rawBody);

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

    const required = ['schema_version', 'source', 'timestamp', 'level', 'logger', 'message', 'extra'];
    for (const key of required) {
      if (!(key in payload)) return new Response('Bad Request', { status: 400 });
    }

    const insertId = payload?.extra?.request_id || (await sha256Hex(rawBody));
    const insertResult = await insertIntoBigQuery(env, payload, insertId);
    if (!insertResult.ok) {
      const message = insertResult.error ? `Upstream Error: ${insertResult.error}` : 'Upstream Error';
      return new Response(message, { status: 502 });
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

async function insertIntoBigQuery(env: Env, row: unknown, insertId?: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const accessToken = await getServiceAccountAccessToken(env);
    const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(env.BIGQUERY_PROJECT_ID)}/datasets/${encodeURIComponent(env.BIGQUERY_DATASET)}/tables/${encodeURIComponent(env.BIGQUERY_TABLE)}/insertAll`;
    const body = JSON.stringify({ rows: [{ json: row, insertId }] });
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body
    });
    if (!resp.ok) {
      const text = await resp.text();
      console.error('BigQuery HTTP error', resp.status, text);
      return { ok: false, error: `BigQuery HTTP ${resp.status}: ${text}` };
    }
    const data: any = await resp.json();
    if (data.insertErrors) {
      const details = JSON.stringify(data.insertErrors);
      console.error('BigQuery insertErrors', details);
      return { ok: false, error: details };
    }
    return { ok: true };
  } catch (e: any) {
    const msg = e?.message || String(e);
    console.error('BigQuery insert exception', msg);
    return { ok: false, error: msg };
  }
}

async function getServiceAccountAccessToken(env: Env): Promise<string> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const scope = 'https://www.googleapis.com/auth/bigquery.insertdata';

  let clientEmail: string | undefined;
  let privateKey: string | undefined;

  if (env.BIGQUERY_CREDS_JSON) {
    try {
      const parsed = JSON.parse(env.BIGQUERY_CREDS_JSON);
      clientEmail = parsed.client_email as string | undefined;
      privateKey = parsed.private_key as string | undefined;
    } catch {
      throw new Error('invalid BIGQUERY_CREDS_JSON');
    }
  } else {
    clientEmail = env.GCP_CLIENT_EMAIL;
    privateKey = env.GCP_PRIVATE_KEY;
  }

  if (!clientEmail || !privateKey) {
    throw new Error('missing GCP credentials');
  }

  const claim = base64UrlEncode(JSON.stringify({
    iss: clientEmail,
    sub: clientEmail,
    aud: 'https://oauth2.googleapis.com/token',
    iat: nowSeconds,
    exp: nowSeconds + 3600,
    scope
  }));
  const input = `${header}.${claim}`;
  const signature = await signWithPrivateKey(privateKey, input);
  const jwt = `${input}.${signature}`;

  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });
  if (!tokenResp.ok) throw new Error('token exchange failed');
  const json: any = await tokenResp.json();
  return json.access_token as string;
}

function base64UrlEncode(input: string | ArrayBuffer): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
  let str = '';
  for (const byte of bytes) {
    str += String.fromCharCode(byte);
  }
  // @ts-ignore btoa is available in Workers
  const b64 = btoa(str);
  return b64.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function signWithPrivateKey(pem: string, input: string): Promise<string> {
  // Normalize \n in PEM supplied via secrets
  const normalizedPem = pem.replace(/\\n/g, '\n');
  const pemHeader = '-----BEGIN PRIVATE KEY-----';
  const pemFooter = '-----END PRIVATE KEY-----';
  const start = normalizedPem.indexOf(pemHeader);
  const end = normalizedPem.indexOf(pemFooter);
  if (start === -1 || end === -1) throw new Error('invalid PEM');
  const base64 = normalizedPem.substring(start + pemHeader.length, end).replace(/\s+/g, '');
  // @ts-ignore atob is available in Workers
  const der = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    'pkcs8',
    der.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(input));
  return base64UrlEncode(signature);
}


