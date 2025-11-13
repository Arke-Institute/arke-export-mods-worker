#!/bin/bash
# Deploy MODS export worker with consistent 'production' tag
# This script builds, tags, and pushes the Docker image to Fly.io

set -e  # Exit on error

APP_NAME="arke-mods-export-worker"
PRODUCTION_TAG="production"

echo "=========================================="
echo "Deploying MODS Export Worker"
echo "=========================================="
echo ""

# Build and push with both deployment tag and production tag
echo "Building and pushing Docker image..."
fly deploy \
  --build-only \
  --push \
  --remote-only \
  --image-label "$PRODUCTION_TAG" \
  --app "$APP_NAME"

echo ""
echo "=========================================="
echo "Deployment Complete!"
echo "=========================================="
echo ""
echo "Image tag: registry.fly.io/$APP_NAME:$PRODUCTION_TAG"
echo ""
echo "Use this in orchestrator:"
echo '  image: "registry.fly.io/arke-mods-export-worker:production"'
echo ""
