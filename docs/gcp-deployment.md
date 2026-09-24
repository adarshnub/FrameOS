# GCP deployment

The current proof-of-concept deployment runs in project
`gen-lang-client-0644821693`:

- Compute Engine VM: `frameos-studio`, zone `asia-south1-a`, `e2-standard-4` (4 vCPU, 16 GB RAM)
- Container image: Artifact Registry repository `frameos` in `asia-south1`
- Persistent application data: `/opt/frameos/data` on the VM's 100 GB balanced disk
- Media bucket: `gs://gen-lang-client-0644821693-frameos-media`
- Runtime identity: `frameos-runtime` with Vertex AI, bucket, Secret Manager, and
  Artifact Registry reader permissions
- Network: static public IP `35.200.238.245` serves only Caddy on ports 80/443;
  SSH remains restricted to IAP (`35.235.240.0/20`)

The public domain uses static IP `35.200.238.245` and a Caddy HTTPS reverse
proxy on ports 80/443. Its DNS record is:

```text
Type: A
Name: @
Value: 35.200.238.245
TTL: 600 seconds
```

The proxy manages the certificate for `origin-studio.in`. The daemon's host
port is bound to `127.0.0.1:31415`, with `FRAMEOS_DOCKER_LOCAL_ONLY=true` because
Caddy handles public HTTPS. Omitting this setting makes the daemon demand
in-container TLS and fail to start.

Do not inject a shared daemon bearer token in Caddy. The previous
`header_up Authorization` override contained a stale token and broke valid
client authentication. Requests must retain their own bearer header or Studio
session cookie. The current proxy configuration is:

```caddyfile
origin-studio.in {
    reverse_proxy 127.0.0.1:31415
}
```

For local development, open `http://127.0.0.1:31415/studio`. The hosted
deployment requires `FRAMEOS_HOSTED_MODE=true` and a strong Studio password.
`/studio` redirects unsigned visitors to `/login`; a secure, HTTP-only session
cookie then authorizes Studio API requests. The password is stored in Secret
Manager as `frameos-studio-password` and retrieved by the deploy script. A
publicly proxied daemon without that secret fails startup. Bearer tokens remain
available for API clients; the hosted browser does not prompt for a daemon
token.

Project administrators can retrieve the Studio password for invited editors
from Secret Manager in the GCP console, or through an authenticated CLI:

```powershell
gcloud secrets versions access latest `
  --secret=frameos-studio-password `
  --project=gen-lang-client-0644821693
```

This is one shared password for the current editor-testing deployment. It does
not provide separate user accounts or project isolation. Distribute it only to
the invited test group. Public health and sign-in requests succeed;
unauthenticated project API requests return HTTP 401.

## Connect privately

Run this from a machine with the Google Cloud CLI authenticated as a project
user:

```powershell
gcloud compute ssh frameos-studio `
  --zone=asia-south1-a `
  --project=gen-lang-client-0644821693 `
  --tunnel-through-iap `
  --ssh-flag='-N' `
  --ssh-flag='-L 31416:localhost:31415'
```

While that command remains running, open `http://127.0.0.1:31416/studio`.
The daemon bearer token is stored in Secret Manager; retrieve it without
printing the rest of the environment:

```powershell
gcloud secrets versions access latest `
  --secret=frameos-env `
  --project=gen-lang-client-0644821693 |
  Select-String '^FRAMEOS_AUTH_TOKEN='
```

## Operational notes

The deployment uses the current SQLite-backed daemon and persists its data on
the VM disk. It is suitable for private testing, not high availability. The
browser editor still has the documented native-renderer limitations; MP4 export
uses the bundled native render worker. Keep any Caddy authentication settings
consistent with the daemon when rotating credentials.

On September 24, a project-scoped ₹10,000 monthly budget was configured with
50%, 80% and 100% alerts, excluding credits so credit consumption remains
visible. This is an alert, not a spending cap. The user reported approximately
₹28,000 remaining credits; check Billing for the current balance. Hosted Gemini
analysis allows up to $2 per analysis and uses ten-minute analysis/planning
timeouts.

## Verified deployment: September 24, 2026

The accepted image is `frameos-daemon:qa-3fe52ea7-d4b1-4bd8-8f56-e72fc10b4126`
in the repository above, deployed by immutable digest
`sha256:676840521d36875f28287e138d800db6f0cd1becc7d6bba3c77db2bf545b4ec9`.
Its [native acceptance](manual-editor-testing.md) includes a complete 50-minute
1080p export and compositing checks. The live health endpoint and native
capability discovery pass; the existing project remains available. A public
HTTPS smoke test also passed upload, timeline editing, export and media download.

Rollback material is retained in container `frameos-previous-20260924T032906Z`
and `/opt/frameos/backups/20260924T032906Z` (`env.before`, `data.tgz` and
`Caddyfile.before`). The
previous container is stopped with restart disabled. Its original configuration
lacked the required loopback mode, so use the corrected network settings when
restarting the previous image; starting the old container unchanged will fail.

## Automatic deployments

`cloudbuild.yaml` builds the daemon image and rolls it out to `frameos-studio`
over IAP using `tools/deploy-daemon.sh`. The script starts an isolated candidate,
verifies health and native capabilities, stops and backs up the existing daemon,
and preserves its container. A failed rollout restarts the previous image.
`cloudbuild.manual-qa.yaml` separately runs acceptance without deploying.
A Cloud Build GitHub trigger still needs one-time authorization in
Google Cloud for `adarshnub/FrameOS`; no GitHub connection currently exists, so
Google Cloud rejects trigger creation from the CLI. After authorizing the
repository, create a push trigger for `main` using this file. The project
service account has the IAP SSH and VM deployment roles required by the file.

## AI effects and hosted sign-in rollout: September 24, 2026

Image `frameos-daemon:ai-32eec72f-7df4-4543-b55f-a02a4ad29da3` was deployed by
digest `sha256:efb4a72206fca5c8245736fa6e2b8ed4f52f7c423a2b390ba129d763f3354939`.
Cloud Build passed native chroma key, blur, vignette and animated-title pixel
checks. The updated planner passed the isolated live Gemini acceptance described
in [AI effects testing](ai-effects-testing.md), including a montage drawn from
ten separate five-minute sources. The deployment smoke passed on both the
isolated candidate and production data. The existing two projects were present
after rollout.

Public HTTPS checks returned `/studio` 302 to `/login`, unauthenticated
`/api/v1/projects` 401 and `/health` 200. Chrome displayed the hosted Studio
sign-in form. The VM smoke also submitted the Secret Manager password over its
loopback endpoint and verified the resulting session could read projects. A
human Chrome sign-in and post-login UI walk-through remains to be completed.

The stopped previous container is `frameos-previous-20260924T081144Z`. The
backup, including `env.before` and `data.tgz`, is
`/opt/frameos/backups/20260924T081144Z`. The deployed environment contains the
new hosted password; preserve that setting when rolling back.
