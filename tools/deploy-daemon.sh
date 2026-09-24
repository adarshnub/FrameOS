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
import os, sys
from pathlib import Path
path = Path(sys.argv[1])
settings = {
    'FRAMEOS_HOST': '0.0.0.0',
    'FRAMEOS_DOCKER_LOCAL_ONLY': 'true',
    'FRAMEOS_ENGINE_WORKER': '/app/bin/frameos-engine-worker',
    'FRAMEOS_GEMINI_MAX_COST_USD_PER_ANALYSIS': '2.00',
    'FRAMEOS_GEMINI_TIMEOUT_MS': '600000',
    'FRAMEOS_GEMINI_EDITOR_TIMEOUT_MS': '600000',
    'FRAMEOS_GEMINI_INPUT_USD_PER_MILLION': '0.30',
    'FRAMEOS_GEMINI_OUTPUT_USD_PER_MILLION': '2.50',
}
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
    cp -p "$backup/env.before" /opt/frameos/.env
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
for (const id of ['engine.mlt', 'media.probe', 'mlt.transition.luma', 'mlt.transition.mix'])
  assert(capabilities.some(c => c.id === id && c.available), id);
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
