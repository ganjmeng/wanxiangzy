import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: process.cwd(),
  experimental: {
    serverActions: {
      bodySizeLimit: "20mb",
    },
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.supabase.co" },
      { protocol: "https", hostname: "replicate.delivery" },
      { protocol: "https", hostname: "**.fashn.ai" },
      { protocol: "https", hostname: "**.sssai.vip" },
      { protocol: "https", hostname: "i.ibb.co" },
      { protocol: "https", hostname: "t.filesystem.site" },
      { protocol: "https", hostname: "**.oss-cn-hongkong.aliyuncs.com" },
      { protocol: "https", hostname: "**.oss-cn-hangzhou.aliyuncs.com" },
      { protocol: "https", hostname: "**.oss-cn-shanghai.aliyuncs.com" },
      { protocol: "https", hostname: "vastweargen-images.cn-hongkong.thepacificxxs.com" },
      { protocol: "https", hostname: "images.vastweargen.com" },
      { protocol: "https", hostname: "webstatic.aiproxy.vip" },
      { protocol: "https", hostname: "oss.filenest.top" },
    ],
  },
  async headers() {
    return [
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
              "img-src 'self' data: blob: https://*.supabase.co https://replicate.delivery https://*.fashn.ai https://*.sssai.vip https://i.ibb.co https://*.ibb.co https://t.filesystem.site https://*.oss-cn-hongkong.aliyuncs.com https://*.oss-cn-hangzhou.aliyuncs.com https://*.oss-cn-shanghai.aliyuncs.com https://vastweargen-images.cn-hongkong.thepacificxxs.com https://images.vastweargen.com https://webstatic.aiproxy.vip https://oss.filenest.top https://yunwu.ai",
              "media-src 'self' data: blob: https://*.oss-cn-hongkong.aliyuncs.com https://*.oss-cn-hangzhou.aliyuncs.com https://*.oss-cn-shanghai.aliyuncs.com https://vastweargen-images.cn-hongkong.thepacificxxs.com https://images.vastweargen.com",
              "font-src 'self'",
              "connect-src 'self' https://*.supabase.co https://api.lingyaai.cn https://api.bltcy.ai https://api.xiaomimimo.com https://api.imgbb.com https://value.apiqik.online https://yunwu.ai https://api.laozhang.ai https://*.ibb.co https://helping-bug-126905.upstash.io",
              "frame-ancestors 'none'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
