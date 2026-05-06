import {
  createUIMessageStream,
  type InferUIMessageChunk,
  type UIMessage,
  type UIMessageStreamOnFinishCallback,
} from "ai";

export function createOriginalMessagesPreservingStream<
  UI_MESSAGE extends UIMessage = UIMessage,
>({
  originalMessages,
  source,
  onError,
  onFinish,
}: {
  originalMessages: UI_MESSAGE[];
  source: ReadableStream<InferUIMessageChunk<UI_MESSAGE>>;
  onError?: (error: unknown) => string;
  onFinish?: UIMessageStreamOnFinishCallback<UI_MESSAGE>;
}) {
  return createUIMessageStream<UI_MESSAGE>({
    originalMessages,
    onError,
    onFinish,
    execute: async ({ writer }) => {
      const reader = source.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          writer.write(value);
        }
      } finally {
        reader.releaseLock();
      }
    },
  });
}
