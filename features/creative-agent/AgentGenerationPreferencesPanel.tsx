"use client";

import { useState } from "react";
import { ImageIcon, Maximize2, Sparkles, Video } from "lucide-react";

import type { AgentCapability, AgentGenerationPreferences, ReferenceMode } from "./AgentComposerControls";

type PanelTab = "canvas" | "output";
type MediaCapability = Exclude<AgentCapability, "audio">;
type ImageQuality = "smart" | "high" | "medium" | "low";

const imageRatios = ["auto", "1:1", "16:9", "4:3", "3:2", "2:3", "3:4", "9:16"];
const videoRatios = ["auto", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];

export function AgentGenerationPreferencesPanel({
  capability,
  preferences,
  onCapability,
  onChange,
}: {
  capability: AgentCapability;
  preferences: AgentGenerationPreferences;
  onCapability: (value: AgentCapability) => void;
  onChange: (value: AgentGenerationPreferences) => void;
}) {
  const [tab, setTab] = useState<PanelTab>("canvas");
  const [customOpen, setCustomOpen] = useState(false);
  const media: MediaCapability = capability === "video" ? "video" : "image";

  const setImage = (patch: Partial<AgentGenerationPreferences["image"]>) => {
    onChange({ ...preferences, image: { ...preferences.image, ...patch } });
  };
  const setVideo = (patch: Partial<AgentGenerationPreferences["video"]>) => {
    onChange({ ...preferences, video: { ...preferences.video, ...patch } });
  };

  return (
    <div
      className="absolute left-0 top-full z-[70] mt-2 max-h-[min(520px,calc(100vh-150px))] w-[390px] max-w-[calc(100vw-32px)] overflow-y-auto rounded-[15px] border border-[#e1e5e9] bg-white p-2 text-[#20242a] shadow-[0_16px_42px_rgba(31,37,44,0.18)] dark:border-[#363c45] dark:bg-[#20242a] dark:text-[#f4f5f7]"
      role="tooltip"
      aria-label="生成参数"
    >
      <SegmentedControl
        value={media}
        options={[
          { value: "image", label: "图片", icon: <ImageIcon className="size-4" /> },
          { value: "video", label: "视频", icon: <Video className="size-4" /> },
        ]}
        onChange={(value) => {
          setTab("canvas");
          setCustomOpen(false);
          onCapability(value as MediaCapability);
        }}
      />

      <div className="mt-2">
        <SegmentedControl
          value={tab}
          options={[{ value: "canvas", label: "画面" }, { value: "output", label: "输出" }]}
          onChange={(value) => setTab(value as PanelTab)}
          role="tablist"
          ariaLabel="生成参数分组"
        />
      </div>

      <div className="px-1 pb-1">
        {media === "image" && tab === "canvas" ? (
          <CanvasSettings
            ratios={imageRatios}
            value={preferences.image.aspectRatio}
            onRatioChange={(aspectRatio) => setImage({ aspectRatio })}
            customOpen={customOpen}
            onCustomToggle={() => setCustomOpen((value) => !value)}
            customWidth={preferences.image.customWidth}
            customHeight={preferences.image.customHeight}
            onCustomWidth={(customWidth) => setImage({ customWidth })}
            onCustomHeight={(customHeight) => setImage({ customHeight })}
          />
        ) : null}

        {media === "image" && tab === "output" ? (
          <ImageOutputSettings preferences={preferences} setImage={setImage} />
        ) : null}

        {media === "video" && tab === "canvas" ? (
          <>
            <SectionHeader label="参考方式" />
            <ChoiceGroup
              columns={3}
              value={referenceModeLabel(preferences.video.referenceMode)}
              values={["智能参考", "首帧", "首尾帧"]}
              onChange={(value) => setVideo({ referenceMode: parseReferenceMode(value) })}
              ariaLabel="选择视频参考方式"
            />
            <CanvasSettings
              ratios={videoRatios}
              value={preferences.video.aspectRatio}
              onRatioChange={(aspectRatio) => setVideo({ aspectRatio })}
              customOpen={customOpen}
              onCustomToggle={() => setCustomOpen((value) => !value)}
              onVideoCustom={(width, height) => setVideo({ aspectRatio: `custom:${width}x${height}` })}
            />
          </>
        ) : null}

        {media === "video" && tab === "output" ? (
          <VideoOutputSettings preferences={preferences} setVideo={setVideo} />
        ) : null}
      </div>
    </div>
  );
}

