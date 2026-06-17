"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App, ConfigProvider, zhCN } from "@/components/ui/shadcn-compat";

import { ClientRootInit } from "@/components/layout/client-root-init";
import { useThemeStore } from "@/stores/use-theme-store";

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 30_000,
            retry: false,
            refetchOnWindowFocus: false,
        },
    },
});

export function AppProviders({ children }: { children: ReactNode }) {
    const theme = useThemeStore((state) => state.theme);
    const dark = theme === "dark";

    useEffect(() => {
        document.documentElement.classList.toggle("dark", dark);
        document.documentElement.style.colorScheme = theme;
    }, [dark, theme]);

    return (
        <ConfigProvider locale={zhCN} theme={{ mode: dark ? "dark" : "light" }}>
            <App>
                <QueryClientProvider client={queryClient}>
                    <ClientRootInit>{children}</ClientRootInit>
                </QueryClientProvider>
            </App>
        </ConfigProvider>
    );
}
