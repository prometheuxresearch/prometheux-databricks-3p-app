const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

// Databricks Apps runtime env (server-side only - never sent to browser)
const DATABRICKS_HOST = process.env.DATABRICKS_HOST || '';
const DATABRICKS_CLIENT_ID = process.env.DATABRICKS_CLIENT_ID || '';
const DATABRICKS_CLIENT_SECRET = process.env.DATABRICKS_CLIENT_SECRET || '';
const DATABRICKS_APP_NAME = process.env.DATABRICKS_APP_NAME || '';
const DATABRICKS_WORKSPACE_ID = process.env.DATABRICKS_WORKSPACE_ID || '';

// Supabase Edge Functions base URL (public; not a secret)
// Used by /api/prometheux-sso to proxy zero-click login requests.
const SUPABASE_FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL || '';

// Build the workspace URL with https:// prefix (DATABRICKS_HOST may come without scheme)
function workspaceUrl() {
  if (!DATABRICKS_HOST) return '';
  if (DATABRICKS_HOST.startsWith('http://') || DATABRICKS_HOST.startsWith('https://')) {
    return DATABRICKS_HOST.replace(/\/$/, '');
  }
  return `https://${DATABRICKS_HOST}`.replace(/\/$/, '');
}

// Log env keys at startup (names only, never values)
const dbEnvKeys = Object.keys(process.env).filter((k) => k.startsWith('DATABRICKS_'));
console.log('Databricks env keys present:', dbEnvKeys);

// ─────────────────────────────────────────────────────────────────────────
// OAuth M2M token cache for the app's service principal
// ─────────────────────────────────────────────────────────────────────────
// We mint a short-lived bearer token using DATABRICKS_CLIENT_ID +
// DATABRICKS_CLIENT_SECRET via the OIDC client_credentials flow, cache it
// server-side, and only return the resulting bearer token to the browser.
// The secret never leaves the Apps pod.

let cachedToken = null;
let cachedExpiresAtMs = 0;
let inflightMintPromise = null;
const REFRESH_SAFETY_MARGIN_MS = 5 * 60 * 1000; // refresh 5 min before expiry

async function mintAppToken() {
  if (!DATABRICKS_HOST || !DATABRICKS_CLIENT_ID || !DATABRICKS_CLIENT_SECRET) {
    throw new Error('App service principal credentials not available in env');
  }

  const url = `${workspaceUrl()}/oidc/v1/token`;
  const credentials = Buffer.from(
    `${DATABRICKS_CLIENT_ID}:${DATABRICKS_CLIENT_SECRET}`
  ).toString('base64');

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: 'all-apis',
  });

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`OAuth token mint failed (${resp.status}): ${text}`);
  }

  const json = await resp.json();
  const expiresInMs = (json.expires_in || 3600) * 1000;
  cachedToken = json.access_token;
  cachedExpiresAtMs = Date.now() + expiresInMs;
  console.log(
    `[app-token] minted, expires in ${Math.round(expiresInMs / 1000)}s`
  );
  return cachedToken;
}

async function getAppToken() {
  const now = Date.now();
  if (cachedToken && cachedExpiresAtMs - now > REFRESH_SAFETY_MARGIN_MS) {
    return cachedToken;
  }
  if (inflightMintPromise) {
    return inflightMintPromise;
  }
  inflightMintPromise = mintAppToken().finally(() => {
    inflightMintPromise = null;
  });
  return inflightMintPromise;
}

// ─────────────────────────────────────────────────────────────────────────
// Service principal SCIM identity (cached for the lifetime of the pod)
// ─────────────────────────────────────────────────────────────────────────
// SCIM /Me on the workspace returns the SP's `userName` (e.g. "app-5ctusr")
// and `displayName` (e.g. "prometheux"). These don't change after the app
// is provisioned, so we look them up once and cache them.
let cachedPrincipalIdentity = null;
let inflightPrincipalLookup = null;

async function fetchPrincipalIdentity() {
  const token = await getAppToken();
  const resp = await fetch(`${workspaceUrl()}/api/2.0/preview/scim/v2/Me`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/scim+json',
    },
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`SCIM /Me failed (${resp.status}): ${text}`);
  }
  const me = await resp.json();
  return {
    userName: me.userName || null,
    displayName: me.displayName || null,
  };
}

