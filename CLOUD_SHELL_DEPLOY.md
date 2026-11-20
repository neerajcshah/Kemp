# Deploy Kemp Online for $0 on Google Firebase (Spark Plan)

Welcome! Follow these steps right here in Google Cloud Shell (no credit card required).

## Step 1: Create Your Free Firebase Spark Project

1. Open the [Firebase Console](https://console.firebase.google.com/) in a browser tab and click **Create a project** (for example, `kemp-cards-online`).
2. In the left sidebar:
   - Click **Build → Authentication → Get started → Anonymous → Enable → Save**.
   - Click **Build → Realtime Database → Create Database** (pick **United States `us-central1`**) → **Next → Enable**.
   - On **Project Overview**, click the **`</>` (Web)** icon to register a Web App (check **Also set up Firebase Hosting** if prompted, or just click **Register app**).

## Step 2: Deploy Hosting & Security Rules from Cloud Shell

Run these commands in the Cloud Shell terminal below (replace `YOUR_FIREBASE_PROJECT_ID` with the project ID from Step 1):

```bash
firebase login --no-localhost
firebase use YOUR_FIREBASE_PROJECT_ID
firebase deploy --only database,hosting
```

## Step 3: Play!

Open the **Hosting URL** (`https://YOUR_FIREBASE_PROJECT_ID.web.app`) printed at the end of `firebase deploy`, drop it into your Google Meet chat, and play!
