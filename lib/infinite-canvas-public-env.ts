const DEFAULT_LOCAL_AGENT_URL = "http://127.0.0.1:17371";
const DEFAULT_VERSION_URL = "https://raw.githubusercontent.com/basketikun/infinite-canvas/main/VERSION";
const DEFAULT_CHANGELOG_URL = "https://raw.githubusercontent.com/basketikun/infinite-canvas/main/CHANGELOG.md";

function readPublicBoolean(value: string | undefined, fallback: boolean) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return fallback;
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function readPublicString(value: string | undefined, fallback = "") {
  const normalized = value?.trim();
  return normalized || fallback;
}

export const INFINITE_CANVAS_LOCAL_AGENT_URL = readPublicString(
  process.env.NEXT_PUBLIC_INFINITE_CANVAS_LOCAL_AGENT_URL,
  DEFAULT_LOCAL_AGENT_URL,
);

export const INFINITE_CANVAS_LOCAL_AGENT_ENABLED = readPublicBoolean(
  process.env.NEXT_PUBLIC_INFINITE_CANVAS_LOCAL_AGENT_ENABLED,
  false,
);

export const INFINITE_CANVAS_CLOUD_SYNC_ENABLED = readPublicBoolean(
  process.env.NEXT_PUBLIC_INFINITE_CANVAS_CLOUD_SYNC_ENABLED,
  false,
);

export const INFINITE_CANVAS_PLATFORM_AGENT_ENABLED = readPublicBoolean(
  process.env.NEXT_PUBLIC_INFINITE_CANVAS_PLATFORM_AGENT_ENABLED,
  true,
);

export const INFINITE_CANVAS_VERSION_CHECK_ENABLED = readPublicBoolean(
  process.env.NEXT_PUBLIC_INFINITE_CANVAS_VERSION_CHECK_ENABLED,
  true,
);

export const INFINITE_CANVAS_VERSION_URL = readPublicString(
  process.env.NEXT_PUBLIC_INFINITE_CANVAS_VERSION_URL,
  DEFAULT_VERSION_URL,
);

export const INFINITE_CANVAS_CHANGELOG_URL = readPublicString(
  process.env.NEXT_PUBLIC_INFINITE_CANVAS_CHANGELOG_URL,
  DEFAULT_CHANGELOG_URL,
);
