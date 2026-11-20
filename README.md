# Kemp Online

Real-time multiplayer **Kemp** (*Kemps / Kent / Cash*) built to be played alongside **Google Meet**, engineered to run **100% free (\$0/month)** on Google Cloud via either **Firebase's No-Credit-Card Spark Plan** or **Google Cloud Run's Always-Free Tier**.

[![Run on Google Cloud](https://deploy.cloud.run/button.svg)](https://deploy.cloud.run)

---

## Features

- **Google Meet Companion Workflow:** Launch a call via `meet.new` right from the lobby, save the `meet.google.com/...` link to the room, and give every player a 1-click **Join Google Meet** button.
- **Auto-Locking Partner Secret Huddle:** Private team-only pre-round chat + pinned signal reminder (`Hold to Peek`) that **locks and vanishes the instant cards hit the table**.
- **Simultaneous Free-for-All Swaps:** Race-safe 4-card swaps (`expectedCenterCardId`) + unanimous **Deal New 4 Cards** voting.
- **Toggleable House Rules:**
  - **2, 3, or 4 Teams of 2** (4, 6, or 8 seats) + **AI Bots** to fill open seats or practice solo.
  - **"Not Kemp!" Counter-Call Rule:** Toggle between **Accuse Opponent** (freezes the table to pick who holds 4-of-a-kind) and **General Stop** (wins if *any* opponent holds 4-of-a-kind).
  - **Spell `K-E-M-P` Mode:** Toggle between **Earn K-E-M-P** (first team to spell `KEMP` wins) and **Penalty K-E-M-P** (`KEMP` eliminates a team).
- **Keyboard Shortcuts (Desktop):** `1–4` select hand card · `Q W E R` select/swap center card · `Space` vote new 4 cards · `K` yell **KEMP!** · `N` yell **NOT KEMP!**.

---

## Run on Google Cloud for \$0 (Two Built-In Free Paths)

The app automatically detects which Google Cloud backend is active (`public/js/app.js` + `public/js/firebaseAdapter.js`):

### Option A: Firebase Spark Plan (\$0 Forever — **No Credit Card Required**)

Firebase's **Spark Plan** requires **no billing account or payment method**, so it is impossible to incur charges:
- **Firebase Hosting:** Free `https://<your-project>.web.app` URL + SSL (`10 GB` storage, `360 MB/day` bandwidth).
- **Firebase Realtime Database:** `100` concurrent real-time connections & `1 GB` storage free (a Kemp room uses `<5 KB`), using atomic `runTransaction()` for race-safe card grabs.
- **Firebase Anonymous Auth:** Free (`database.rules.json` isolates room access to authenticated players).

**Setup (takes ~3 minutes, even from Google Cloud Shell in your browser):**
1. Go to [console.firebase.google.com](https://console.firebase.google.com) → **Create a project** (stays on the **Spark \$0 No-Cost Plan**).
2. Enable **Authentication → Sign-in method → Anonymous** (`Enable`).
3. Enable **Realtime Database → Create Database** (choose `us-central1`).
4. Deploy from your terminal or [Google Cloud Shell](https://shell.cloud.google.com):
   ```bash
   npx firebase-tools login
   npx firebase-tools use --add   # pick your Firebase project
   npx firebase-tools deploy --only database,hosting
   ```
   Firebase Hosting automatically injects `/__/firebase/init.json` at runtime—no API keys need to be hardcoded!

---

### Option B: Google Cloud Run Always-Free Tier (\$0/Month in `us-central1`)

Google Cloud Run includes a permanent monthly **Always-Free Tier** in `us-central1` (**180,000 vCPU-seconds**, **360,000 GiB-seconds**, **2M requests**, and **1 GiB egress/month**), plus Cloud Build's **120 free build-minutes/day** and Artifact Registry's **500 MB free storage**.

Our configs (`deploy-free-cloud-run.sh` and `cloudbuild.yaml`) lock in free-tier guardrails:
- `--region=us-central1` (Always-Free eligible region)
- `--min-instances=0` (**scales to zero** when nobody is playing → **\$0 idle cost**)
- `--max-instances=1` & `--memory=256Mi` (~**400 hours/month** of active RAM and **50 hours/month** of active CPU free)
- `artifact-cleanup-policy.json` automatically prunes old Docker layers so image storage stays `<120 MB` (well below the `500 MB` free cap).

**Deploy in 1 command (from Google Cloud Shell or local `gcloud`):**
```bash
./deploy-free-cloud-run.sh
```
*(Or connect this GitHub repo in **Cloud Console → Cloud Run → Continuously deploy from a repository** using `cloudbuild.yaml`.)*

---

## Local Development

```bash
npm install
npm run dev
# Run unit & WebSocket integration tests:
npm test
```
