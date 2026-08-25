"use client";

import { useDeferredValue, useMemo, useReducer, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { FileText, Plus, Search, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { FeatureTabs } from "@/components/FeatureTabs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  createResourcePrompt,
  deleteResourceAsset,
  deleteResourcePrompt,
  uploadLocalResources,
} from "./api";
import {
  ResourceAssetCard,
  ResourceAssetGrid,
  ResourceEmptyState,
  ResourceErrorState,
  ResourceFilters,
  ResourceLoadingState,
} from "./ResourceLibraryPrimitives";
import { useResourceAssets, useResourceFacets, useResourcePrompts } from "./useResourceLibraryData";
import { INITIAL_RESOURCE_LIBRARY_PAGE_STATE, resourceLibraryPageReducer, type ResourceLibraryTab } from "./page-state";
import type { ResourceAsset, ResourcePrompt, ResourcePromptInput } from "./types";
import styles from "./resource-library-page.module.css";

const PROMPT_CREATION_TYPES = [
  "text-to-image",
  "image-to-image",
  "model-background",
  "pose",
  "video",
  "other",
] as const;

function isKnownPromptType(value: string): value is typeof PROMPT_CREATION_TYPES[number] {
  return PROMPT_CREATION_TYPES.includes(value as typeof PROMPT_CREATION_TYPES[number]);
}

export function ResourceLibraryPage() {
  const t = useTranslations("ResourceLibrary");
  const [{ tab, media, module }, dispatchPage] = useReducer(
    resourceLibraryPageReducer,
    INITIAL_RESOURCE_LIBRARY_PAGE_STATE,
  );
  const [previewAsset, setPreviewAsset] = useState<ResourceAsset | null>(null);
  const [deleteAssetTarget, setDeleteAssetTarget] = useState<ResourceAsset | null>(null);
  const [deletePromptTarget, setDeletePromptTarget] = useState<ResourcePrompt | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [promptDialogOpen, setPromptDialogOpen] = useState(false);
  const [promptQuery, setPromptQuery] = useState("");
  const [promptType, setPromptType] = useState("all");
  const deferredPromptQuery = useDeferredValue(promptQuery);
  const uploadRef = useRef<HTMLInputElement | null>(null);
  const { facets, reload: reloadFacets } = useResourceFacets();
  const assetQuery = useMemo(() => ({
    source: tab === "generated" ? "generation" as const : "upload" as const,
    module: tab === "generated" && module !== "all" ? module : undefined,
    media: media === "all" ? undefined : media,
    limit: 32,
  }), [media, module, tab]);
  const assets = useResourceAssets(assetQuery, tab !== "prompts");
  const promptListQuery = useMemo(() => ({
    creationType: promptType === "all" ? undefined : promptType,
    q: deferredPromptQuery.trim() || undefined,
    limit: 24,
  }), [deferredPromptQuery, promptType]);
  const prompts = useResourcePrompts(promptListQuery, tab === "prompts");

  const moduleOptions = facets.modules
    .filter((facet) => facet.count > 0)
    .map((facet) => ({ value: facet.key, label: t(`modules.${facet.key}`) }));

  const switchTab = (nextTab: ResourceLibraryTab) => dispatchPage({ type: "switch-tab", tab: nextTab });

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    setUploading(true);
    setUploadError("");
    try {
      const result = await uploadLocalResources(files);
      const uploaded = result.assets;
      assets.setItems((current) => [
        ...uploaded,
        ...current.filter((asset) => !uploaded.some((item) => item.url === asset.url)),
      ]);
      await reloadFacets();
      if (uploaded.length) toast.success(t("toast.uploadSuccess", { count: uploaded.length }));
      if (result.errors.length) throw result.errors[0];
    } catch (error) {
      const message = error instanceof Error ? error.message : t("states.uploadFailed");
      setUploadError(message);
      toast.error(message);
    } finally {
      setUploading(false);
    }
  };

  const confirmDeleteAsset = async () => {
    if (!deleteAssetTarget) return;
    const target = deleteAssetTarget;
    setDeleteAssetTarget(null);
    try {
      await deleteResourceAsset(target.id);
      assets.setItems((current) => current.filter((asset) => asset.id !== target.id));
      void reloadFacets();
      toast.success(t("toast.assetRemoved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("states.deleteFailed"));
    }
  };

  const confirmDeletePrompt = async () => {
    if (!deletePromptTarget) return;
    const target = deletePromptTarget;
    setDeletePromptTarget(null);
    try {
      await deleteResourcePrompt(target.id);
      prompts.setItems((current) => current.filter((prompt) => prompt.id !== target.id));
      toast.success(t("toast.promptRemoved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("states.deleteFailed"));
    }
  };

  const renderAssets = () => {
    if (assets.state === "loading") return <ResourceLoadingState label={t("states.loading")} />;
    if (assets.state === "error") {
      return (
        <ResourceErrorState
          title={t("states.loadFailedTitle")}
          description={assets.error?.message ?? t("states.loadFailedDescription")}
          retryLabel={t("actions.retry")}
          onRetry={assets.reload}
        />
      );
    }
    if (!assets.items.length) {
      return (
        <ResourceEmptyState
          kind={tab === "uploads" ? "upload" : "empty"}
          title={tab === "uploads" ? t("empty.uploadTitle") : t("empty.generatedTitle")}
          description={tab === "uploads" ? t("empty.uploadDescription") : t("empty.generatedDescription")}
          action={tab === "uploads" ? (
            <Button onClick={() => uploadRef.current?.click()}><Upload aria-hidden="true" />{t("actions.localUpload")}</Button>
          ) : undefined}
        />
      );
    }
    return (
      <>
        <ResourceAssetGrid label={tab === "uploads" ? t("tabs.uploads") : t("tabs.generated")}>
          {tab === "uploads" && (
            <div className={styles.uploadSlot} role="listitem">
              <button className={styles.uploadTile} type="button" onClick={() => uploadRef.current?.click()} disabled={uploading}>
                <span><Plus aria-hidden="true" /></span>
                <strong>{uploading ? t("states.uploading") : t("actions.localUpload")}</strong>
                <small>{t("upload.supportedFormats")}</small>
              </button>
            </div>
          )}
          {assets.items.map((asset) => (
            <ResourceAssetCard
              key={asset.id}
              asset={asset}
              selectLabel={t("card.preview", { title: asset.title })}
              videoLabel={t("filters.video")}
              onSelect={setPreviewAsset}
              onDelete={setDeleteAssetTarget}
              deleteLabel={t("actions.removeAsset")}
            />
          ))}
        </ResourceAssetGrid>
        {assets.hasMore && (
          <div className={styles.loadMore}>
            <Button variant="outline" disabled={assets.loadingMore} onClick={assets.loadMore}>
              {assets.loadingMore ? t("states.loading") : t("actions.loadMore")}
            </Button>
          </div>
        )}
      </>
    );
  };

  return (
    <div className={styles.workspace}>
      <FeatureTabs active={null} module="productImages" />
      <section className={styles.page} aria-labelledby="resource-library-heading">
        <header className={styles.pageHeader}>
          <div>
            <h1 id="resource-library-heading">{t("page.title")}</h1>
            <p>{t("page.description")}</p>
          </div>
        </header>
        <div className={styles.tabRow} role="tablist" aria-label={t("tabs.label")}>
          {(["uploads", "generated", "prompts"] as const).map((item) => (
            <button
              key={item}
              id={`resource-tab-${item}`}
              type="button"
              role="tab"
              aria-selected={tab === item}
              aria-controls={`resource-panel-${item}`}
              className={styles.tabButton}
              data-active={tab === item || undefined}
              onClick={() => switchTab(item)}
            >
              {t(`tabs.${item}`)}
            </button>
          ))}
        </div>
        <div
          id={`resource-panel-${tab}`}
          role="tabpanel"
          aria-labelledby={`resource-tab-${tab}`}
          className={styles.panel}
        >
          {tab !== "prompts" ? (
            <>
              <ResourceFilters
                media={media}
                onMediaChange={(value) => dispatchPage({ type: "set-media", media: value })}
                allowedMedia={["image", "video"]}
                mediaLabel={t("filters.mediaLabel")}
                allMediaLabel={t("filters.allMedia")}
                imageLabel={t("filters.image")}
                videoLabel={t("filters.video")}
                module={module}
                onModuleChange={tab === "generated" ? (value) => dispatchPage({ type: "set-module", module: value }) : undefined}
                moduleOptions={moduleOptions}
                moduleLabel={t("filters.moduleLabel")}
                allModulesLabel={t("filters.allModules")}
                trailing={tab === "uploads" ? (
                  <Button onClick={() => uploadRef.current?.click()} disabled={uploading}>
                    <Upload aria-hidden="true" />{uploading ? t("states.uploading") : t("actions.localUpload")}
                  </Button>
                ) : undefined}
              />
              {uploadError && <p className={styles.errorBanner} role="alert">{uploadError}</p>}
              <div className={styles.panelScroll}>{renderAssets()}</div>
            </>
          ) : (
            <PromptLibrary
              items={prompts.items}
              state={prompts.state}
              error={prompts.error}
              query={promptQuery}
              onQueryChange={setPromptQuery}
              creationType={promptType}
              onCreationTypeChange={setPromptType}
              onCreate={() => setPromptDialogOpen(true)}
              onDelete={setDeletePromptTarget}
              onRetry={prompts.reload}
              hasMore={prompts.hasMore}
              loadingMore={prompts.loadingMore}
              onLoadMore={prompts.loadMore}
            />
          )}
        </div>
      </section>
      <input ref={uploadRef} className="sr-only" type="file" accept="image/*,video/*" multiple onChange={handleUpload} />
      <AssetPreviewDialog asset={previewAsset} onClose={() => setPreviewAsset(null)} />
      <PromptEditorDialog
        open={promptDialogOpen}
        onOpenChange={setPromptDialogOpen}
        onCreated={(prompt) => {
          prompts.setItems((current) => [prompt, ...current]);
          setPromptDialogOpen(false);
        }}
      />
      <ConfirmRemoveDialog
        open={Boolean(deleteAssetTarget)}
        title={t("confirm.removeAssetTitle")}
        description={t("confirm.removeAssetDescription")}
        onCancel={() => setDeleteAssetTarget(null)}
        onConfirm={confirmDeleteAsset}
      />
      <ConfirmRemoveDialog
        open={Boolean(deletePromptTarget)}
        title={t("confirm.removePromptTitle")}
        description={t("confirm.removePromptDescription")}
        onCancel={() => setDeletePromptTarget(null)}
        onConfirm={confirmDeletePrompt}
      />
    </div>
  );
}

function PromptLibrary({
  items,
  state,
  error,
  query,
  onQueryChange,
  creationType,
  onCreationTypeChange,
  onCreate,
  onDelete,
  onRetry,
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  items: ResourcePrompt[];
  state: string;
  error: Error | null;
  query: string;
  onQueryChange: (value: string) => void;
  creationType: string;
  onCreationTypeChange: (value: string) => void;
  onCreate: () => void;
  onDelete: (prompt: ResourcePrompt) => void;
  onRetry: () => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  const t = useTranslations("ResourceLibrary");
  return (
    <>
      <div className={styles.promptToolbar}>
        <label className={styles.promptTypeSelect}>
          <span className="sr-only">{t("prompts.typeLabel")}</span>
          <select value={creationType} onChange={(event) => onCreationTypeChange(event.target.value)}>
            <option value="all">{t("prompts.allTypes")}</option>
            {PROMPT_CREATION_TYPES.map((type) => <option key={type} value={type}>{t(`promptTypes.${type}`)}</option>)}
          </select>
        </label>
        <label className={styles.searchField}>
          <Search aria-hidden="true" />
          <span className="sr-only">{t("prompts.searchLabel")}</span>
          <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder={t("prompts.searchPlaceholder")} />
        </label>
        <Button onClick={onCreate}><Plus aria-hidden="true" />{t("actions.newPrompt")}</Button>
      </div>
      <div className={styles.panelScroll}>
        {state === "loading" ? <ResourceLoadingState label={t("states.loading")} /> : state === "error" ? (
          <ResourceErrorState
            title={t("states.loadFailedTitle")}
            description={error?.message ?? t("states.loadFailedDescription")}
            retryLabel={t("actions.retry")}
            onRetry={onRetry}
          />
        ) : !items.length ? (
          <ResourceEmptyState
            title={t("empty.promptTitle")}
            description={t("empty.promptDescription")}
            action={<Button onClick={onCreate}><Plus aria-hidden="true" />{t("actions.newPrompt")}</Button>}
          />
        ) : (
          <>
            <div className={styles.promptGrid}>
              {items.map((prompt) => (
                <article key={prompt.id} className={styles.promptCard}>
                <span className={styles.promptIcon} aria-hidden="true"><FileText /></span>
                <div className={styles.promptCardHeader}>
                  <div>
                    <strong>{prompt.title}</strong>
                    <span>{t(`promptTypes.${isKnownPromptType(prompt.creationType) ? prompt.creationType : "other"}`)}</span>
                  </div>
                  <Button variant="ghost" size="icon-sm" aria-label={t("actions.removePrompt")} onClick={() => onDelete(prompt)}>
                    <X aria-hidden="true" />
                  </Button>
                </div>
                <p>{prompt.content}</p>
                </article>
              ))}
            </div>
            {hasMore && (
              <div className={styles.loadMore}>
                <Button variant="outline" disabled={loadingMore} onClick={onLoadMore}>
                  {loadingMore ? t("states.loading") : t("actions.loadMore")}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

function AssetPreviewDialog({ asset, onClose }: { asset: ResourceAsset | null; onClose: () => void }) {
  const t = useTranslations("ResourceLibrary");
  return (
    <Dialog open={Boolean(asset)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className={`${styles.previewDialog} max-w-none sm:max-w-none`} showCloseButton={false}>
        <DialogTitle className="sr-only">{asset?.title || t("card.previewTitle")}</DialogTitle>
        <DialogDescription className="sr-only">{t("card.previewDescription")}</DialogDescription>
        <Button className={styles.previewClose} variant="secondary" size="icon" aria-label={t("actions.close")} onClick={onClose}>
          <X aria-hidden="true" />
        </Button>
        {asset?.mediaType === "video"
          ? <video src={asset.url} controls autoPlay={false} />
          : asset && (
            <Image
              src={asset.url}
              alt={asset.title}
              width={asset.width || 1600}
              height={asset.height || 1600}
              sizes="min(100vw, 1040px)"
              unoptimized
            />
          )}
      </DialogContent>
    </Dialog>
  );
}

function PromptEditorDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (prompt: ResourcePrompt) => void;
}) {
  const t = useTranslations("ResourceLibrary");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const input: ResourcePromptInput = {
      title: String(form.get("title") ?? "").trim(),
      content: String(form.get("content") ?? "").trim(),
      creationType: String(form.get("creationType") ?? "other"),
    };
    if (!input.title || !input.content) return;
    setSubmitting(true);
    setError("");
    try {
      onCreated(await createResourcePrompt(input));
      toast.success(t("toast.promptCreated"));
      formElement.reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("states.createFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${styles.promptDialog} max-w-none sm:max-w-none`} showCloseButton={false}>
        <header className={styles.promptDialogHeader}>
          <div>
            <DialogTitle>{t("prompts.createTitle")}</DialogTitle>
            <DialogDescription>{t("prompts.createDescription")}</DialogDescription>
          </div>
          <Button variant="ghost" size="icon" aria-label={t("actions.close")} onClick={() => onOpenChange(false)}><X /></Button>
        </header>
        <form onSubmit={submit}>
          <label>
            <span>{t("prompts.titleLabel")}</span>
            <input name="title" required maxLength={20} placeholder={t("prompts.titlePlaceholder")} />
          </label>
          <label>
            <span>{t("prompts.typeLabel")}</span>
            <select name="creationType" defaultValue="text-to-image">
              {PROMPT_CREATION_TYPES.map((type) => <option key={type} value={type}>{t(`promptTypes.${type}`)}</option>)}
            </select>
          </label>
          <label>
            <span>{t("prompts.contentLabel")}</span>
            <textarea name="content" required maxLength={2000} rows={8} placeholder={t("prompts.contentPlaceholder")} />
          </label>
          {error && <p className={styles.formError} role="alert">{error}</p>}
          <div className={styles.promptDialogActions}>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t("actions.cancel")}</Button>
            <Button type="submit" disabled={submitting}>{submitting ? t("states.saving") : t("actions.save")}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ConfirmRemoveDialog({
  open,
  title,
  description,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useTranslations("ResourceLibrary");
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onCancel(); }}>
      <DialogContent className={`${styles.confirmDialog} max-w-none sm:max-w-none`} showCloseButton={false}>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        <div className={styles.promptDialogActions}>
          <Button variant="outline" onClick={onCancel}>{t("actions.cancel")}</Button>
          <Button variant="destructive" onClick={onConfirm}>{t("actions.remove")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
