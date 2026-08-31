# Hybrid Gemini analysis

FrameOS can combine deterministic local asset metadata with Vertex AI Gemini's
timestamped visual understanding. The result is a normal `visual_semantic`
analysis artifact: it is persisted with the project, indexed by the existing
FTS search endpoint, visible to agents, and never becomes a hidden alternate
timeline representation.

## Local setup

Use the existing local ADC service-account impersonation setup and configure:

```dotenv
FRAMEOS_GEMINI_PROVIDER=vertex-ai
FRAMEOS_GCP_AUTH_MODE=adc
FRAMEOS_GCLOUD_COMMAND=C:\\path\\to\\gcloud.cmd
FRAMEOS_GOOGLE_CLOUD_PROJECT=your-project-id
FRAMEOS_GOOGLE_CLOUD_LOCATION=global
FRAMEOS_GCS_BUCKET=your-private-frameos-bucket
FRAMEOS_GEMINI_MODEL=gemini-2.5-flash
FRAMEOS_GEMINI_MAX_COST_USD_PER_ANALYSIS=0.10
FRAMEOS_GEMINI_DELETE_REMOTE_MEDIA=true
```

No JSON key is required for local ADC. The service account needs Vertex AI User
and object-admin access to the selected private bucket; the Vertex AI managed
service agent needs object-viewer access to that same bucket.

## Run it

1. Start the daemon with `npm run dev`.
2. Open `http://127.0.0.1:31415/inspector` and connect using the token in
   `.frameos-data/auth-token`.
3. Create or select a project, then choose a video via **Choose media from this
   computer** and import it.
4. Set **Analysis mode** to **Hybrid: local metadata + Gemini visual
   intelligence**, then select **Analyze selected asset**.
5. Wait for the analysis job to complete. Search terms such as `book`,
   `person reading`, or `close-up` via **Search analysis**.

The Live Operations Log shows start, temporary upload, completion/failure, and
deletion events. The AI Cost Ledger records Gemini's returned token usage and
the configured price estimate. A preflight estimate rejects media that could
exceed `FRAMEOS_GEMINI_MAX_COST_USD_PER_ANALYSIS`; it is a safety guard rather
than a cloud billing guarantee.

Temporary Cloud Storage media is deleted after each request when
`FRAMEOS_GEMINI_DELETE_REMOTE_MEDIA=true`. The bucket also has a one-day
lifecycle cleanup rule as a fallback.
