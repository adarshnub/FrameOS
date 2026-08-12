# Generated-client surface derived from packages/contracts/openapi/frameos.openapi.json.
from __future__ import annotations

import json
from typing import Any
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen


class FrameOSApiError(RuntimeError):
    def __init__(self, code: str, message: str, status: int, details: list[Any] | None = None):
        super().__init__(f"{code}: {message}")
        self.code, self.status, self.details = code, status, details


class FrameOSClient:
    def __init__(self, base_url: str, token: str):
        self.base_url, self.token = base_url.rstrip("/"), token

    def _request(self, method: str, path: str, body: dict[str, Any] | None = None) -> Any:
        data = None if body is None else json.dumps(body).encode("utf-8")
        request = Request(self.base_url + path, data=data, method=method, headers={
            "Authorization": f"Bearer {self.token}", "Accept": "application/json",
            **({} if body is None else {"Content-Type": "application/json"}),
        })
        try:
            with urlopen(request, timeout=60) as response:
                envelope, status = json.load(response), response.status
        except HTTPError as error:
            envelope, status = json.load(error), error.code
        if envelope.get("error") is not None or envelope.get("data") is None:
            error = envelope.get("error") or {"code": f"HTTP_{status}", "message": "Request failed"}
            raise FrameOSApiError(error["code"], error["message"], status, error.get("details"))
        return envelope["data"]

    def list_projects(self) -> list[dict[str, Any]]:
        return self._request("GET", "/api/v1/projects")

    def create_project(self, name: str, **settings: Any) -> dict[str, Any]:
        return self._request("POST", "/api/v1/projects", {"name": name, **settings})

    def get_project(self, project_id: str, revision: int | None = None) -> dict[str, Any]:
        suffix = "" if revision is None else f"/revisions/{revision}"
        return self._request("GET", f"/api/v1/projects/{quote(project_id)}{suffix}")

    def execute_transaction(self, transaction: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/transactions", transaction)

    def import_otio(self, document: dict[str, Any], project_name: str | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {"document": document}
        if project_name is not None:
            body["projectName"] = project_name
        return self._request("POST", "/api/v1/imports/otio", body)

    def export_otio(
        self,
        project_id: str,
        sequence_id: str | None = None,
        revision: int | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"projectId": project_id}
        if sequence_id is not None:
            body["sequenceId"] = sequence_id
        if revision is not None:
            body["revision"] = revision
        return self._request("POST", "/api/v1/exports/otio", body)

    def import_captions(self, request: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/imports/captions", request)

    def export_captions(self, request: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/exports/captions", request)

    def list_analyzers(self) -> list[dict[str, Any]]:
        return self._request("GET", "/api/v1/analysis/analyzers")

    def import_asset(self, request: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/assets/imports", request)

    def create_asset_proxy(self, request: dict[str, Any]) -> dict[str, Any]:
        project_id, asset_id = request["projectId"], request["assetId"]
        return self._request(
            "POST",
            f"/api/v1/projects/{quote(project_id)}/assets/{quote(asset_id)}/proxies",
            request,
        )

    def create_asset_thumbnail(self, request: dict[str, Any]) -> dict[str, Any]:
        project_id, asset_id = request["projectId"], request["assetId"]
        return self._request(
            "POST",
            f"/api/v1/projects/{quote(project_id)}/assets/{quote(asset_id)}/thumbnails",
            request,
        )

    def analyze_asset(self, request: dict[str, Any]) -> dict[str, Any]:
        project_id, asset_id = request["projectId"], request["assetId"]
        return self._request(
            "POST",
            f"/api/v1/projects/{quote(project_id)}/assets/{quote(asset_id)}/analysis",
            request,
        )

    def list_asset_analysis(self, project_id: str, asset_id: str) -> list[dict[str, Any]]:
        return self._request(
            "GET",
            f"/api/v1/projects/{quote(project_id)}/assets/{quote(asset_id)}/analysis",
        )

    def search_analysis(self, request: dict[str, Any]) -> list[dict[str, Any]]:
        return self._request("POST", "/api/v1/assets/search", request)

    def find_semantic_ranges(self, request: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/semantic/find", request)

    def plan_silence_removal(self, request: dict[str, Any]) -> dict[str, Any]:
        return self._request(
            "POST", "/api/v1/semantic/remove-silences/plan", request
        )

    def plan_vertical_conversion(self, request: dict[str, Any]) -> dict[str, Any]:
        return self._request(
            "POST", "/api/v1/semantic/make-vertical/plan", request
        )

    def plan_cuts_to_music(self, request: dict[str, Any]) -> dict[str, Any]:
        return self._request(
            "POST", "/api/v1/semantic/match-cuts-to-music/plan", request
        )

    def plan_dynamic_captions(self, request: dict[str, Any]) -> dict[str, Any]:
        return self._request(
            "POST", "/api/v1/semantic/add-dynamic-captions/plan", request
        )

    def start_preview(self, request: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/previews", request)

    def download_job_artifact(self, job_id: str, artifact_name: str) -> tuple[bytes, str]:
        request = Request(
            f"{self.base_url}/api/v1/jobs/{quote(job_id)}/artifacts/{quote(artifact_name)}",
            method="GET",
            headers={"Authorization": f"Bearer {self.token}", "Accept": "*/*"},
        )
        try:
            with urlopen(request, timeout=60) as response:
                return response.read(), response.headers.get_content_type()
        except HTTPError as error:
            envelope = json.load(error)
            body = envelope.get("error") or {
                "code": f"HTTP_{error.code}",
                "message": "Artifact request failed",
            }
            raise FrameOSApiError(
                body["code"], body["message"], error.code, body.get("details")
            ) from error

    def create_agent_session(self, session: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/v1/agents/sessions", session)

    def plan_edit(self, session_id: str, edit_request: str) -> dict[str, Any]:
        return self._request("POST", "/api/v1/agents/runs", {"sessionId": session_id, "request": edit_request})

    def execute_agent_run(self, run_id: str, operations: list[dict[str, Any]]) -> dict[str, Any]:
        return self._request("POST", f"/api/v1/agents/runs/{quote(run_id)}/execute", {"operations": operations})

    def evaluate_agent_run(self, run_id: str) -> dict[str, Any]:
        return self._request("POST", f"/api/v1/agents/runs/{quote(run_id)}/evaluate")

    def list_agent_evaluations(self, run_id: str) -> list[dict[str, Any]]:
        return self._request("GET", f"/api/v1/agents/runs/{quote(run_id)}/evaluations")

    def revise_agent_run(self, run_id: str, operations: list[dict[str, Any]]) -> dict[str, Any]:
        return self._request(
            "POST",
            f"/api/v1/agents/runs/{quote(run_id)}/revise",
            {"operations": operations},
        )

    def list_approvals(self, project_id: str | None = None, status: str | None = None) -> list[dict[str, Any]]:
        query = []
        if project_id is not None:
            query.append(f"projectId={quote(project_id)}")
        if status is not None:
            query.append(f"status={quote(status)}")
        suffix = "" if not query else "?" + "&".join(query)
        return self._request("GET", "/api/v1/approvals" + suffix)

    def decide_approval(
        self,
        approval_id: str,
        decision: str,
        decided_by: str,
        note: str | None = None,
    ) -> dict[str, Any]:
        body = {"decision": decision, "decidedBy": decided_by}
        if note is not None:
            body["note"] = note
        return self._request("POST", f"/api/v1/approvals/{quote(approval_id)}/decision", body)
