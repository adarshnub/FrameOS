# Containerized local FrameOS

The local daemon container runs on Linux and includes the Google Cloud CLI.
It uses your existing local ADC impersonation credentials by mounting the
standard gcloud directory read-only; no service-account key is copied into the
image or Compose file.

## Start

1. Ensure Docker Desktop is running normally.
2. Stop a Windows-host daemon on port 31415, if one is running.
3. Run `docker compose up --build` from the repository root.
4. Open `http://127.0.0.1:31415/inspector`.
5. Read the token from the named volume-backed `.frameos-data/auth-token` via
   `docker compose exec frameos-daemon cat /app/.frameos-data/auth-token`.

The Compose file overrides `FRAMEOS_GCLOUD_COMMAND` to `gcloud` inside Linux.
Your host `.env` can retain its Windows path; it is not used in the container.
Because `CLOUDSDK_CONFIG=/gcloud`, the container reads the mounted local ADC
credentials and continues to impersonate the restricted FrameOS service account.

## Verify Gemini

Import media through the Inspector, choose **Hybrid: local metadata + Gemini
visual intelligence**, and analyze it. The container uploads temporary media to
the configured private GCS bucket, calls Vertex AI, indexes the result, and
cleans up the object.

Never mount service-account JSON key files or add them to `.env`.
