/** Real Docker API + fresh headless browser. Creates a clearly named QA project.
 * Gemini search is fixture-backed here; this is not a live model quality test.
 * Run: npm run build && node tools/studio-e2e.mjs
 */
import { execFileSync } from "node:child_process";
import { chromium, expect } from "@playwright/test";
import {
  aiPlanRequestSchema,
  compileAiPlan,
} from "../apps/daemon/dist/studio/ai-plan.js";
import {
  studioHtml,
  studioCss,
  studioJavaScript,
} from "../apps/daemon/dist/studio/editor.js";

const origin = process.env.FRAMEOS_TEST_URL || "http://127.0.0.1:31415";
const token =
  process.env.FRAMEOS_TEST_TOKEN ||
  execFileSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "frameos-daemon",
      "cat",
      "/app/.frameos-data/auth-token",
    ],
    { encoding: "utf8" },
  ).trim();
async function api(method, path, body) {
  const r = await fetch(origin + "/api/v1" + path, {
    method,
    headers: {
      authorization: "Bearer " + token,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const e = await r.json();
  if (!r.ok || e.error) throw Error(e.error?.message || r.status);
  return e.data;
}
const projects = await api("GET", "/projects");
let sample;
for (const p of projects) {
  const assets = await api("GET", "/projects/" + p.projectId + "/assets");
  const asset = assets.find((a) => a.kind === "video");
  if (asset) {
    sample = { projectId: p.projectId, asset };
    break;
  }
}
if (!sample)
  throw Error("Import one sample video before running this browser test.");
const mediaResponse = await fetch(
  origin +
    "/api/v1/projects/" +
    sample.projectId +
    "/assets/" +
    sample.asset.id +
    "/content",
  { headers: { authorization: "Bearer " + token } },
);
if (!mediaResponse.ok) throw Error("Cannot load sample video.");
const buffer = Buffer.from(await mediaResponse.arrayBuffer());
const project = await api("POST", "/projects", {
  name: "Studio browser QA " + new Date().toISOString(),
});
const browser = await chromium.launch({
  channel: process.env.FRAMEOS_TEST_BROWSER || "msedge",
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
// Serve the built candidate under the production CSP, against the real API.
if (process.env.FRAMEOS_TEST_DEPLOYED !== "1") {
  await page.route(origin + "/studio", (route) =>
    route.fulfill({
      contentType: "text/html",
      headers: {
        "content-security-policy":
          "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src data: blob:; media-src blob:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
      },
      body: studioHtml,
    }),
  );
  await page.route(origin + "/studio/app.css", (route) =>
    route.fulfill({ contentType: "text/css", body: studioCss }),
  );
  await page.route(origin + "/studio/app.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: studioJavaScript }),
  );
}
try {
  await page.goto(origin + "/studio");
  await page.locator("#token").fill(token);
  await page.locator("#connect").click();
  await expect(page.locator("#connection-panel")).toBeHidden();
  await page.locator("#projects").selectOption(project.projectId);
  await expect(page.locator("#revision")).toContainText("Revision");
  await page.locator("#files").setInputFiles(
    [1, 2, 3].map((i) => ({
      name: "QA clip " + i + ".mp4",
      mimeType: "video/mp4",
      buffer,
    })),
  );
  await expect(page.locator(".media-card")).toHaveCount(3, { timeout: 90000 });
  await expect(page.locator("#save-state")).toHaveText("Saved locally", {
    timeout: 90000,
  });
  await page.locator("[data-add]").first().click();
  await expect(page.locator(".timeline-clip")).toHaveCount(1, {
    timeout: 30000,
  });
  await page.locator(".timeline-clip").first().click();
  const ruler = await page.locator("#ruler").boundingBox();
  await page.mouse.click(ruler.x + 4 * 16, ruler.y + 8);
  await expect(page.locator("#timecode")).toHaveText("00:04.00");
  // Allow multiple background refresh ticks to expose the historical snap-to-zero bug.
  await page.waitForTimeout(5500);
  await expect(page.locator("#timecode")).toHaveText("00:04.00");
  await page.locator("#split").click();
  await expect(page.locator(".timeline-clip")).toHaveCount(2);
  const splitProject = await api("GET", "/projects/" + project.projectId);
  const items = Object.values(splitProject.sequences)[0].tracks.flatMap(
    (t) => t.items,
  );
  if (items[0].timelineRange.duration.value !== 120)
    throw Error("Split did not preserve four seconds.");
  await page.locator("#undo").click();
  await expect(page.locator(".timeline-clip")).toHaveCount(1);
  // Pointer move and both trim handles persist into the canonical project.
  let clipBox = await page.locator(".timeline-clip").boundingBox();
  await page.mouse.move(clipBox.x + 25, clipBox.y + 20);
  await page.mouse.down();
  await page.mouse.move(clipBox.x + 57, clipBox.y + 20, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator("#clip-start")).toHaveValue("2.000");
  await page.locator("#clip-duration").fill("6");
  await page.locator("#apply-timing").click();
  await expect(page.locator("#clip-duration")).toHaveValue("6.000");
  let handle = await page.locator(".trim.right").boundingBox();
  await page.mouse.move(handle.x + 3, handle.y + 20);
  await page.mouse.down();
  await page.mouse.move(handle.x - 13, handle.y + 20, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator("#clip-duration")).toHaveValue("5.000");
  handle = await page.locator(".trim.left").boundingBox();
  await page.mouse.move(handle.x + 3, handle.y + 20);
  await page.mouse.down();
  await page.mouse.move(handle.x + 19, handle.y + 20, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator("#source-in")).toHaveValue("1.000");
  await expect(page.locator("#clip-start")).toHaveValue("3.000");
  await page.locator("[data-asset]").nth(1).click();
  await expect(page.locator("#preview")).toBeVisible();
  await expect(page.locator("#monitor-label")).toContainText("QA clip 2");
  // Deterministic analyzed moments; all resulting transactions use the real daemon.
  await page.route(origin + "/api/v1/assets/search", async (route) => {
    const req = route.request().postDataJSON();
    const assetId = req.assetIds[0];
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: [
          {
            assetId,
            artifactId: crypto.randomUUID(),
            segmentId: crypto.randomUUID(),
            type: "visual_semantic",
            score: 1,
            confidence: 0.95,
            labels: ["highlight"],
            text: "QA analyzed highlight fixture",
            range: {
              start: { value: 30, rate: { numerator: 30, denominator: 1 } },
              duration: { value: 90, rate: { numerator: 30, denominator: 1 } },
            },
          },
        ],
      }),
    });
  });
  // Fixture model decisions: regression runs must never incur GCP charges.
  await page.route(origin + "/api/v1/studio/ai/plan", async (route) => {
    const request = aiPlanRequestSchema.parse(route.request().postDataJSON());
    const current = await api("GET", "/projects/" + request.projectId);
    const sequence = current.sequences[current.settings.defaultSequenceId];
    const actions = [
      {
        type: "track",
        ref: "montage",
        name: "Highlights montage",
        kind: "video",
        label: "Create highlights track",
      },
    ];
    request.assetIds.forEach((assetId, index) =>
      actions.push({
        type: "add",
        ref: "shot_" + index,
        track: "montage",
        assetId,
        start: index * 3,
        source: 1,
        duration: 3,
        label: "Add analyzed source seconds 1–4",
      }),
    );
    sequence.tracks
      .filter((t) => t.enabled && t.items.length)
      .forEach((t) =>
        actions.push({
          type: "track_enabled",
          track: t.id,
          enabled: false,
          label: "Disable original track " + t.name,
        }),
      );
    const plan = {
      summary: "Fixture montage",
      clarification: "",
      warnings: [],
      actions,
    };
    const steps = compileAiPlan(current, plan, request);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          ...plan,
          steps,
          projectId: current.projectId,
          revision: current.revision,
          model: "fixture-not-live-gemini",
        },
      }),
    });
  });
  await page.locator("#agent-tab").click();
  await page.locator("#propose").click();
  await expect(page.locator("#approve")).toBeVisible({ timeout: 30000 });
  const before = await api("GET", "/projects/" + project.projectId);
  await expect(page.locator("#plan article")).toHaveCount(5);
  if (
    before.revision !==
    (await api("GET", "/projects/" + project.projectId)).revision
  )
    throw Error("Planning mutated the timeline.");
  // Approval is invalidated by an intervening manual edit.
  await page.locator("#add-video-track").click();
  await expect(page.locator("#revision")).not.toHaveText(
    "Revision " + before.revision,
  );
  await page.locator("#approve").click();
  await expect(page.locator("#toast")).toContainText("project changed");
  await page.locator("#propose").click();
  await expect(page.locator("#approve")).toBeVisible({ timeout: 30000 });
  // Stop before the first highlighted action commits.
  const stopRevision = (await api("GET", "/projects/" + project.projectId))
    .revision;
  await page.locator("#approve").click();
  await expect(page.locator("#agent-cursor")).toBeVisible();
  await page.locator("#stop").click();
  await expect(page.locator("#stop")).toBeHidden();
  if (
    (await api("GET", "/projects/" + project.projectId)).revision !==
    stopRevision
  )
    throw Error("Stop did not prevent the first edit.");
  await page.locator("#propose").click();
  await expect(page.locator("#approve")).toBeVisible({ timeout: 30000 });
  await page.locator("#approve").click();
  await expect(page.locator("#agent-log")).toContainText("Finished.", {
    timeout: 30000,
  });
  const after = await api("GET", "/projects/" + project.projectId);
  const tracks = Object.values(after.sequences)[0].tracks;
  const montage = tracks.find((t) => t.name === "Highlights montage");
  if (!montage || montage.items.length !== 3)
    throw Error("Montage is incomplete.");
  if (
    montage.items.map((i) => i.timelineRange.start.value).join(",") !==
    "0,90,180"
  )
    throw Error("Montage is not contiguous.");
  await page.locator("#start").click();
  await page.locator("#play").click();
  await expect
    .poll(() => page.locator("#timecode").textContent(), { timeout: 15000 })
    .toBe("00:09.00");
  await page.locator("#export").click();
  await expect(page.locator("#render")).toBeDisabled();
  await page.locator("#close-export").click();
  await page.locator("#start").click();
  await expect(page.locator("#preview")).toBeVisible();
  await page.locator("#properties-tab").click();
  await page.screenshot({ path: "studio-qa.png", fullPage: true });
  if (errors.length) throw Error(errors.join("\n"));
  console.log(
    "PASS: import, stored preview, stable seek, split, undo, drag, both trim handles, stale approval rejection, Stop, reviewed 3-clip montage, playback, export gate.",
  );
  console.log("QA project retained:", project.projectId);
} catch (error) {
  await page.screenshot({ path: "studio-qa.png", fullPage: true });
  console.error("Editor message:", await page.locator("#toast").textContent());
  if (errors.length) console.error("Browser errors:", errors);
  throw error;
} finally {
  await browser.close();
}
