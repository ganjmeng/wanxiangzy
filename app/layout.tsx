import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { Toaster } from "sonner";
import "./globals.css";
import "./styles/shared-components.css";
import "./styles/admin.css";
import "./styles/studio-primitives.css";
import "./styles/studio.css";
import "./styles/home.css";
import "./styles/studio-overrides.css";
import { HeaderClient } from "@/components/HeaderClient";
import { RouteProgress } from "@/components/ui/route-progress";
import "@/lib/env";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "VastWearGen - AI 服装视觉生产工作台",
  description: "面向服装品牌、电商团队和内容创作者的 AI 服装视觉生产工作台。",
  icons: {
    icon: [{ url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/gemini-icon.png", type: "image/png" }],
    apple: [{ url: "https://vastweargen-images.oss-cn-hongkong.aliyuncs.com/site-assets/original/gemini-icon.png", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfbfa" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0a09" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" className={cn("font-sans", geist.variable)} style={{ colorScheme: "light" }}>
      <body className="min-h-screen text-codex-ink">
        <Suspense fallback={null}>
          <RouteProgress />
        </Suspense>
        <HeaderClient />
        <main>{children}</main>
        <Toaster
          richColors
          closeButton
          expand={false}
          visibleToasts={1}
          gap={8}
          duration={2400}
          position="top-right"
          offset={{ top: 76, right: 18 }}
          mobileOffset={{ top: 70, right: 12, left: 12 }}
        />
      </body>
    </html>
  );
}
