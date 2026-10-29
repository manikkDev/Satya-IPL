// smokeLive.mjs — manual live check of the Gemini key pool.
// Uses real keys from the gitignored .env. Hard-capped at 5 API requests.
// Never prints keys or prompts — aliases, models, latency, token counts only.
// Usage: npm run smoke:live

import "dotenv/config";

const MAX_REQUESTS = 5;
let spent = 0;

const { initLlm, llmHealth } = await import("../src/llm/index.js");
const { pool, client, ladders, gateway, config } = await initLlm();

console.log(`[smoke] ${config.keys.length} key(s), dataPolicy=${config.dataPolicy}`);
console.log(`[smoke] chat ladder: ${ladders.forTask("chat").join(" → ")}`);

// 1 request: models.list through the first eligible key.
const pick = pool.select(ladders.forTask("chat")[0]);
if (pick && spent < MAX_REQUESTS) {
  spent += 1;
  try {
    const names = await client.listModels(pick.key);
    console.log(`[smoke] models.list via ${pick.alias}: ${names.length} model(s) visible`);
    ladders.applyAvailability(names);
    console.log(`[smoke] chat ladder after availability filter: ${ladders.forTask("chat").join(" → ")}`);
  } catch (error) {
    console.warn(`[smoke] models.list failed: ${error.message}`);
    if (error.classified) pool.recordError(pick.alias, ladders.forTask("chat")[0], error.classified, error.httpStatus);
  }
}

// ≤2 requests: tiny generation via the gateway (uses its own key accounting).
if (spent < MAX_REQUESTS) {
  const started = Date.now();
  const out = await gateway.generate("understand", {
    contents: [{ role: "user", parts: [{ text: "Reply with the single word: ready" }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 8 },
  });
  spent += out.attempts || 1;
  console.log(
    out.ok
      ? `[smoke] generate ok via ${out.keyAlias} model=${out.model} provider=${out.provider} ms=${Date.now() - started} in=${out.usage.inputTokens} out=${out.usage.outputTokens}`
      : `[smoke] generate failed: ${out.reason} (copilot would answer evidence-only)`,
  );
}

console.log(`[smoke] health: ${JSON.stringify(llmHealth())}`);
console.log(`[smoke] requests spent: ${spent}/${MAX_REQUESTS}`);
await pool.close();
process.exit(0);
