# Generated from packages/contracts/openapi/frameos.openapi.json. Do not edit by hand.
from __future__ import annotations

import json
from typing import Any
from urllib.error import HTTPError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

JsonObject = dict[str, Any]
JsonArray = list[Any]
JsonValue = JsonObject | JsonArray | str | int | float | bool | None


class FrameOSApiError(Exception):
    def __init__(self, code: str, message: str, status: int, details: JsonArray | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.status = status
        self.details = details


class FrameOSClient:
    def __init__(self, base_url: str, token: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token

    def _request(self, method: str, path: str, body: JsonValue = None, query: JsonObject | None = None) -> JsonValue:
        if query:
            path = f"{path}?{urlencode(query)}"
        payload = None if body is None else json.dumps(body).encode("utf-8")
        request = Request(
            f"{self.base_url}{path}",
            data=payload,
            method=method,
            headers={
                "Authorization": f"Bearer {self.token}",
                "Accept": "application/json",
                **({} if body is None else {"Content-Type": "application/json"}),
            },
        )
        try:
            with urlopen(request) as response:
                envelope = json.loads(response.read().decode("utf-8"))
                status = response.status
        except HTTPError as error:
            status = error.code
            try:
                envelope = json.loads(error.read().decode("utf-8"))
            except Exception as exc:  # pragma: no cover - transport fallback
                raise FrameOSApiError(f"HTTP_{status}", str(error), status) from exc
        api_error = envelope.get("error")
        data = envelope.get("data")
        if api_error is not None or data is None:
            api_error = api_error or {"code": f"HTTP_{status}", "message": "Empty API response"}
            raise FrameOSApiError(api_error.get("code", "UNKNOWN"), api_error.get("message", "Unknown API error"), status, api_error.get("details"))
        return data

    def list_projects(self) -> JsonValue:
        return self._request("GET", f"/api/v1/projects", body=None, query=None)

    def create_project(self, input: JsonObject) -> JsonValue:
        return self._request("POST", f"/api/v1/projects", body=input, query=None)

    def get_project(self, project_id: str) -> JsonValue:
        return self._request("GET", f"/api/v1/projects/{quote(str(project_id))}", body=None, query=None)

    def get_project_revision(self, project_id: str, revision: int) -> JsonValue:
        return self._request("GET", f"/api/v1/projects/{quote(str(project_id))}/revisions/{quote(str(revision))}", body=None, query=None)

    def execute_transaction(self, input: JsonObject) -> JsonValue:
        return self._request("POST", f"/api/v1/transactions", body=input, query=None)

    def import_otio(self, input: JsonObject) -> JsonValue:
        return self._request("POST", f"/api/v1/imports/otio", body=input, query=None)

    def export_otio(self, input: JsonObject) -> JsonValue:
        return self._request("POST", f"/api/v1/exports/otio", body=input, query=None)

    def import_captions(self, input: JsonObject) -> JsonValue:
        return self._request("POST", f"/api/v1/imports/captions", body=input, query=None)

    def export_captions(self, input: JsonObject) -> JsonValue:
        return self._request("POST", f"/api/v1/exports/captions", body=input, query=None)

    def list_capabilities(self, search: str | None = None) -> JsonValue:
        return self._request("GET", f"/api/v1/capabilities", body=None, query={'search': search} if search is not None else None)

    def list_admin_logs(self, level: str | None = None, category: str | None = None, project_id: str | None = None, search: str | None = None, limit: int | None = None) -> JsonValue:
        return self._request("GET", f"/api/v1/admin/logs", body=None, query={key: value for key, value in {'level': level, 'category': category, 'projectId': project_id, 'search': search, 'limit': limit}.items() if value is not None})

    def get_admin_provider_usage(self, project_id: str | None = None, session_id: str | None = None) -> JsonValue:
        return self._request("GET", f"/api/v1/admin/usage", body=None, query={key: value for key, value in {'projectId': project_id, 'sessionId': session_id}.items() if value is not None})

    def list_analyzers(self) -> JsonValue:
        return self._request("GET", f"/api/v1/analysis/analyzers", body=None, query=None)

    def import_asset(self, input: JsonObject) -> JsonValue:
        return self._request("POST", f"/api/v1/assets/imports", body=input, query=None)

    def create_asset_proxy(self, project_id: str, asset_id: str, input: JsonObject) -> JsonValue:
        return self._request("POST", f"/api/v1/projects/{quote(str(project_id))}/assets/{quote(str(asset_id))}/proxies", body=input, query=None)

    def create_asset_thumbnail(self, project_id: str, asset_id: str, input: JsonObject) -> JsonValue:
        return self._request("POST", f"/api/v1/projects/{quote(str(project_id))}/assets/{quote(str(asset_id))}/thumbnails", body=input, query=None)

    def analyze_asset(self, project_id: str, asset_id: str, input: JsonObject) -> JsonValue:
        return self._request("POST", f"/api/v1/projects/{quote(str(project_id))}/assets/{quote(str(asset_id))}/analysis", body=input, query=None)

    def list_asset_analysis(self, project_id: str, asset_id: str) -> JsonValue:
        return self._request("GET", f"/api/v1/projects/{quote(str(project_id))}/assets/{quote(str(asset_id))}/analysis", body=None, query=None)

    def search_analysis(self, input: JsonObject) -> JsonValue:
        return self._request("POST", f"/api/v1/assets/search", body=input, query=None)

    def find_semantic_ranges(self, input: JsonObject) -> JsonValue:
        return self._request("POST", f"/api/v1/semantic/find", body=input, query=None)

    def plan_silence_removal(self, input: JsonObject) -> JsonValue:
        return self._request("POST", f"/api/v1/semantic/remove-silences/plan", body=input, query=None)

    def plan_vertical_conversion(self, input: JsonObject) -> JsonValue:
        return self._request("POST", f"/api/v1/semantic/make-vertical/plan", body=input, query=None)

    def plan_cuts_to_music(self, input: JsonObject) -> JsonValue:
        return self._request("POST", f"/api/v1/semantic/match-cuts-to-music/plan", body=input, query=None)

    def plan_dynamic_captions(self, input: JsonObject) -> JsonValue:
        return self._request("POST", f"/api/v1/semantic/add-dynamic-captions/plan", body=input, query=None)

    def plan_create_highlight(self, input: JsonObject) -> JsonValue:
        return self._request("POST", f"/api/v1/semantic/create-highlight/plan", body=input, query=None)

    def plan_sync_broll(self, input: JsonObject) -> JsonValue:
        return self._request("POST", f"/api/v1/semantic/sync-broll/plan", body=input, query=None)

    def get_job(self, job_id: str) -> JsonValue:
        return self._request("GET", f"/api/v1/jobs/{quote(str(job_id))}", body=None, query=None)

    def start_preview(self, input: JsonObject) -> JsonValue:
        return self._request("POST", f"/api/v1/previews", body=input, query=None)

    def cancel_job(self, job_id: str) -> JsonValue:
        return self._request("DELETE", f"/api/v1/jobs/{quote(str(job_id))}", body=None, query=None)

    def create_agent_session(self, input: JsonObject) -> JsonValue:
        return self._request("POST", f"/api/v1/agents/sessions", body=input, query=None)

    def plan_edit(self, session_id: str, request: str) -> JsonValue:
        return self._request("POST", f"/api/v1/agents/runs", body={'sessionId': session_id, 'request': request}, query=None)

    def execute_agent_run(self, run_id: str, operations: JsonArray) -> JsonValue:
        return self._request("POST", f"/api/v1/agents/runs/{quote(str(run_id))}/execute", body={'operations': operations}, query=None)

    def evaluate_agent_run(self, run_id: str) -> JsonValue:
        return self._request("POST", f"/api/v1/agents/runs/{quote(str(run_id))}/evaluate", body=None, query=None)

    def list_agent_evaluations(self, run_id: str) -> JsonValue:
        return self._request("GET", f"/api/v1/agents/runs/{quote(str(run_id))}/evaluations", body=None, query=None)

    def revise_agent_run(self, run_id: str, operations: JsonArray) -> JsonValue:
        return self._request("POST", f"/api/v1/agents/runs/{quote(str(run_id))}/revise", body={'operations': operations}, query=None)

    def list_approvals(self, project_id: str | None = None, status: str | None = None) -> JsonValue:
        return self._request("GET", f"/api/v1/approvals", body=None, query={key: value for key, value in {'projectId': project_id, 'status': status}.items() if value is not None})

    def decide_approval(self, approval_id: str, decision: JsonObject) -> JsonValue:
        return self._request("POST", f"/api/v1/approvals/{quote(str(approval_id))}/decision", body=decision, query=None)
    def download_job_artifact(self, job_id: str, artifact_name: str) -> bytes:
        path = f"/api/v1/jobs/{quote(str(job_id))}/artifacts/{quote(str(artifact_name))}"
        request = Request(
            f"{self.base_url}{path}",
            method="GET",
            headers={"Authorization": f"Bearer {self.token}", "Accept": "*/*"},
        )
        with urlopen(request) as response:
            return response.read()
