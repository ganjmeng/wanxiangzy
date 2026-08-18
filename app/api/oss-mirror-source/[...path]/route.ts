import {
  resolveOssMirrorSource,
  validateOssMirrorRuntimeConfig,
} from "@/lib/api/oss-mirror-transfer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  try {
    const { path } = await context.params;
    const objectKey = path.join("/");
    const sourceUrl = await resolveOssMirrorSource(objectKey);
    if (!sourceUrl) return notFound();

    return new Response(null, {
      status: 302,
      headers: {
        Location: sourceUrl,
        "Cache-Control": "private, no-store, max-age=0",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.warn(
      "[oss-mirror-source] resolver rejected request:",
      error instanceof Error ? error.message : String(error),
    );
    return notFound();
  }
}

export async function HEAD(
  _request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  if (path.join("/") !== "__health") return notFound();
  try {
    validateOssMirrorRuntimeConfig();
    return new Response(null, {
      status: 204,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error(
      "[oss-mirror-source] runtime configuration is invalid:",
      error instanceof Error ? error.message : String(error),
    );
    return new Response(null, {
      status: 503,
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  }
}

function notFound() {
  return new Response("Not Found", {
    status: 404,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
