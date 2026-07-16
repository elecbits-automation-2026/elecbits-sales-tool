// The prototype persists through the Claude artifact sandbox's `window.storage`
// API. Declared here so TypeScript accepts it. Replaced by Supabase in the
// backend migration (see README).
interface Window {
  storage?: {
    get: (key: string, json?: boolean) => Promise<{ value: string } | null>;
    set: (key: string, value: string, json?: boolean) => Promise<unknown>;
  };
}