async function getPrincipalIdentity() {
  if (cachedPrincipalIdentity) return cachedPrincipalIdentity;
  if (inflightPrincipalLookup) return inflightPrincipalLookup;
  inflightPrincipalLookup = fetchPrincipalIdentity()
    .then((id) => {
      cachedPrincipalIdentity = id;
      console.log(`[principal] resolved userName=${id.userName}`);
      return id;
    })
    .finally(() => {
      inflightPrincipalLookup = null;
    });
  return inflightPrincipalLookup;
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────
// Defense-in-depth: only return tokens for requests originating from the
// app's own origin. The Databricks Apps proxy already authenticates the
// user, so this just blocks accidental cross-origin calls.
function isSameOrigin(req) {
  const referer = req.headers.referer || '';
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  if (!referer || !host) return false;
  try {
    const u = new URL(referer);
    return u.host === host;
  } catch (_) {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// /api/app-context — autofill data for the React app (3P mode only)
// ─────────────────────────────────────────────────────────────────────────
// Returns workspace URL, app SP client ID, user identity headers, and a
// freshly-minted short-lived bearer token. The frontend uses this to
// pre-fill the Databricks config so users never type credentials.
app.get('/api/app-context', async (req, res) => {
  if (!isSameOrigin(req)) {
    return res.status(403).json({ error: 'cross-origin requests not allowed' });
  }

  try {
    const token = await getAppToken();
    let principal = { userName: null, displayName: null };
    try {
      principal = await getPrincipalIdentity();
    } catch (err) {
      console.warn('[app-context] principal lookup failed:', err.message);
    }
    res.set('Cache-Control', 'no-store');
    res.json({
      mode: 'databricks_3p',
      workspaceUrl: workspaceUrl(),
      clientId: DATABRICKS_CLIENT_ID,
      appName: DATABRICKS_APP_NAME,
      workspaceId: DATABRICKS_WORKSPACE_ID,
      principalUserName: principal.userName,
      principalDisplayName: principal.displayName,
      user: {
        email: req.headers['x-forwarded-email'] || null,
        userId: req.headers['x-forwarded-user'] || null,
        username: req.headers['x-forwarded-preferred-username'] || null,
      },
      auth: {
        mode: 'token',
        token,
        expiresAt: cachedExpiresAtMs,
      },
    });
  } catch (err) {
    console.error('[app-context] failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// /api/prometheux-sso — zero-click login bridge to Supabase
// ─────────────────────────────────────────────────────────────────────────
// The browser hits this endpoint at AuthProvider mount (3P mode only).
// We mint a fresh app-principal token and forward it (plus the Databricks
// proxy-injected user identity headers) to the `databricks-sso` Supabase
// Edge Function, which:
//   - validates the SP token via SCIM /Me,
//   - upserts the Supabase user / profile / Platform application request,
//   - returns a session pair { access_token, refresh_token } to the browser.
// SUPABASE_SERVICE_ROLE_KEY never lives in this pod — it lives in the EF.
app.post('/api/prometheux-sso', async (req, res) => {
  if (!isSameOrigin(req)) {
    return res.status(403).json({ error: 'cross-origin requests not allowed' });
  }
  if (!SUPABASE_FUNCTIONS_URL) {
    return res.status(500).json({ error: 'sso_not_configured' });
  }

  const userEmail = req.headers['x-forwarded-email'];
  if (!userEmail) {
    return res.status(401).json({ error: 'no_user_identity' });
  }

  try {
    const spToken = await getAppToken();
    const ssoResp = await fetch(`${SUPABASE_FUNCTIONS_URL}/databricks-sso`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${spToken}`,
        'X-Databricks-Workspace-Url':      workspaceUrl(),
        'X-Databricks-Workspace-Id':       DATABRICKS_WORKSPACE_ID || '',
        'X-Databricks-User-Email':         userEmail,
        'X-Databricks-User-Id':            req.headers['x-forwarded-user'] || '',
        'X-Databricks-Preferred-Username': req.headers['x-forwarded-preferred-username'] || '',
        'X-Databricks-Sp-Client-Id':       DATABRICKS_CLIENT_ID || '',
      },
    });

    const text = await ssoResp.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { error: 'bad_edge_response', raw: text }; }

    res.status(ssoResp.status).set('Cache-Control', 'no-store').json(body);
  } catch (err) {
    console.error('[prometheux-sso] failed:', err.message);
    res.status(500).json({ error: 'sso_proxy_failed', message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Static frontend
// ─────────────────────────────────────────────────────────────────────────
app.use(express.static('frontend'));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Frontend server running on http://0.0.0.0:${PORT}`);
});
