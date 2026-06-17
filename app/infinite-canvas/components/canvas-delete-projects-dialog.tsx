"use client";

import { Trash2 } from "lucide-react";

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogMedia,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAssetStore } from "@/stores/use-asset-store";
import { useCanvasStore } from "../stores/use-canvas-store";
import { useCanvasUiStore } from "../stores/use-canvas-ui-store";

export function CanvasDeleteProjectsDialog() {
    const ids = useCanvasUiStore((state) => state.deleteProjectIds);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const removeSelectedIds = useCanvasUiStore((state) => state.removeSelectedProjectIds);
    const deleteProjects = useCanvasStore((state) => state.deleteProjects);
    const cleanupImages = useAssetStore((state) => state.cleanupImages);

    const close = () => setDeleteIds([]);

    const confirm = () => {
        deleteProjects(ids);
        cleanupImages();
        removeSelectedIds(ids);
        close();
    };

    return (
        <AlertDialog open={ids.length > 0} onOpenChange={(open) => !open && close()}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogMedia className="bg-destructive/10 text-destructive">
                        <Trash2 className="size-5" />
                    </AlertDialogMedia>
                    <AlertDialogTitle>删除画布？</AlertDialogTitle>
                    <AlertDialogDescription>
                        将删除 {ids.length} 个画布，里面的节点、连线和本地素材引用也会一起移除。这个操作不能撤销。
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel onClick={close}>取消</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" onClick={confirm}>
                        删除
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
