// Automation wiring: job handlers for automatic checks / bank allocation and
// the daily scheduler. Started from startJobRunner() so the API entrypoint
// needs no extra hook; idempotent.
import { registerHandler } from "./runner.js";
import { runAutoCheck } from "../services/autoChecks.js";
import { runBankAllocate } from "../services/importers/index.js";
import { startScheduler } from "./scheduler.js";

let started = false;
export const startAutomation = () => {
  if (started) return;
  started = true;
  registerHandler("autocheck", runAutoCheck);
  registerHandler("bankallocate", runBankAllocate);
  startScheduler();
};
