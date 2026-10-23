// What `npx wrangler types` generates from a Worker's config: its bindings.
interface Env {
  DB: D1Database;
  LOGS: D1Database; // the Multiple databases page's second database
}