function SegmentedControl({
  value,
  options,
  onChange,
  role,
  ariaLabel,
}: {
  value: string;
  options: Array<{ value: string; label: string; icon?: React.ReactNode }>;
  onChange: (value: string) => void;
  role?: "tablist";
  ariaLabel?: string;
}) {
  return (
    <div className="grid grid-cols-2 rounded-[12px] bg-[#eef0f3] p-1 dark:bg-[#17191d]" role={role} aria-label={ariaLabel}>
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role={role ? "tab" : undefined}
            aria-selected={role ? selected : undefined}
            aria-pressed={!role ? selected : undefined}
            className={`flex h-8 items-center justify-center gap-1.5 rounded-[8px] text-xs font-semibold transition ${selected ? "bg-white text-[#20242a] shadow-[0_1px_3px_rgba(25,31,38,0.14)] dark:bg-[#30363e] dark:text-white" : "text-[#697381] hover:bg-white/60 hover:text-[#20242a] dark:text-[#9aa3af] dark:hover:bg-[#30363e] dark:hover:text-white"}`}
            onClick={() => onChange(option.value)}
          >
            {option.icon}{option.label}
          </button>
        );
      })}
    </div>
  );
}

function CanvasSettings({
  ratios,
  value,
  onRatioChange,
  customOpen,
  onCustomToggle,
  customWidth = "",
  customHeight = "",
  onCustomWidth,
  onCustomHeight,
  onVideoCustom,
}: {
  ratios: string[];
  value: string;
  onRatioChange: (value: string) => void;
  customOpen: boolean;
  onCustomToggle: () => void;
  customWidth?: string;
  customHeight?: string;
  onCustomWidth?: (value: string) => void;
  onCustomHeight?: (value: string) => void;
  onVideoCustom?: (width: string, height: string) => void;
}) {
  const [videoWidth, setVideoWidth] = useState("");
  const [videoHeight, setVideoHeight] = useState("");
  const width = onVideoCustom ? videoWidth : customWidth;
  const height = onVideoCustom ? videoHeight : customHeight;
  const setWidth = (next: string) => {
    const clean = numericValue(next);
    if (onVideoCustom) { setVideoWidth(clean); if (clean && height) onVideoCustom(clean, height); }
    else onCustomWidth?.(clean);
  };
  const setHeight = (next: string) => {
    const clean = numericValue(next);
    if (onVideoCustom) { setVideoHeight(clean); if (width && clean) onVideoCustom(width, clean); }
    else onCustomHeight?.(clean);
  };

  return (
    <>
      <SectionHeader label="比例" trailing="智能" />
      <div className="grid grid-cols-4 gap-1.5">
        {ratios.map((ratio) => (
          <button
            key={ratio}
            type="button"
            aria-pressed={value === ratio}
            aria-label={`选择比例 ${ratio === "auto" ? "智能" : ratio}`}
            className={`flex h-9 items-center justify-center gap-2 rounded-[9px] text-xs font-semibold transition ${value === ratio ? "bg-[#e8f0f4] text-[#294a5d] dark:bg-[#31424d] dark:text-[#dcebf3]" : "bg-[#f2f3f5] text-[#30363d] hover:bg-[#e9ecef] dark:bg-[#2b3037] dark:text-[#c9d0d8]"}`}
            onClick={() => onRatioChange(ratio)}
          >
            {ratio === "auto" ? <Sparkles className="size-3.5" /> : <RatioIcon ratio={ratio} />}
            <span>{ratio === "auto" ? "智能" : ratio}</span>
          </button>
        ))}
      </div>
      <button
        type="button"
        className="mt-2 flex h-9 w-full items-center justify-center gap-2 rounded-[9px] border border-dashed border-[#cbd2da] text-xs font-semibold text-[#3e4853] transition hover:bg-[#f5f6f8] dark:border-[#4a525d] dark:text-[#d8dde3] dark:hover:bg-[#2b3037]"
        onClick={onCustomToggle}
        aria-expanded={customOpen}
      >
        <Maximize2 className="size-3.5" />自定义像素尺寸
      </button>
      {customOpen ? (
        <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-[10px] bg-[#f5f6f8] p-2 dark:bg-[#292f36]">
          <DimensionInput label="宽度" value={width} onChange={setWidth} />
          <span className="text-xs text-[#9aa2ad]">×</span>
          <DimensionInput label="高度" value={height} onChange={setHeight} />
        </div>
      ) : null}
    </>
  );
}

function ImageOutputSettings({ preferences, setImage }: { preferences: AgentGenerationPreferences; setImage: (patch: Partial<AgentGenerationPreferences["image"]>) => void }) {
  const quality = preferences.image.quality ?? "smart";
  const qualityOptions: Array<{ value: ImageQuality; label: string; imageSize: "1K" | "2K" | "4K" }> = [
    { value: "smart", label: "智能", imageSize: "1K" },
    { value: "high", label: "高", imageSize: "4K" },
    { value: "medium", label: "中", imageSize: "2K" },
    { value: "low", label: "低", imageSize: "1K" },
  ];
  return (
    <>
      <SectionHeader label="画质" />
      <ChoiceGroup
        value={quality}
        values={qualityOptions.map((item) => item.value)}
        labels={Object.fromEntries(qualityOptions.map((item) => [item.value, item.label]))}
        onChange={(value) => {
          const option = qualityOptions.find((item) => item.value === value) ?? qualityOptions[0];
          setImage({ quality: option.value, imageSize: option.imageSize });
        }}
        ariaLabel="选择图片画质"
      />
      <SectionHeader label="数量" />
      <CountControl value={preferences.image.count} onChange={(count) => setImage({ count })} ariaLabel="选择图片生成数量" />
    </>
  );
}

function VideoOutputSettings({ preferences, setVideo }: { preferences: AgentGenerationPreferences; setVideo: (patch: Partial<AgentGenerationPreferences["video"]>) => void }) {
  const recommended = ["auto", "480p", "720p", "1080p"];
  const selectedResolution = recommended.includes(preferences.video.resolution) ? preferences.video.resolution : "custom";
  return (
    <>
      <SectionHeader label="清晰度" />
      <ChoiceGroup
        value={selectedResolution}
        values={recommended}
        labels={{ auto: "智能", "480p": "480P", "720p": "720P", "1080p": "1080P" }}
        onChange={(resolution) => setVideo({ resolution })}
        ariaLabel="选择视频清晰度"
      />
      <div className="mt-2 flex items-center gap-2">
        <input
          className="h-9 min-w-0 flex-1 rounded-[9px] border border-[#dfe3e8] bg-transparent px-3 text-xs outline-none transition focus:border-[#9ba8b4] dark:border-[#454c56]"
          placeholder="自定义，例如 2160 或 4K"
          aria-label="输入自定义视频清晰度"
          value={selectedResolution === "custom" ? preferences.video.resolution : ""}
          onChange={(event) => setVideo({ resolution: event.target.value.slice(0, 12) })}
        />
        <span className="shrink-0 text-[10px] text-[#9aa2ad]">建议值可直接选择</span>
      </div>
      <SectionHeader label="数量" />
      <CountControl value={preferences.video.count} onChange={(count) => setVideo({ count })} ariaLabel="选择视频生成数量" />
      <SectionHeader label="时长" />
      <div className="grid grid-cols-[1fr_1fr_1.2fr] gap-1.5">
        {[5, 10].map((seconds) => (
          <button key={seconds} type="button" aria-pressed={preferences.video.seconds === seconds} className={choiceClass(preferences.video.seconds === seconds)} onClick={() => setVideo({ seconds })}>{seconds} 秒</button>
        ))}
        <label className="flex h-9 items-center rounded-[9px] bg-[#f2f3f5] px-2 dark:bg-[#2b3037]">
          <input className="min-w-0 flex-1 bg-transparent text-center text-xs font-semibold outline-none" type="number" min={1} max={300} value={preferences.video.seconds} onChange={(event) => setVideo({ seconds: clampPositive(event.target.value, 300) })} aria-label="输入视频时长" />
          <span className="text-[10px] text-[#77818d]">秒</span>
        </label>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Switch label="生成声音" checked={preferences.video.generateAudio} onChange={(generateAudio) => setVideo({ generateAudio })} />
        <Switch label="添加水印" checked={preferences.video.watermark} onChange={(watermark) => setVideo({ watermark })} />
      </div>
    </>
  );
}

function CountControl({ value, onChange, ariaLabel }: { value: number; onChange: (value: number) => void; ariaLabel: string }) {
  return (
    <div className="grid grid-cols-5 gap-1.5" role="group" aria-label={ariaLabel}>
      {[1, 2, 3, 4].map((count) => (
        <button key={count} type="button" aria-pressed={value === count} className={choiceClass(value === count)} onClick={() => onChange(count)}>{count} 份</button>
      ))}
      <input className="h-9 min-w-0 rounded-[9px] bg-[#f2f3f5] px-1 text-center text-xs font-semibold outline-none focus:ring-1 focus:ring-[#9ba8b4] dark:bg-[#2b3037]" inputMode="numeric" placeholder="自定义" aria-label="自定义生成数量" value={value > 4 ? value : ""} onChange={(event) => onChange(clampPositive(event.target.value, 20))} />
    </div>
  );
}

function ChoiceGroup({ values, value, onChange, labels = {}, columns = 4, ariaLabel }: { values: string[]; value: string; onChange: (value: string) => void; labels?: Record<string, string>; columns?: number; ariaLabel: string }) {
  return <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }} role="group" aria-label={ariaLabel}>{values.map((item) => <button key={item} type="button" aria-pressed={value === item} className={choiceClass(value === item)} onClick={() => onChange(item)}>{labels[item] ?? item}</button>)}</div>;
}

