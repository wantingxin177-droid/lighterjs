import { createRouter, publicQuery } from "./middleware";
import { nodeRouter } from "./nodeRouter";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  node: nodeRouter,
});

export type AppRouter = typeof appRouter;
