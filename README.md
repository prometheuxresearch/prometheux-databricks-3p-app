# Prometheux for Databricks

**The Ontology Engine for Enterprise AI — native on Databricks.**

Prometheux turns scattered enterprise data into a reasoning-ready Knowledge Graph that AI agents and analysts can trust. This repository packages Prometheux as a [Databricks App](https://docs.databricks.com/en/dev-tools/databricks-apps/index.html), so your team can install it from the Marketplace (or from this Git repo) and start querying their data semantically in minutes — without leaving Databricks.

Learn more at [prometheux.ai](https://prometheux.ai).

---

## What you can do

- **Define your business semantics.** Capture entities, relationships and rules once, in a Knowledge Graph, instead of re-deriving them in every notebook, dashboard and AI prompt.
- **Process Databricks data with reasoning.** Query Unity Catalog tables (and any source you already use) through Vadalog logical reasoning — explainable, auditable, deterministic.
- **Power AI agents with context.** Give Copilots, RAG pipelines and autonomous agents grounded answers backed by enterprise truth, not guesses.

## Why Prometheux

- **Native to Databricks.** Runs as a first-class Databricks App, authenticates through your workspace identity, and reads data through Unity Catalog.
- **Reasoning, not just retrieval.** Vadalog inference engine derives new facts from existing data using logical rules — a step beyond vector search.
- **Explainable by construction.** Every answer comes with provenance: which rules fired, on which data, in what order.
- **Your data stays in your workspace.** Prometheux only sees the queries you choose to send; raw tables remain in Unity Catalog under your governance.
- **Built for both analysts and engineers.** Conversational UI for analysts, full Vadalog API for engineers and AI builders.
- **Production-grade from day one.** Authentication, audit, multi-tenant isolation and Marketplace-ready packaging.

## Databricks-specific features

- Single sign-on with Databricks identity (zero-click for users with workspace access)
- Service-principal-based access to Unity Catalog tables and Spark clusters
- Auto-provisioning of an organization scoped to your Databricks workspace
- Compatible with AWS, Azure and GCP Databricks workspaces

## How it works

This app installs the Prometheux frontend into your Databricks workspace as a Databricks App. Reasoning runs on Prometheux Cloud, which is updated continuously and requires no redeploy on your side. Authentication is enforced by default and uses your Databricks identity (see [Authentication](#authentication)).

For specialised deployments, contact <support@prometheux.co.uk>.

## Prerequisites

- A Databricks workspace (AWS, Azure or GCP)
- Workspace admin (or `CAN_MANAGE` on Apps) for the initial install
- For the CLI path only: [Databricks CLI](https://docs.databricks.com/en/dev-tools/cli/install.html) v0.292.0 or newer, configured via `databricks configure`

## Deployment

You have two ways to install Prometheux. Pick **one** and stick with it for that app — mixing the two on the same app leads to drift and confusing errors.

### Deploy via Git (recommended)

Databricks App pulls this repository directly, then redeploys automatically on every push to `main`. No local tooling required.

1. In your Databricks workspace, open **Compute → Apps → Create App**.
2. Choose **Custom** (do not pick a template).
3. Give the app a name, e.g. `prometheux`.
4. Under **Deploy from**, select **Git**:
   - **Repository URL:** `https://github.com/prometheuxresearch/prometheux-databricks-3p-app`
   - **Branch:** `main`
   - **Path:** `src`   ← this is required; the app manifest lives in `src/app.yaml`, not at the repo root.
5. Click **Create**.

Databricks will clone the repo, install dependencies (`npm install --production`) and start the static server. The app is reachable at `https://prometheux-<workspace-id>.databricksapps.com`.

### Deploy via Databricks CLI (alternative)

Useful for environments that can't reach GitHub from the workspace, or for CI pipelines that prefer to drive the deployment themselves.

```bash
git clone https://github.com/prometheuxresearch/prometheux-databricks-3p-app.git
cd prometheux-databricks-3p-app
./deploy.sh
```

The script will:

- Create `bundle-vars.yml` from the example on first run
- Deploy the app via `databricks bundle deploy`
- Optionally start the app

Other commands:

```bash
./deploy.sh run      # Start the app
./deploy.sh stop     # Stop the app
./deploy.sh restart  # Restart the app
./deploy.sh status   # Check app status
./deploy.sh logs     # View app logs
./deploy.sh destroy  # Delete the app
```

## Updates

- **Git deployment:** every push to `main` triggers a redeploy. No action required.
- **CLI deployment:** pull the latest changes (`git pull`) and run `./deploy.sh` again.

The reasoning backend (Prometheux Cloud) is updated continuously and independently of the frontend — you don't need to redeploy to receive backend improvements.

## Authentication

The app ships in **production mode** with authentication enabled.

The first time a user opens the app, Prometheux performs a zero-click sign-in:

1. Databricks Apps injects the user's identity (verified by Databricks).
2. Prometheux validates that identity against Databricks SCIM.
3. A Prometheux account is created automatically (or matched if one already exists).
4. An access request to the Prometheux Platform is filed for the user with status `Requested`.

A Prometheux administrator approves the request. The user is then notified and can start using the app — without ever typing a password.

Each Databricks workspace becomes its own Prometheux organization. Access requests are scoped per workspace.

## Configuration

The CLI deployment reads `bundle-vars.yml` (created from `bundle-vars.example.yml` on first run):

```yaml
run_mode: production         # 'production' (requires auth) — recommended for marketplace and prod
organization: prometheux     # Your organization name
username: databricks-user    # Ignored in production mode
```

For local development without authentication you can set `run_mode: development`. **Do not** ship `development` mode to production: it disables auth.

## Troubleshooting

### "Failed: No command to run and no Python file found"

Symptom seen with Git deployment. Cause: the **Path** in the Git source configuration is set to the repository root instead of `src`. The manifest (`app.yaml`) lives in `src/`. Edit the app's source configuration and set Path to `src`.

### App won't start (CLI deployment)

```bash
./deploy.sh logs
```

### `databricks configure` fails

Make sure your Databricks CLI is at least v0.292.0:

```bash
databricks --version
```

### "Connection failed" inside the app's Databricks settings

Confirm the App's service principal has Unity Catalog and Compute permissions in your workspace. The first install grants them automatically; later workspace policy changes can revoke them.

### Mixed Git + CLI state

If you deployed via CLI and then attached the same app to Git (or vice-versa), delete the app and recreate it choosing only one of the two methods.

## Support

- Documentation: <https://docs.prometheux.ai>
- Email: <support@prometheux.co.uk>
- Sales / demos: <https://prometheux.ai/contact>

## License

Copyright © 2026 Prometheux Research Ltd. All rights reserved.
