// What the library assumes of the Workers runtime for Product.find(id) (#77), checked inside
// workerd: see tests/integration/workerd-platform.test.ts.
import { env as moduleEnv } from "cloudflare:workers";

export default {
  async fetch(_request, env) {
    const builtin = globalThis.process?.getBuiltinModule?.("node:async_hooks");
    return Response.json({
      sameBinding: moduleEnv.DB === env.DB,
      dynamicImport: (await import("cloudflare:workers")).env.DB === env.DB,
      asyncLocalStorage: typeof builtin?.AsyncLocalStorage === "function",
    });
  },
};
