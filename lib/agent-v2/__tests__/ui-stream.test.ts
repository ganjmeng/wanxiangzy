import { describe, expect, it } from "vitest";
import type { InferUIMessageChunk, UIMessage } from "ai";
import { createOriginalMessagesPreservingStream } from "@/lib/agent-v2/ui-stream";

function makeSourceStream(chunks: InferUIMessageChunk<UIMessage>[]) {
  return new ReadableStream<InferUIMessageChunk<UIMessage>>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

describe("agent-v2 UI stream helpers", () => {
  it("preserves original user messages when forwarding a provider stream", async () => {
    const originalMessages: UIMessage[] = [
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "帮我分析图片" }],
      },
    ];
    const source = makeSourceStream([
      { type: "start", messageId: "assistant-1" },
      { type: "text-start", id: "text-1" },
      { type: "text-delta", id: "text-1", delta: "可以，我来分析。" },
      { type: "text-end", id: "text-1" },
      { type: "finish", finishReason: "stop" },
    ]);

    let resolveFinished!: (messages: UIMessage[]) => void;
    const finished = new Promise<UIMessage[]>((resolve) => {
      resolveFinished = resolve;
    });
    const stream = createOriginalMessagesPreservingStream({
      originalMessages,
      source,
      onFinish: ({ messages }) => {
        resolveFinished(messages);
      },
    });

    await stream.pipeTo(new WritableStream({ write() {} }));
    const finishedMessages = await finished;

    expect(finishedMessages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(finishedMessages[0]?.parts).toEqual(originalMessages[0].parts);
    expect(finishedMessages[1]?.parts[0]).toMatchObject({
      type: "text",
      text: "可以，我来分析。",
      state: "done",
    });
  });
});
