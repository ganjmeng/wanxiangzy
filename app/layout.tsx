import type { Metadata } from "next";
import { Toaster } from "sonner";
import "./globals.css";
import { HeaderClient } from "@/components/HeaderClient";
import "@/lib/env";
import { TooltipProvider } from "@/components/ui/tooltip";

export const metadata: Metadata = {
  title: "VastWear｜服装视觉生成平台",
  description: "面向服装品牌、电商团队和内容创作者的服装视觉生成平台。",
  icons: {
    icon: [{ url: "/gemini-icon.png", type: "image/png" }],
    apple: [{ url: "/gemini-icon.png", type: "image/png" }],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-[#f4f5f7] text-slate-950">
        <TooltipProvider>
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
        </TooltipProvider>
      </body>
    </html>
  );
}
