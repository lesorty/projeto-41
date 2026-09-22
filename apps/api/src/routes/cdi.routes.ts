import type { RoutePlugin } from "./index.js";

export const registerCdiRoutes: RoutePlugin = (app, { cdiService }) => {
  if (!cdiService) return;

  /** Fonte do selo "dados até <data>" na interface. */
  app.get("/api/cdi/status", async () => cdiService.status());

  app.post("/api/cdi/refresh", async () => {
    const result = await cdiService.refresh();
    return { ...result, status: await cdiService.status() };
  });
};
