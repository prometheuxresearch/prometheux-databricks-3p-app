#!/bin/bash

# Prometheux Databricks 3P App - Simplified Deployment

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

CONFIG_FILE="bundle-vars.yml"

command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check Databricks CLI
if ! command_exists databricks; then
    echo -e "${RED}❌ Error: Databricks CLI is not installed${NC}"
    echo ""
    echo "Please install the Databricks CLI first:"
    echo ""
    echo "  macOS (Homebrew):"
    echo "    brew tap databricks/tap"
    echo "    brew install databricks"
    echo ""
    echo "  Linux/macOS (curl):"
    echo "    curl -fsSL https://raw.githubusercontent.com/databricks/setup-cli/main/install.sh | sh"
    echo ""
    echo "  Windows (winget):"
    echo "    winget install Databricks.DatabricksCLI"
    echo ""
    echo "For more information: https://docs.databricks.com/en/dev-tools/cli/install.html"
    echo ""
    exit 1
fi

# Check config file
if [ ! -f "$CONFIG_FILE" ]; then
    echo -e "${YELLOW}📝 Creating bundle-vars.yml from example...${NC}"
    cp bundle-vars.example.yml bundle-vars.yml
    echo ""
    echo "✅ Created bundle-vars.yml"
    echo ""
    echo "Default configuration:"
    echo "  - run_mode: production (requires authentication)"
    echo "  - Ready for marketplace deployment"
    echo ""
    echo "Run ./deploy.sh again to deploy."
    echo ""
    exit 0
fi

ACTION="${1:-deploy}"

case $ACTION in
    deploy)
        echo "🚀 Deploying Prometheux 3P App..."
        echo ""
        
        # Build variable flags
        VAR_FLAGS=""
        while IFS=': ' read -r key value; do
            # Skip comments and empty lines
            [[ "$key" =~ ^#.*$ ]] && continue
            [[ -z "$key" ]] && continue
            
            # Remove quotes and trim whitespace
            value=$(echo "$value" | sed 's/^[ \t]*//;s/[ \t]*$//' | sed 's/^"//;s/"$//')
            
            if [ -n "$value" ]; then
                VAR_FLAGS="$VAR_FLAGS --var=\"$key=$value\""
            fi
        done < "$CONFIG_FILE"
        
        eval "databricks bundle deploy $VAR_FLAGS"
        
        echo ""
        echo -e "${GREEN}✅ Deployment complete!${NC}"
        echo ""
        read -p "Start the app now? (y/N) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            eval "databricks bundle run prometheux_3p $VAR_FLAGS"
            echo ""
            echo -e "${GREEN}✅ App started!${NC}"
            echo ""
            echo "Your app will be available at:"
            echo "  https://prometheux-<workspace-id>.databricksapps.com"
        fi
        ;;
    
    run)
        echo "▶️  Starting app..."
        databricks bundle run prometheux_3p --var-file "$CONFIG_FILE"
        echo ""
        echo -e "${GREEN}✅ App started!${NC}"
        ;;
    
    stop)
        echo "⏹️  Stopping app..."
        databricks apps stop prometheux
        echo ""
        echo -e "${GREEN}✅ App stopped${NC}"
        ;;
    
    restart)
        echo "🔄 Restarting app..."
        databricks apps restart prometheux
        echo ""
        echo -e "${GREEN}✅ App restarted${NC}"
        ;;
    
    status)
        echo "📊 App status:"
        echo ""
        databricks apps get prometheux
        ;;
    
    logs)
        echo "📋 App logs:"
        echo ""
        databricks apps logs prometheux
        ;;
    
    destroy)
        echo -e "${RED}⚠️  WARNING: This will delete the app${NC}"
        echo ""
        read -p "Are you sure? (y/N) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            databricks bundle destroy --var-file "$CONFIG_FILE"
            echo ""
            echo -e "${GREEN}✅ App destroyed${NC}"
        else
            echo "Cancelled."
        fi
        ;;
    
    *)
        echo "Prometheux Databricks 3P App - Deployment"
        echo ""
        echo "Usage: ./deploy.sh [action]"
        echo ""
        echo "Actions:"
        echo "  deploy   - Deploy the app (default)"
        echo "  run      - Start the app"
        echo "  stop     - Stop the app"
        echo "  restart  - Restart the app"
        echo "  status   - Check app status"
        echo "  logs     - View app logs"
        echo "  destroy  - Delete the app"
        echo ""
        ;;
esac
