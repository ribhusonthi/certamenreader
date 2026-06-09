# Nightly report reviewer

A Cloud Run **Job** that, once a night, has Vertex AI Gemini review newly
**reported questions** and DMs a digest of likely bugs (with suggested fixes) to
the admin via **certamen-bot**.

```
Cloud Scheduler (nightly)
   → runs Cloud Run Job: report-reviewer
        → reads MongoDB  (questionReports + tossups/bonuses)
        → Vertex AI Gemini  (diagnosis + fix + severity per report)
        → POST certamen-bot /notify  (X-Bot-Secret)
              → bot DMs the admin a single digest
        → stamps each report aiReviewedAt + aiReview  (never re-sent)
```

This job is **separate** from the `certamenreader` website service — it is built
from this folder only and never rebuilds or redeploys the site. Its only write
to the database is adding `aiReviewedAt` / `aiReview` fields onto
`questionReports` documents.

## Environment

| Var | Required | Notes |
| --- | --- | --- |
| `MONGO_URI` | ✅ | Secret Manager. Same secret the website uses. |
| `BOT_NOTIFY_URL` | ✅ | `https://<certamen-bot-url>/notify` |
| `BOT_SECRET` | ✅ | Secret Manager. Must match the bot + website. |
| `ADMIN_DISCORD_ID` | ⬚ | Discord user ID to DM. If unset, falls back to an admin user in the DB who has linked Discord. |
| `GOOGLE_CLOUD_PROJECT` | ⬚ | Vertex project (set explicitly on the job). |
| `VERTEX_LOCATION` | ⬚ | Default `us-central1`. |
| `GEMINI_MODEL` | ⬚ | Default `gemini-2.5-flash`. |
| `SITE_URL` | ⬚ | Default `https://www.certamenreader.org` (admin link in the digest). |
| `MAX_REPORTS` | ⬚ | Max reports per run (default 40). |
| `BATCH_SIZE` | ⬚ | Reports per Gemini call (default 12). |
| `DRY_RUN` | ⬚ | `true` → review + print digest, but do not DM or mark reviewed. |

Vertex AI auth is via the job's service account (Application Default
Credentials) — it needs `roles/aiplatform.user`. No API key.

## Local dry run

```bash
cd jobs/report-reviewer
npm install
MONGO_URI="…" GOOGLE_CLOUD_PROJECT=<your-project-id> \
  DRY_RUN=true MAX_REPORTS=5 node index.js
```
(Requires `gcloud auth application-default login` for Vertex.)

## Deploy

```bash
gcloud run jobs deploy report-reviewer \
  --source jobs/report-reviewer \
  --region us-central1 \
  --set-secrets=MONGO_URI=MONGO_URI:latest,BOT_SECRET=BOT_SECRET:latest \
  --set-env-vars=BOT_NOTIFY_URL=https://<bot-url>/notify,GOOGLE_CLOUD_PROJECT=<your-project-id>,GEMINI_MODEL=gemini-2.5-flash,SITE_URL=https://www.certamenreader.org,ADMIN_DISCORD_ID=<your-id> \
  --max-retries=1 --task-timeout=900
```

Run it on demand:
```bash
gcloud run jobs execute report-reviewer --region us-central1
```

## Nightly schedule

Cloud Scheduler hits the Cloud Run Jobs `:run` API at 3am ET. See the project
runbook / the `report-reviewer-nightly` scheduler job.
