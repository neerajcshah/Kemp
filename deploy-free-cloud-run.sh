#!/usr/bin/env bash
set -euo pipefail

# Deploys Kemp Online strictly within Google Cloud Run's Always-Free Tier:
# - Region: us-central1 (Tier-1 Always-Free eligible: 180k vCPU-s + 360k GiB-s/month free)
# - Scales to 0 when nobody is playing (--min-instances=0 -> $0 idle cost)
# - Capped at 1 instance & 256Mi RAM (--max-instances=1 --memory=256Mi)
# - Auto-prunes old Docker layers so Artifact Registry stays <120 MB (500 MB free tier)

REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-kemp}"
REPO="kemp-repo"
PROJECT_ID="$(gcloud config get-value project)"

if [[ -z "${PROJECT_ID}" || "${PROJECT_ID}" == "(unset)" ]]; then
  echo "Error: Set your Google Cloud project first: gcloud config set project YOUR_PROJECT_ID"
  exit 1
fi

echo "==> Enabling Cloud Run, Cloud Build & Artifact Registry APIs on ${PROJECT_ID}..."
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com

echo "==> Ensuring Artifact Registry repo (${REPO}) with 500MB-safe cleanup policy..."
gcloud artifacts repositories describe "${REPO}" --location="${REGION}" >/dev/null 2>&1 || \
  gcloud artifacts repositories create "${REPO}" \
    --repository-format=docker \
    --location="${REGION}" \
    --description="Kemp Online free-tier container repo"

gcloud artifacts repositories set-cleanup-policies "${REPO}" \
  --location="${REGION}" \
  --policy=artifact-cleanup-policy.json \
  --no-dry-run

IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/${SERVICE}:latest"

echo "==> Building container via Cloud Build (120 build-minutes/day free tier)..."
gcloud builds submit --tag "${IMAGE}" .

echo "==> Deploying ${SERVICE} to Cloud Run Always-Free Tier (${REGION})..."
gcloud run deploy "${SERVICE}" \
  --image "${IMAGE}" \
  --region "${REGION}" \
  --platform managed \
  --allow-unauthenticated \
  --min-instances 0 \
  --max-instances 1 \
  --cpu 1 \
  --memory 256Mi \
  --cpu-throttling \
  --session-affinity \
  --timeout 3600

echo "==> Done! Share the Service URL above in your Google Meet chat."
