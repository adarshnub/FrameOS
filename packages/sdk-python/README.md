# FrameOS Python SDK

This package contains a dependency-free Python client generated from `packages/contracts/openapi/frameos.openapi.json`.

Regenerate it with:

```bash
npm run artifacts
```

Use it with a local daemon:

```python
from frameos import FrameOSClient

client = FrameOSClient("http://127.0.0.1:31415", token="...")
projects = client.list_projects()
```
