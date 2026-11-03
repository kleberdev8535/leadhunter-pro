import type { HandlerMap } from "../../tasks/services/task-runner.js";
import { huntLeads, refreshLeads } from "./hunter.worker.js";
import { importToCrm, qualifyLeads } from "./crm.workers.js";
import { writeMessages } from "./writer.worker.js";
import { buildReport } from "./metrics.worker.js";

/** Cada tipo de tarefa tem exatamente um handler; não existe handler genérico. */
export const HANDLERS: HandlerMap = {
  SEARCH_LEADS: huntLeads,
  UPDATE_LEADS: refreshLeads,
  QUALIFY_LEADS: qualifyLeads,
  IMPORT_TO_CRM: importToCrm,
  GENERATE_MESSAGES: writeMessages,
  GENERATE_REPORT: buildReport,
};
