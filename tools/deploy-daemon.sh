#!/usr/bin/env bash
# Run as root on the Caddy-fronted FrameOS VM after the image passes acceptance.
set -euo pipefail
umask 077
image=${1:?Usage: deploy-daemon.sh REGISTRY/IMAGE:TAG}
[[ "$image" =~ ^[a-zA-Z0-9./:@_-]+$ ]] || exit 2
test "$(id -u)" = 0
test -f /opt/frameos/.env
test -d /opt/frameos/data
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup=/opt/frameos/backups/$stamp
candidate=frameos-candidate-$stamp
previous=frameos-previous-$stamp
old_image=$(docker inspect frameos --format '{{.Config.Image}}')
mkdir -p "$backup/candidate-data"
cp -p /opt/frameos/.env "$backup/env.before"

# Keep credentials in files. Only these non-secret settings are changed.
python3 - /opt/frameos/.env <<'PY'
import os, subprocess, sys
from pathlib import Path
path = Path(sys.argv[1])
settings = {
    'FRAMEOS_HOST': '0.0.0.0',
    'FRAMEOS_DOCKER_LOCAL_ONLY': 'true',
    'FRAMEOS_HOSTED_MODE': 'true',
    'FRAMEOS_ENGINE_WORKER': '/app/bin/frameos-engine-worker',
    'FRAMEOS_ANALYZER_MANIFESTS': '/app/ffmpeg-beats.frameos-analyzer.json',
    'FRAMEOS_GEMINI_MAX_COST_USD_PER_ANALYSIS': '2.00',
    'FRAMEOS_GEMINI_PROVIDER': 'vertex-ai',
    'FRAMEOS_GOOGLE_CLOUD_PROJECT': 'gen-lang-client-0644821693',
    'FRAMEOS_GOOGLE_CLOUD_LOCATION': 'global',
    'FRAMEOS_GCS_BUCKET': 'gen-lang-client-0644821693-frameos-media',
    'FRAMEOS_GCP_AUTH_MODE': 'adc',
    'FRAMEOS_GEMINI_TIMEOUT_MS': '600000',
    'FRAMEOS_GEMINI_EDITOR_TIMEOUT_MS': '600000',
    'FRAMEOS_GEMINI_INPUT_USD_PER_MILLION': '0.30',
    'FRAMEOS_GEMINI_OUTPUT_USD_PER_MILLION': '2.50',
}
password = subprocess.check_output([
    'gcloud', 'secrets', 'versions', 'access', 'latest',
    '--secret=frameos-studio-password',
    '--project=gen-lang-client-0644821693',
], text=True).strip()
if len(password) < 32 or not password.isascii() or any(c.isspace() for c in password):
    raise SystemExit('Hosted studio password secret is invalid')
settings['FRAMEOS_STUDIO_PASSWORD'] = password
lines = [line for line in path.read_text().splitlines()
         if line.split('=', 1)[0].strip() not in settings]
lines.extend(f'{key}={value}' for key, value in settings.items())
temporary = path.with_suffix('.env.deploy')
temporary.write_text('\n'.join(lines) + '\n')
temporary.chmod(0o600)
os.replace(temporary, path)
PY

switched=0
stopped=0
cleanup() {
  result=$?
  trap - EXIT
  docker rm -f "$candidate" >/dev/null 2>&1 || true
  if [ "$result" -ne 0 ]; then
    # Keep the new Studio password on rollback; the previous image supports
    # cookie sign-in too. env.before remains available for manual recovery.
    if [ "$switched" = 1 ]; then
      docker rm -f frameos >/dev/null 2>&1 || true
      # The previous image also needs loopback-only mode behind Caddy.
      docker run -d --name frameos --restart always \
        --env-file /opt/frameos/.env \
        -e FRAMEOS_HOST=0.0.0.0 -e FRAMEOS_DOCKER_LOCAL_ONLY=true \
        -v /opt/frameos/data:/app/.frameos-data \
        -p 127.0.0.1:31415:31415 "$old_image" >/dev/null
      echo "Deployment failed; previous image restarted. Backup: $backup" >&2
    elif [ "$stopped" = 1 ]; then
      docker start frameos >/dev/null
    fi
  fi
  exit "$result"
}
trap cleanup EXIT

