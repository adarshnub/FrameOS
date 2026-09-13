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
