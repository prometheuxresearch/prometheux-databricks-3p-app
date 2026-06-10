# External network egress

This document lists every external host the Prometheux Databricks App contacts at
runtime, with the purpose and traffic direction. It is intended for:

- **Databricks Marketplace security reviewers** auditing the listing.
- **Customer workspace admins** allowlisting the app in workspaces with a
  Serverless Egress Gateway (SEG) policy or restrictive network rules.

> Last updated alongside each app release. The list is exhaustive at the time of
> release; any future addition will be reflected here and in the matching
> Marketplace listing field "External APIs & Egress".

## Required egress

| # | Host / pattern | Direction | Purpose | Provider | Data sent |
|---|---|---|---|---|---|
| 1 | `<workspace>.cloud.databricks.com`<br>`<workspace>.azuredatabricks.net`<br>`<workspace>.gcp.databricks.com` | Outbound HTTPS | Workspace API calls: SCIM (`/api/2.0/preview/scim/v2/Me`), Clusters API (`/api/2.0/clusters/*`), Libraries API (`/api/2.0/libraries/*`), Jobs API (`/api/2.1/jobs/*`), and OIDC token endpoint (`/oidc/v1/token`) | Customer (same workspace the app runs in) | App Service Principal OAuth credentials (auto-injected by Databricks Apps), Bearer token, cluster configuration |
| 2 | `auth.prometheux.ai` | Outbound HTTPS | Prometheux authentication backend. Hosts the zero-click SSO bridge (`/functions/v1/databricks-sso`) and standard auth REST endpoints (`/auth/v1/token`, `/auth/v1/user`, etc.) for user account management. | Prometheux Research Ltd | User identity headers forwarded by Databricks Apps (email, username, user id, workspace id, workspace URL), App SP token (used by the SSO bridge to validate the workspace identity against SCIM) |
| 3 | `api.prometheux.ai` | Outbound HTTPS | Prometheux Cloud reasoning backend. All Vadalog reasoning, ontology management, knowledge graph queries, and agentic workflows execute here. | Prometheux Research Ltd | User-authored queries, ontology definitions, references to Unity Catalog tables (catalog/schema/table names — not data; data is fetched by the engine using the user-provided Databricks credentials and never persisted) |

## Hosts NOT contacted

For completeness, the following common third-party services **are not** contacted
by this app. Each was either never used, or was removed in the v1.0.1 hardening
pass following the Marketplace security review:

- **PostHog / `*.posthog.com`** — the SDK (`posthog-js`, `posthog-js/react`) is
  fully tree-shaken from the 3P bundle by a Vite resolve alias that swaps the
  service module for a no-op stub whenever `VITE_PUBLIC_POSTHOG_KEY` is not set.
  No analytics, no session replay, no telemetry of any kind ships.
- **Lovable AI / `cdn.gpteng.co`** — the editor-only `gptengineer.js` script
  tag was removed from `index.html`.
- **dotLottie / `unpkg.com`** — the `<dotlottie-player>` custom element is now
  installed locally as `@dotlottie/player-component` and registered from
  `src/main.tsx`. No CDN request at runtime.
- **`flagcdn.com`** — country flags in the login-activity list are rendered as
  Unicode Regional Indicator Symbols in the 3P build (build-time gate via
  `import.meta.env.VITE_DATABRICKS_3P_MODE`); the CDN URL literal is dropped by
  esbuild dead-code elimination.
- **Google Fonts / `fonts.googleapis.com`** — Inter is shipped locally via
  `@fontsource-variable/inter`. The Deciphera demo dashboard's stylesheet
  previously imported a Google Fonts URL but is unreachable from the live route
  tree (and the import was removed anyway).
- **`authjs.dev`** — the Google "G" icon on the social-login button is now
  inlined as SVG. No remote image request.
- **`calendly.com`** — the "Contact Support" CTA in the onboarding fallback
  page is gated behind a build-time flag and removed from the 3P bundle by DCE.
- **`app.snowflake.com`** — the Snowflake-specific compute-switch overlay is
  gated behind `VITE_SNOWFLAKE_MODE` (not set in the 3P build); the URL literal
  is dropped by DCE.
- No advertising / tracking pixels.
- No CDN-hosted runtime scripts. All JS, CSS, fonts, icons, and Lottie players
  are served from the Databricks App origin itself.
- No external secret store. Credentials come exclusively from
  `DATABRICKS_CLIENT_ID` / `DATABRICKS_CLIENT_SECRET`, both injected by the
  Databricks Apps runtime, never embedded in source.

## Allowlisting these hosts

If your workspace uses a Serverless Egress Gateway (SEG) or any other network
policy that restricts outbound traffic, your workspace **account admin** needs
to add the three hosts above to the policy that applies to Databricks Apps in
this workspace. The two `prometheux.ai` hosts can be added as exact matches; the
workspace host is already implicitly reachable.

See the Databricks documentation on
[Configure network policies for serverless workloads](https://docs.databricks.com/aws/en/security/network/serverless-network-security/serverless-egress-control)
for the relevant UI flow.

## Reporting changes

If you observe outbound traffic from this app to any host not listed above,
please file an issue at <https://github.com/prometheuxresearch/prometheux-databricks-3p-app/issues>
or email <security@prometheux.co.uk>. Prometheux treats undeclared egress as a
security defect.
