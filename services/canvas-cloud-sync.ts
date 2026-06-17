"use client";

import type { CanvasProject } from "@/app/infinite-canvas/stores/use-canvas-store";
import { INFINITE_CANVAS_CLOUD_SYNC_ENABLED } from "@/lib/infinite-canvas-public-env";

export type CanvasCloudSyncStatus = "idle" | "syncing" | "synced" | "offline" | "error";

let syncTimer: ReturnType<typeof setTimeout> | null = null;
let cloudSyncUnavailable = false;

export async function syncCanvasProjects(projects: CanvasProject[]) {
    if (!INFINITE_CANVAS_CLOUD_SYNC_ENABLED || cloudSyncUnavailable) return null;

    const response = await fetch("/api/infinite-canvas/projects/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projects }),
    });

    if (response.status === 401) return null;
    if (!response.ok) {
        const message = await readApiError(response, "Canvas cloud sync failed");
        if (isMissingCanvasProjectsTableError(message)) {
            cloudSyncUnavailable = true;
            return null;
        }
        throw new Error(message);
    }

    return (await response.json()) as { projects: CanvasProject[]; restored: number; uploaded: number };
}

export function scheduleCanvasProjectsSync(projects: CanvasProject[]) {
    if (!INFINITE_CANVAS_CLOUD_SYNC_ENABLED || cloudSyncUnavailable) return;

    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
        syncTimer = null;
        void syncCanvasProjects(projects).catch(() => {
            // Store-level explicit sync reports errors; background sync stays non-blocking.
        });
    }, 1200);
}

export async function deleteCanvasProjectsFromCloud(ids: string[]) {
    if (!INFINITE_CANVAS_CLOUD_SYNC_ENABLED || cloudSyncUnavailable) return;

    await Promise.all(
        ids.map(async (id) => {
            const response = await fetch(`/api/infinite-canvas/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
            if (response.status === 401 || response.status === 404) return;
            if (!response.ok) {
                const message = await readApiError(response, "Canvas cloud delete failed");
                if (isMissingCanvasProjectsTableError(message)) {
                    cloudSyncUnavailable = true;
                    return;
                }
                throw new Error(message);
            }
        }),
    );
}

function isMissingCanvasProjectsTableError(message: string) {
    const normalized = message.toLowerCase();
    return normalized.includes("canvas_projects") && (normalized.includes("could not find the table") || normalized.includes("schema cache") || normalized.includes("does not exist"));
}

async function readApiError(response: Response, fallback: string) {
    try {
        const payload = (await response.json()) as { error?: string };
        return payload.error || fallback;
    } catch {
        return fallback;
    }
}