gcloud auth print-access-token | docker login -u oauth2accesstoken \
  --password-stdin "https://${image%%/*}" >/dev/null
docker pull "$image"
docker run -d --name "$candidate" --env-file /opt/frameos/.env \
  -e FRAMEOS_DATA_DIR=/app/.frameos-data \
  -v "$backup/candidate-data:/app/.frameos-data" \
  -p 127.0.0.1:31416:31415 "$image" >/dev/null

smoke() {
  local container=$1
  docker exec -i "$container" node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const token = process.env.FRAMEOS_AUTH_TOKEN?.trim() ||
  (await readFile('/app/.frameos-data/auth-token', 'utf8')).trim();
const get = async (path) => {
  const response = await fetch('http://127.0.0.1:31415' + path, {
    headers: { authorization: 'Bearer ' + token },
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(response.status, 200, path);
  return (await response.json()).data;
};
assert.equal((await get('/health')).status, 'ok');
const capabilities = await get('/api/v1/capabilities');
for (const id of ['engine.mlt', 'media.probe', 'mlt.transition.luma', 'mlt.transition.mix', 'frameos.video.chroma-key', 'frameos.video.gaussian-blur', 'frameos.video.vignette', 'analysis.beats.ffmpeg'])
  assert(capabilities.some(c => c.id === id && c.available), id);
assert.equal(process.env.FRAMEOS_GEMINI_PROVIDER, 'vertex-ai');
assert.equal(process.env.FRAMEOS_HOSTED_MODE, 'true');
assert(process.env.FRAMEOS_STUDIO_PASSWORD?.length >= 32);
assert.equal(process.env.FRAMEOS_GOOGLE_CLOUD_PROJECT, 'gen-lang-client-0644821693');
assert.equal(process.env.FRAMEOS_GCS_BUCKET, 'gen-lang-client-0644821693-frameos-media');
const studio = await fetch('http://127.0.0.1:31415/studio', {redirect: 'manual'});
assert.equal(studio.status, 302);
assert(studio.headers.get('location')?.startsWith('/login?next='));
const login = await fetch('http://127.0.0.1:31415/login', {
  method: 'POST',
  headers: {'content-type': 'application/json'},
  body: JSON.stringify({password: process.env.FRAMEOS_STUDIO_PASSWORD}),
});
assert.equal(login.status, 200);
const cookie = login.headers.get('set-cookie');
assert(cookie?.includes('HttpOnly'));
assert(cookie?.includes('Secure'));
const sessionProjects = await fetch('http://127.0.0.1:31415/api/v1/projects', {
  headers: {cookie: cookie.split(';')[0]},
});
assert.equal(sessionProjects.status, 200);
const projects = await get('/api/v1/projects');
assert(Array.isArray(projects));
console.log(JSON.stringify({health: 'ok', nativeWorker: true, projects: projects.length}));
JS
}
curl --retry 12 --retry-all-errors --retry-delay 2 --max-time 5 \
  -fsS http://127.0.0.1:31416/health >/dev/null
smoke "$candidate"
docker rm -f "$candidate" >/dev/null

docker stop --time 30 frameos >/dev/null
stopped=1
docker rename frameos "$previous"
switched=1
docker update --restart=no "$previous" >/dev/null
# Capture a consistent backup while the daemon is stopped; media stays in place.
tar -C /opt/frameos -czf "$backup/data.tgz" data
docker run -d --name frameos --restart always --env-file /opt/frameos/.env \
  -v /opt/frameos/data:/app/.frameos-data \
  -p 127.0.0.1:31415:31415 "$image" >/dev/null
curl --retry 12 --retry-all-errors --retry-delay 2 --max-time 5 \
  -fsS http://127.0.0.1:31415/health >/dev/null
smoke frameos
printf 'Deployed: %s\nPrevious container: %s\nBackup: %s\n' "$image" "$previous" "$backup"
