// Runtime configuration placeholder (BYOC).
//
// This file is served next to index.html and loaded BEFORE the app bundle, so
// it can point the SPA at a customer's self-hosted Supabase without a rebuild.
// In a BYOC container the entrypoint OVERWRITES this file with the customer's
// values (SUPABASE_URL / SUPABASE_ANON_KEY). Left empty here it is a no-op:
// the app falls back to the hosted Prometheux defaults
// (see src/shared/integrations/supabase/client.ts).
window.__PMTX_CONFIG__ = window.__PMTX_CONFIG__ || {};
