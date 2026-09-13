# GCP deployment

The current proof-of-concept deployment runs in project
`gen-lang-client-0644821693`:

- Compute Engine VM: `frameos-studio`, zone `asia-south1-a`, `e2-standard-2`
- Container image: Artifact Registry repository `frameos` in `asia-south1`
- Persistent application data: `/opt/frameos/data` on the VM's 30 GB balanced disk
- Media bucket: `gs://gen-lang-client-0644821693-frameos-media`
- Runtime identity: `frameos-runtime` with Vertex AI, bucket, Secret Manager, and
  Artifact Registry reader permissions
- Network: static public IP `35.200.238.245` serves only Caddy on ports 80/443;
  SSH remains restricted to IAP (`35.235.240.0/20`)

The public-domain stage has reserved static IP `35.200.238.245` and a Caddy
HTTPS reverse proxy on ports 80/443. Add this GoDaddy DNS record to complete
the domain connection:

```text
Type: A
Name: @
Value: 35.200.238.245
TTL: 600 seconds
```

The proxy requests a certificate for `origin-studio.in` automatically after
DNS resolves. Caddy protects the site with a shared password and injects the
daemon bearer token upstream. Hosted browsers therefore connect automatically;
the daemon token is never exposed in the editor UI or page source.

For local development, open `http://127.0.0.1:31415/studio` and use the local
daemon token prompt as before. For the hosted site, the browser's HTTP Basic
Auth prompt appears once per browser profile; use the shared site password
provided during deployment.

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
requires the render worker. If the bearer token is rotated, update the VM's
`/opt/frameos/Caddyfile` upstream header and restart Caddy as well as the daemon
container.

The project currently shows an available free-trial credit of ₹28,690.09,
valid through November 10, 2026. Google Cloud budgets/spend caps should be
configured in the Billing console before leaving this VM running; spend-cap
enforcement can have reporting latency.
