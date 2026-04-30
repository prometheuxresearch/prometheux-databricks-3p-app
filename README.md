# Prometheux Databricks App (SaaS Edition)

AI-powered Knowledge Graph platform for Databricks, powered by Prometheux Cloud.

## Features

- Modern React UI deployed in your Databricks workspace
- Backend powered by Prometheux Cloud (no infrastructure management)
- Automatic updates without redeployment
- Seamless integration with your Databricks data

## Prerequisites

- Databricks workspace (AWS, Azure, or GCP)
- Databricks CLI installed and configured (`databricks configure`)

## Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/prometheuxresearch/prometheux-databricks-3p-app.git
cd prometheux-databricks-3p-app
```

### 2. Deploy

```bash
./deploy.sh
```

The script will:
- Deploy the app to your Databricks workspace
- Prompt you to start the app

### 3. Access Your App

Your app will be available at:
```
https://prometheux-<workspace-id>.databricksapps.com
```

## Commands

```bash
./deploy.sh          # Deploy the app
./deploy.sh run      # Start the app
./deploy.sh stop     # Stop the app
./deploy.sh restart  # Restart the app
./deploy.sh status   # Check app status
./deploy.sh logs     # View app logs
./deploy.sh destroy  # Remove the app
```

## Configuration

The default configuration in `bundle-vars.yml` is set to **production mode** (requires authentication):

```yaml
run_mode: production     # 'production' (requires auth, recommended) or 'development' (no auth)
organization: prometheux # Your organization name
username: databricks-user # Not used in production mode
```

### Authentication

This app runs in **production mode** by default, which means:
- ✅ Users must authenticate with their Databricks credentials
- ✅ Secure access control
- ✅ Marketplace-ready configuration

For development/testing without authentication, you can change `run_mode` to `development` in `bundle-vars.yml`.

## What's Different from Enterprise Edition?

### SaaS Edition (This Repo)
- ✅ Frontend deployed in your workspace
- ☁️ Backend hosted by Prometheux Cloud
- 🔒 **Production mode with authentication** (secure by default)
- 🚀 Simplified deployment (no AWS credentials needed)
- ⚡ Automatic backend updates
- 🎯 Perfect for marketplace users and quick trials

### Enterprise Edition
- 🏢 Fully self-hosted in your Databricks workspace
- 🔐 Complete data sovereignty
- 💻 Backend runs in your infrastructure
- 🔌 Air-gapped deployment support
- 🛡️ Ideal for regulated industries and large enterprises
- ⚙️ Flexible authentication options (development/production modes)

## Troubleshooting

### App won't start

Check the logs:
```bash
./deploy.sh logs
```

### Deployment fails

Ensure you're authenticated with Databricks:
```bash
databricks configure
```

## Enterprise Edition

Looking for a fully self-hosted solution with complete data sovereignty?

Check out our **Enterprise Edition**:
- GitHub: https://github.com/prometheuxresearch/prometheux-databricks-app
- Full backend deployment in your workspace
- Air-gapped support
- Custom enterprise features

Contact: support@prometheux.co.uk

## License

Copyright © 2026 Prometheux Research Ltd. All rights reserved.
