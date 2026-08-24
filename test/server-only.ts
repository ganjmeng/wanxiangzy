// Vitest runs server route modules in Node/jsdom rather than through Next's
// conditional export resolver. The production package still enforces the
// server-only boundary; tests use this inert alias so route contracts can load.
export {};
