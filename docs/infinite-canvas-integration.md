# Infinite Canvas Integration

The VastWearGen infinite canvas feature is adapted from the open-source project `basketikun/infinite-canvas`.

- Upstream source: https://github.com/basketikun/infinite-canvas
- Preserved upstream materials: `tools/infinite-canvas/`
- Canvas route: `/infinite-canvas`
- Editor route: `/infinite-canvas/[id]`

The integration keeps the upstream canvas project library, editor, nodes, connections, prompt library, asset handling, import/export, and local-first storage model. Platform-specific Agent, generation, uploads, auth, credits, and cloud sync are routed through VastWearGen APIs. The upstream localhost Agent can still be enabled for development, but it is disabled by default in product builds.

## Local ENV

The canvas integration is configured through `.env.local` and mirrored in `.env.local.example`.

- `NEXT_PUBLIC_INFINITE_CANVAS_LOCAL_AGENT_URL`: default local Agent endpoint when local Agent mode is enabled.
- `NEXT_PUBLIC_INFINITE_CANVAS_LOCAL_AGENT_ENABLED`: enables the upstream localhost Agent mode. Current product default is `false`.
- `NEXT_PUBLIC_INFINITE_CANVAS_CLOUD_SYNC_ENABLED`: enables browser-to-platform Supabase sync. Set to `false` for local-only development.
- `NEXT_PUBLIC_INFINITE_CANVAS_PLATFORM_AGENT_ENABLED`: enables the platform Agent mode. Current product default is `true`; it uses `/api/infinite-canvas/agent` and server-side LLM ENV.
- `NEXT_PUBLIC_INFINITE_CANVAS_VERSION_CHECK_ENABLED`: enables upstream version/changelog fetches.
- `NEXT_PUBLIC_INFINITE_CANVAS_VERSION_URL`: version file URL used by the release modal.
- `NEXT_PUBLIC_INFINITE_CANVAS_CHANGELOG_URL`: changelog URL used by the release modal.
- `INFINITE_CANVAS_TEXT_TIMEOUT_MS`: server timeout for canvas text/image-question requests.
- `INFINITE_CANVAS_TEXT_PROVIDER`, `INFINITE_CANVAS_TEXT_BASE_URL`, `INFINITE_CANVAS_TEXT_API_KEY`, `INFINITE_CANVAS_TEXT_MODEL`: optional server-only LLM override for text-only canvas calls.
- `INFINITE_CANVAS_VISION_PROVIDER`, `INFINITE_CANVAS_VISION_BASE_URL`, `INFINITE_CANVAS_VISION_API_KEY`, `INFINITE_CANVAS_VISION_MODEL`: optional server-only LLM override for canvas calls with image references.

Leave the text/vision override values empty to reuse the platform-wide `ANALYZE_LLM_PROVIDER`, `XIAOMI_MIMO_*`, and `LINGYA_*` settings.