function SectionHeader({ label, trailing }: { label: string; trailing?: string }) {
  return <div className="mb-2 mt-3 flex items-center justify-between"><h4 className="text-[11px] font-medium text-[#7d8793] dark:text-[#a5adb7]">{label}</h4>{trailing ? <span className="text-[10px] text-[#a3abb5]">{trailing}</span> : null}</div>;
}

function DimensionInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="flex h-9 items-center rounded-[8px] bg-white px-2 shadow-sm dark:bg-[#20242a]"><span className="text-[10px] text-[#929ba7]">{label}</span><input className="min-w-0 flex-1 bg-transparent text-right text-xs font-semibold outline-none" inputMode="numeric" value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function RatioIcon({ ratio }: { ratio: string }) {
  const [width, height] = ratio.split(":").map(Number);
  const horizontal = width > height;
  const vertical = height > width;
  return <span className={`inline-block rounded-[2px] border-[1.5px] border-current ${horizontal ? "h-2.5 w-4" : vertical ? "h-4 w-2.5" : "size-3.5"}`} aria-hidden="true" />;
}

function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <button type="button" role="switch" aria-checked={checked} className="flex h-10 items-center justify-between rounded-[9px] bg-[#f2f3f5] px-3 text-xs font-medium dark:bg-[#2b3037]" onClick={() => onChange(!checked)}><span>{label}</span><span className={`relative h-5 w-9 rounded-full transition ${checked ? "bg-[#4f89a8]" : "bg-[#c6cbd1]"}`}><span className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition ${checked ? "left-[18px]" : "left-0.5"}`} /></span></button>;
}

function choiceClass(selected: boolean) {
  return `h-9 rounded-[9px] text-xs font-semibold transition ${selected ? "bg-[#e8f0f4] text-[#294a5d] dark:bg-[#31424d] dark:text-[#dcebf3]" : "bg-[#f2f3f5] text-[#30363d] hover:bg-[#e9ecef] dark:bg-[#2b3037] dark:text-[#c9d0d8]"}`;
}

function numericValue(value: string) { return value.replace(/\D/g, "").slice(0, 5); }
function clampPositive(value: string, max: number) { return Math.min(max, Math.max(1, Number(value.replace(/\D/g, "")) || 1)); }
function referenceModeLabel(value: ReferenceMode) { return value === "first_frame" ? "首帧" : value === "first_last" ? "首尾帧" : "智能参考"; }
function parseReferenceMode(value: string): ReferenceMode { return value === "首帧" ? "first_frame" : value === "首尾帧" ? "first_last" : "reference"; }
