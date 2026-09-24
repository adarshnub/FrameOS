import { createContext, Script } from "node:vm";
import { randomUUID } from "node:crypto";
import { operationSchema } from "@frameos/contracts";
import { describe, expect, it } from "vitest";
import { studioHtml, studioJavaScript } from "./editor.js";

function editorModel() {
  const context = createContext({
    sessionStorage: { getItem: () => "" },
    crypto: { randomUUID },
  });
  // Execute the actual shipped model and command builders, before DOM bindings.
  new Script(
    studioJavaScript.slice(0, studioJavaScript.indexOf("let pointer=null;")),
  ).runInContext(context);
  return (code: string) => new Script(code).runInContext(context);
}

describe("visual Studio", () => {
  it("applies an advanced proposal once and retries an uncertain response with the same transaction key", async () => {
    const elements = Object.fromEntries(
      ["approve", "propose", "plan-status"].map((id) => [
        id,
        { hidden: false, disabled: false, textContent: "" },
      ]),
    );
    const calls: any[] = [];
    let fail = true;
    const context = createContext({
      crypto: { randomUUID },
      sessionStorage: { getItem: () => "" },
      document: { getElementById: (id: string) => elements[id] },
      pause: () => {},
      log: () => {},
      toast: () => {},
      renderTimeline: () => {},
      showFrame: async () => {},
      applyProjectSnapshot: () => {},
      api: async (_method: string, _path: string, body: unknown) => {
        calls.push(body);
        if (fail) throw Error("Connection lost");
        return { project: { projectId: "p", revision: 1 } };
      },
    });
    new Script(
      studioJavaScript.slice(0, studioJavaScript.indexOf("let pointer=null;")),
    ).runInContext(context);
    new Script(
      studioJavaScript
        .slice(
          studioJavaScript.indexOf("async function approveAdvancedPlan("),
          studioJavaScript.indexOf("async function approvePlan("),
        )
        .replace(
          "async function approveAdvancedPlan",
          "async function testedApprove",
        ),
    ).runInContext(context);
    new Script(
      "state.project={projectId:'p',revision:0};state.plan={projectId:'p',revision:0,steps:[{op:{type:'one'}},{op:{type:'two'}}]}; pause=()=>{};applyProjectSnapshot=()=>{};renderTimeline=()=>{};showFrame=async()=>{};toast=()=>{};",
    ).runInContext(context);
    // The model defines api itself; replace it with the controlled transport.
    context.transport = async (_m: string, _p: string, b: unknown) => {
      calls.push(b);
      if (fail) throw Error("Connection lost");
      return { project: { projectId: "p", revision: 1 } };
    };
    new Script("api=transport").runInContext(context);
    await expect(
      new Script("testedApprove(state.plan)").runInContext(context),
    ).rejects.toThrow("Connection lost");
    fail = false;
    await new Script("testedApprove(state.plan)").runInContext(context);
    expect(calls).toHaveLength(2);
    expect(calls[0].operations).toHaveLength(2);
    expect(calls[1].idempotencyKey).toBe(calls[0].idempotencyKey);
    expect(new Script("state.plan").runInContext(context)).toBeNull();
  });
  it("continues a batch import after a bad file and keeps saved assets when preview fails", async () => {
    const elements = {
      files: {
        files: [1, 2, 3].map((n) => ({
          name: `clip-${n}.mp4`,
          type: "video/mp4",
        })),
        value: "selected",
      },
      "save-state": { textContent: "" },
    };
    const requests: string[] = [];
    const context = createContext({
      sessionStorage: { getItem: () => "" },
      crypto: { randomUUID },
      document: { getElementById: (id: keyof typeof elements) => elements[id] },
      FormData: class {
        append() {}
      },
      fetch: async (url: string) => {
        requests.push(url);
        if (requests.length === 2)
          return {
            ok: false,
            json: async () => ({ error: { message: "Invalid source" } }),
          };
        return {
          ok: true,
          json: async () => ({
            data: {
              asset: { id: `asset-${requests.length}` },
              transaction: {
                project: {
                  projectId: "p",
                  revision: requests.length === 1 ? 1 : 2,
                },
              },
            },
          }),
        };
      },
    });
    new Script(
      studioJavaScript.slice(0, studioJavaScript.indexOf("let pointer=null;")),
    ).runInContext(context);
    new Script(
      studioJavaScript.slice(
        studioJavaScript.indexOf("async function importFiles(){"),
        studioJavaScript.indexOf("function renderReference()"),
      ),
    ).runInContext(context);
    new Script(
      "state.project={projectId:'p',revision:0};pause=()=>{};applyProjectSnapshot=p=>state.project=p;renderMedia=()=>{};updateHead=()=>{};mediaDuration=async()=>300;showFrame=async()=>{throw Error('Unsupported browser codec');};toast=message=>state.message=message;",
    ).runInContext(context);
    await new Script("importFiles()").runInContext(context);
    expect(requests).toHaveLength(3);
    expect(requests[2]).toContain("baseRevision=1");
    expect(new Script("state.project.revision").runInContext(context)).toBe(2);
    expect(new Script("[...state.checked]").runInContext(context)).toEqual([
      "asset-1",
      "asset-3",
    ]);
    expect(new Script("state.message").runInContext(context)).toContain(
      "2 file(s) imported.",
    );
    expect(new Script("state.message").runInContext(context)).toContain(
      "Unsupported browser codec",
    );
    expect(new Script("state.busy").runInContext(context)).toBe(false);
    expect(elements.files.value).toBe("");
  });
  it("fits a fifty-minute timeline and keeps the ruler bounded", () => {
    const run = editorModel();
    const zoom = run("fitZoom(1100,3000)") as number;
    expect(zoom * 3000).toBeLessThan(1000);
    expect(run(`3000/rulerStep(${zoom})`)).toBeLessThan(25);
  });

  it("ends at enabled content including captions", () => {
    const run = editorModel();
    run(
      "state.project={settings:{defaultSequenceId:'s'},sequences:{s:{format:{frameRate:{numerator:30,denominator:1}},tracks:[{enabled:true,items:[{enabled:true,timelineRange:range(0,3000)},{enabled:false,timelineRange:range(3000,3000)}]}],captions:[{enabled:true,cues:[{range:range(3000,2)}]}]}}}",
    );
    expect(run("duration()")).toBe(3002);
    expect(
      run("state.project.sequences.s.captions[0].enabled=false;duration()"),
    ).toBe(3000);
  });

  it("shares a streaming session without downloading whole media files", async () => {
    const calls: unknown[] = [];
    const context = createContext({
      sessionStorage: { getItem: () => "" },
      crypto: { randomUUID },
      fetch: async (...args: unknown[]) => {
        calls.push(args);
        return {
          ok: true,
          json: async () => ({ data: { expiresInSeconds: 28800 } }),
        };
      },
    });
    new Script(
      studioJavaScript.slice(0, studioJavaScript.indexOf("let pointer=null;")),
    ).runInContext(context);
    const result = await new Script(
      "state.project={projectId:'p'};Promise.all(Array.from({length:10},(_,i)=>mediaUrl({id:'asset-'+i})))",
    ).runInContext(context);
    expect(calls).toHaveLength(1);
    expect(result).toHaveLength(10);
    expect(result[9]).toBe("/api/v1/projects/p/assets/asset-9/content");
  });
  it("previews caption cues only within their active range", () => {
    const run = editorModel();
    run(
      `state.project={settings:{defaultSequenceId:'s'},sequences:{s:{tracks:[],captions:[{enabled:true,cues:[{text:'welcome to frameos',range:{start:{value:90,rate:{numerator:30,denominator:1}},duration:{value:120,rate:{numerator:30,denominator:1}}}}]}]}}}`,
    );
    for (const [at, expected] of [
      [2.9, ""],
      [3, "welcome to frameos"],
      [5, "welcome to frameos"],
      [7, ""],
    ] as const) {
      expect(run(`state.playhead=${at};overlayText()`)).toBe(expected);
    }
    expect(
      run(
        "state.project.sequences.s.captions[0].enabled=false;state.playhead=5;overlayText()",
      ),
    ).toBe("");
  });
  it("ships valid browser JavaScript and unique DOM IDs", () => {
    expect(() => new Script(studioJavaScript)).not.toThrow();
    const ids = [...studioHtml.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("converts rational time to seconds without shrinking the timeline 1000x", () => {
    const run = editorModel();
    expect(run("seconds({value:300,rate:{numerator:30,denominator:1}})")).toBe(
      10,
    );
    expect(
      run("seconds({value:62000,rate:{numerator:1000,denominator:1}})"),
    ).toBe(62);
    expect(
      run("seconds({value:30000,rate:{numerator:30000,denominator:1001}})"),
    ).toBe(1001);
    expect(run("seconds(time(10))")).toBe(10);
  });

  it("maps timeline position through the clip source in-point", () => {
    const run = editorModel();
    expect(
      run("sourceAt({timelineRange:range(20,5),sourceRange:range(8,5)},22)"),
    ).toBe(10);
    expect(
      run("sourceAt({timelineRange:range(20,5),sourceRange:range(8,10)},22)"),
    ).toBe(12);
  });

  it("previews ramp segments, holds and reverse using their source maps", () => {
    const run = editorModel();
    run(
      "var clip={timelineRange:range(10,8),sourceRange:range(2,6),timeMap:[{time:time(0),value:60},{time:time(2),value:90},{time:time(4),value:90},{time:time(8),value:240}]};",
    );
    expect(run("sourceAt(clip,11)")).toBe(2.5);
    expect(run("sourceAt(clip,13)")).toBe(3);
    expect(run("playbackRateAt(clip,13)")).toBe(0);
    expect(run("playbackRateAt(clip,16)")).toBe(1.25);
    run("clip.timeMap=[{time:time(0),value:240},{time:time(8),value:60}]");
    expect(run("sourceAt(clip,14)")).toBe(5);
    expect(run("playbackRateAt(clip,14)")).toBe(-0.75);
  });

  it("combines gain, fades and timeline ducking for audible preview", () => {
    const run = editorModel();
    run(
      "var sound={timelineRange:range(10,6),audio:{gainDb:0},effects:[{enabled:true,capabilityId:'frameos.audio.channel-strip',parameters:{fades:[{kind:'in',duration:time(2),curve:'linear'}],timelineDuck:{start:2,end:4,reductionDb:20,attack:.1,release:.5}}}]};",
    );
    expect(run("audioLevel(sound,10)")).toBe(0);
    expect(run("audioLevel(sound,11)")).toBe(0.5);
    expect(run("audioLevel(sound,13)")).toBeCloseTo(0.1);
    expect(run("audioLevel(sound,15)")).toBe(1);
  });

  it("uses public typed operations and preserves the requested drop position", () => {
    const run = editorModel();
    const result = run(
      "operation('item.add',{sequenceId:uid(),trackId:uid(),item:clipObject({id:uid(),name:'Sample'},12,3,5)})",
    );
    expect(
      operationSchema.safeParse(JSON.parse(JSON.stringify(result))).success,
    ).toBe(true);
    expect(result.arguments.item.timelineRange.start.value).toBe(360);
    expect(result.arguments.item.sourceRange.start.value).toBe(90);
  });

  it("does not let media timeupdate events overwrite a paused playhead", () => {
    expect(studioJavaScript).not.toContain("addEventListener('timeupdate'");
    expect(studioJavaScript).toContain(
      "if(state.playing)state.raf=requestAnimationFrame(tick)",
    );
  });
});
