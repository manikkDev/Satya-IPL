import OpenAI from "openai";
import env from "../config/env.js";

const FEATHERLESS_BASE_URL = env.FEATHERLESS_BASE_URL || "https://api.featherless.ai/v1";
const FEATHERLESS_API_KEY = env.FEATHERLESS_API_KEY;
const FEATHERLESS_MODEL = env.FEATHERLESS_MODEL || "Qwen/Qwen2.5-32B-Instruct";

const featherlessClient = FEATHERLESS_API_KEY
  ? new OpenAI({ baseURL: FEATHERLESS_BASE_URL, apiKey: FEATHERLESS_API_KEY })
  : null;

export async function runFeatherlessChat({
  system = "You are a helpful assistant.",
  user,
  model = FEATHERLESS_MODEL,
  maxTokens = 4096,
} = {}) {
  if (!featherlessClient) {
    throw new Error("FEATHERLESS_API_KEY is not set");
  }
  if (!user) {
    throw new Error("User message is required");
  }

  const completion = await featherlessClient.chat.completions.create({
    model,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  const choices = Array.isArray(completion?.choices) ? completion.choices : [];
  return choices.map((choice) => choice?.message?.content ?? "").filter(Boolean);
}

export default featherlessClient;
