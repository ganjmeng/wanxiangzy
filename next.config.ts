import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();
const staticAssetCacheControl =
  process.env.NODE_ENV === "production"
    ? "public, max-age=31536000, immutable"
    : "no-store, must-revalidate";
/**
 * Next dev reuses stable chunk filenames. Some browsers can keep an older
 * `immutable` response from a previous server run, which mixes an old React
 * tree with the current CSS after a restart. Give every dev process its own
 * deployment id so a normal reload always addresses the current chunks.
 */
const developmentDeploymentId =
  process.env.NODE_ENV === "development"
    ? `studio-dev-${Date.now().toString(36)}`
    : undefined;

const nextConfig: NextConfig = {
  // `next build` deletes and rewrites its output directory. Keep development
  // artifacts separate so release checks can run while the local dev server is
  // serving pages without invalidating manifests or CSS chunks mid-request.
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  // BullMQ 6 exposes optional Valkey backends that are selected at runtime.
  // Keep queue clients as Node server dependencies so webpack does not try to
  // bundle optional drivers into admin route chunks.
  serverExternalPackages: ["bullmq", "ioredis"],
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...(config.resolve.fallback || {}),
        crypto: false,
      };
    }
    return config;
  },
  compress: true,
  deploymentId: developmentDeploymentId,
  poweredByHeader: false,
  reactStrictMode: true,
  outputFileTracingRoot: process.cwd(),
  experimental: {
    serverActions: {
      bodySizeLimit: "20mb",
    },
    optimizePackageImports: [
      "lucide-react",
      "@radix-ui/react-icons",
    ],
    webpackBuildWorker: true,
    // 路由级 View Transition（浏览器原生 API，Chromium 111+ / Safari 18.2+）
    viewTransition: true,
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.supabase.co" },
      { protocol: "https", hostname: "replicate.delivery" },
      { protocol: "https", hostname: "**.fashn.ai" },
      { protocol: "https", hostname: "**.sssai.vip" },
      { protocol: "https", hostname: "i.ibb.co" },
      { protocol: "https", hostname: "t.filesystem.site" },
      { protocol: "https", hostname: "vasthk.cn-hongkong.thepacificgls.com" },
      { protocol: "https", hostname: "cn-hongkong.thepacificgls.com" },
      { protocol: "https", hostname: "webstatic.aiproxy.vip" },
      { protocol: "https", hostname: "oss.filenest.top" },
      // Kie Market image results are currently served from this short-lived
      // public host before they are mirrored into our canonical OSS assets.
      { protocol: "https", hostname: "tempfile.aiquickdraw.com" },
    ],
    formats: ["image/avif", "image/webp"],
    unoptimized: true, // disable next/image server-side Sharp processing on the 1.9G EC2 box
    minimumCacheTTL: 60,
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
  },
  async headers() {
    return [
      // Production chunks are content-hashed. Development chunks reuse stable
      // filenames, so long-lived caching there serves stale React trees after a
      // restart and can cause hydration mismatches.
      {
        source: "/_next/static/(.*)",
        headers: [
          { key: "Cache-Control", value: staticAssetCacheControl },
        ],
      },
      // Public assets (images, fonts)
      {
        source: "/assets/(.*)\\.(svg|png|jpg|jpeg|gif|webp|avif|ico|woff2?)",
        headers: [
          { key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=86400" },
        ],
      },
      // Security headers (all routes)
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https://*.supabase.co https://replicate.delivery https://*.fashn.ai https://*.sssai.vip https://i.ibb.co https://*.ibb.co https://t.filesystem.site https://*.oss-cn-hongkong.aliyuncs.com https://*.oss-cn-hangzhou.aliyuncs.com https://*.oss-cn-shanghai.aliyuncs.com https://vasthk.cn-hongkong.thepacificgls.com https://cn-hongkong.thepacificgls.com https://webstatic.aiproxy.vip https://oss.filenest.top https://tempfile.aiquickdraw.com",
              "media-src 'self' data: blob: https://*.oss-cn-hongkong.aliyuncs.com https://*.oss-cn-hangzhou.aliyuncs.com https://*.oss-cn-shanghai.aliyuncs.com https://vasthk.cn-hongkong.thepacificgls.com https://cn-hongkong.thepacificgls.com",
              "font-src 'self'",
              "connect-src 'self' https://*.supabase.co https://api.lingyaai.cn https://api.bltcy.ai https://api.xiaomimimo.com https://api.imgbb.com https://value.apiqik.online https://*.ibb.co https://*.aliyuncs.com",
              "frame-ancestors 'none'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default withSentryConfig(withNextIntl(nextConfig), {
  silent: true,
});
