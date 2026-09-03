import { buildKieImageRequest } from "../lib/api/kie-image";
import { runKieMarketTask } from "../lib/api/kie-market";
import type { PricedImageModel } from "../lib/model-pricing";

if (!process.argv.includes("--live")) {
  throw new Error("This script creates billable image tasks. Re-run with --live.");
}

const cases: Array<{ model: PricedImageModel; keyEnv: string }> = [
  { model: "nano-banana-2", keyEnv: "KIE_BANANA_API_KEY" },
  { model: "nano-banana-2-lite", keyEnv: "KIE_BANANA_API_KEY" },
  { model: "nano-banana-pro", keyEnv: "KIE_BANANA_API_KEY" },
  { model: "gpt-image-2", keyEnv: "KIE_GPT_IMAGE_API_KEY" },
  { model: "qwen3", keyEnv: "KIE_QWEN_API_KEY" },
  { model: "qwen3-pro", keyEnv: "KIE_QWEN_API_KEY" },
  { model: "z-image", keyEnv: "KIE_QWEN_API_KEY" },
];

const selected = new Set(readSelectedModels());

async function main() {
  const results: Array<{ model: string; ok: boolean; taskId?: string; error?: string }> = [];
  for (const item of cases.filter((entry) => !selected.size || selected.has(entry.model))) {
    const apiKey = required(item.keyEnv);
    const request = buildKieImageRequest({
      model: item.model,
      prompt: "A single white ceramic cup centered on a clean light gray studio background, soft shadow, product photography, no text",
      aspectRatio: "1:1",
      imageSize: "1K",
    });
    try {
      const result = await runKieMarketTask({
        apiBase: "https://api.kie.ai",
        apiKey,
        model: request.model,
        modelInput: request.input,
      });
      results.push({ model: item.model, ok: true, taskId: result.taskId });
      console.log(`${item.model}: success`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      results.push({ model: item.model, ok: false, error: message });
      console.error(`${item.model}: failed - ${message}`);
    }
  }
  if (results.some((result) => !result.ok)) process.exitCode = 1;
}

function readSelectedModels() {
  const index = process.argv.indexOf("--models");
  if (index < 0) return [];
  return String(process.argv[index + 1] || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

void main();
