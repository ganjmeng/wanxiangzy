"use client";

import { useRouter } from "next/navigation";
import { Compass, Sparkles } from "lucide-react";
import { StudioShowcaseGallery } from "@/components/studio/StudioShowcaseGallery";
import type { StudioShowcaseExample } from "@/lib/showcase-examples";
import styles from "./creative-plaza.module.css";

export function CreativePlaza() {
  const router = useRouter();
  const createSimilar = (example: StudioShowcaseExample) => {
    router.push(`/agent?prompt=${encodeURIComponent(example.prompt)}`);
  };

  return (
    <main className={styles.page}>
      <div className={styles.inner}>
        <header className={styles.header}>
          <span><Compass aria-hidden="true" />创作社区</span>
          <h1>创作广场</h1>
          <p>从经过验证的视觉案例开始，复制提示词或直接交给 Agent 生成你的版本。</p>
        </header>
        <section className={styles.curated}>
          <div className={styles.curatedLabel}><Sparkles aria-hidden="true" /><div><strong>精选案例</strong><span>内容由现有广场配置统一管理</span></div></div>
          <StudioShowcaseGallery module="general-image-text-to-image" onCreateSimilar={createSimilar} />
          <StudioShowcaseGallery module="general-image-image-to-image" onCreateSimilar={createSimilar} />
        </section>
      </div>
    </main>
  );
}
