import { Router } from "express";
import { z } from "zod";
import { authOf, requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { getCharts, getRecentActivities, getSummary } from "./dashboard.service.js";

const periodQuery = z.object({
  days: z.coerce.number().int().refine((d) => [7, 30, 90].includes(d), "Período deve ser 7, 30 ou 90").default(30),
});
const activityQuery = z.object({ limit: z.coerce.number().int().min(1).max(50).default(10) });

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

dashboardRouter.get("/summary", validate(periodQuery, "query"), async (req, res) => {
  const { days } = req.query as unknown as z.infer<typeof periodQuery>;
  res.json(await getSummary(authOf(req).organizationId, days));
});

dashboardRouter.get("/charts", validate(periodQuery, "query"), async (req, res) => {
  const { days } = req.query as unknown as z.infer<typeof periodQuery>;
  res.json(await getCharts(authOf(req).organizationId, days));
});

dashboardRouter.get("/activities", validate(activityQuery, "query"), async (req, res) => {
  const { limit } = req.query as unknown as z.infer<typeof activityQuery>;
  res.json(await getRecentActivities(authOf(req).organizationId, limit));
});
