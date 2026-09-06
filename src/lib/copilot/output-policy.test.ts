import { describe, expect, it } from "vitest";
import { readUIMessageStream, type UIMessageChunk } from "ai";
import allowedConfig from "../../../config/allowed-numerals.json";
import cases from "../../../e2e/fixtures/copilot-output-cases.json";
import { checkResponse, checkResponsePolicy, classifyIntent, foldStreamChunks, type AllowedNumerals } from "./guard";

const allowed = allowedConfig as AllowedNumerals;

describe("model-output assertions and legitimate explanations", () => {
  for (const entry of cases) {
    it(`${entry.id}: ${entry.refusal ?? "answer"}`, () => {
      expect(classifyIntent(`Explain my report using example ${entry.id}.`, {kind:"self",displayLabel:"You"}).intent).toBe("allowed");
      const result = checkResponse(entry.answer, [], allowed);
      if (entry.refusal) expect(result).toMatchObject({ok:false,violation:entry.refusal});
      else expect(result).toEqual({ok:true});
    });
  }
  it("keeps affirmative statements separate from an earlier refusal frame", () => {
    expect(checkResponsePolicy("I cannot say you have cancer, but you have diabetes.").intent).toBe("diagnosis");
    expect(checkResponsePolicy("This is not evidence that you have cancer.").intent).toBe("allowed");
  });
});

describe("the output guard reads the same stream text the client receives", () => {
  it("reassembles every character partition of each adversarial reply", () => {
    for (const entry of cases.filter(c=>c.refusal)) {
      for (let split=0; split<=entry.answer.length; split++) {
        const chunks: UIMessageChunk[] = [
          {type:"text-start",id:"t"},
          {type:"text-delta",id:"t",delta:entry.answer.slice(0,split)},
          {type:"text-delta",id:"t",delta:entry.answer.slice(split)},
          {type:"text-end",id:"t"},
        ];
        const folded=foldStreamChunks(chunks);
        expect(folded.text).toBe(entry.answer);
        expect(checkResponse(folded.text, folded.toolJson, allowed)).toMatchObject({ok:false,violation:entry.refusal});
      }
    }
  });
  it("never turns an unsupported percentage into individually permitted digits", () => {
    const folded=foldStreamChunks([
      {type:"text-delta",id:"t",delta:"About 3"},
      {type:"text-delta",id:"t",delta:"7"},
      {type:"text-delta",id:"t",delta:".5"},
      {type:"text-delta",id:"t",delta:"% of people."},
    ]);
    expect(checkResponse(folded.text,[],allowed)).toMatchObject({ok:false,violation:"unsupported-number",unsupported:["37.5%"]});
  });
  it("preserves first-part order when text and reasoning deltas interleave", () => {
    expect(foldStreamChunks([
      {type:"text-delta",id:"same",delta:"Hello "},
      {type:"reasoning-delta",id:"same",delta:"A thought"},
      {type:"text-delta",id:"same",delta:"there."},
    ]).text).toBe("Hello there.\nA thought");
  });
  it("matches the SDK client assembler when starts and deltas arrive in different orders", async () => {
    const chunks: UIMessageChunk[] = [
      { type: "start", messageId: "synthetic-answer" },
      { type: "text-start", id: "first" },
      { type: "text-start", id: "second" },
      { type: "text-delta", id: "second", delta: "Second part." },
      { type: "text-delta", id: "first", delta: "First part." },
      { type: "text-end", id: "first" },
      { type: "text-end", id: "second" },
      { type: "finish" },
    ];
    const stream = new ReadableStream<UIMessageChunk>({
      start(controller) {
        chunks.forEach(chunk => controller.enqueue(chunk));
        controller.close();
      },
    });
    let clientText = "";
    for await (const message of readUIMessageStream({ stream, terminateOnError: true })) {
      clientText = message.parts.flatMap(part => part.type === "text" ? [part.text] : []).join("\n");
    }
    expect(clientText).toBe("First part.\nSecond part.");
    expect(foldStreamChunks(chunks).text).toBe(clientText);
  });
});
