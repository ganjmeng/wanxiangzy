import { getImageVariantUrl } from "@/lib/image-variants";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowRight,
  ExternalLink,
} from "lucide-react";
import { getTranslations } from "next-intl/server";
import { codexTheme } from "@/lib/design/codex-theme";

const partnerLogos = [
  {
    name: "OpenAI",
    src: "https://vasthk.oss-cn-hongkong.aliyuncs.com/site-assets/original/home-showcase/partners/openai.svg",
  },
  {
    name: "Google",
    src: "https://vasthk.oss-cn-hongkong.aliyuncs.com/site-assets/original/home-showcase/partners/google.svg",
  },
  {
    name: "ByteDance",
    src: "https://vasthk.oss-cn-hongkong.aliyuncs.com/site-assets/original/home-showcase/partners/bytedance.svg",
  },
  {
    name: "Alibaba Cloud",
    src: "https://vasthk.oss-cn-hongkong.aliyuncs.com/site-assets/original/home-showcase/partners/alibaba-cloud.svg",
  },
  {
    name: "AWS",
    src: "https://vasthk.oss-cn-hongkong.aliyuncs.com/site-assets/original/home-showcase/partners/aws.svg",
  },
];

const showcase = {
  heroScreen: "https://vasthk.oss-cn-hongkong.aliyuncs.com/site-assets/original/home-showcase/screen-hero-workspace.png",
  tryonScreen: "https://vasthk.oss-cn-hongkong.aliyuncs.com/site-assets/original/home-showcase/screen-tryon-result.png",
  fusionScreen: "https://vasthk.oss-cn-hongkong.aliyuncs.com/site-assets/original/home-showcase/screen-fusion-grid-reference.png",
  poseScreen: "https://vasthk.oss-cn-hongkong.aliyuncs.com/site-assets/original/home-showcase/screen-pose-result-grid.png",
  yellowDress: "https://vasthk.oss-cn-hongkong.aliyuncs.com/site-assets/original/home-showcase/showcase-yellow-dress-garden-back.jpg",
  creamTop: "https://vasthk.oss-cn-hongkong.aliyuncs.com/site-assets/original/home-showcase/showcase-cream-top-mini-skirt.png",
  navyPoseGrid: "https://vasthk.oss-cn-hongkong.aliyuncs.com/site-assets/original/home-showcase/showcase-navy-shirt-pose-grid.jpg",
  blackDress: "https://vasthk.oss-cn-hongkong.aliyuncs.com/site-assets/original/home-showcase/showcase-black-floral-dress.png",
  whiteDressSea: "https://vasthk.oss-cn-hongkong.aliyuncs.com/site-assets/original/home-showcase/showcase-white-dress-sea.png",
  creamBlouse: "https://vasthk.oss-cn-hongkong.aliyuncs.com/site-assets/original/home-showcase/showcase-cream-blouse-skirt.png",
  blueDress: "https://vasthk.oss-cn-hongkong.aliyuncs.com/site-assets/original/home-showcase/showcase-blue-dress-garden-2.png",
  blueDressAlt: "https://vasthk.oss-cn-hongkong.aliyuncs.com/site-assets/original/home-showcase/showcase-blue-dress-garden-3.png",
  blueTop: "https://vasthk.oss-cn-hongkong.aliyuncs.com/site-assets/original/home-showcase/showcase-blue-top-white-pants.png",
  pinkTop: "https://vasthk.oss-cn-hongkong.aliyuncs.com/site-assets/original/home-showcase/showcase-pink-top-garden.png",
} as const;

const featureRows = [
  { visual: "tryon" },
  { visual: "video" },
  { visual: "fusion" },
  { visual: "fission" },
];

type FeatureRow = (typeof featureRows)[number];

const sceneCards = [
  {
    image: showcase.yellowDress,
  },
  {
    video: "https://vasthk.oss-cn-hongkong.aliyuncs.com/site-assets/original/home-showcase/ai-video-preview.mp4",
  },
  {
    image: showcase.blackDress,
  },
  {
    image: showcase.navyPoseGrid,
  },
];

const testimonials = [
  {
    initials: "DW",
    avatar: "https://vasthk.oss-cn-hongkong.aliyuncs.com/site-assets/original/home-showcase/testimonials/daniel-sikorskiy.webp",
  },
  {
    initials: "JW",
    avatar: "https://vasthk.oss-cn-hongkong.aliyuncs.com/site-assets/original/home-showcase/testimonials/joey-wang.webp",
  },
  {
    initials: "TR",
    avatar: "https://vasthk.oss-cn-hongkong.aliyuncs.com/site-assets/original/home-showcase/testimonials/tess-rosania.webp",
  },
  {
    initials: "KL",
    avatar: "https://vasthk.oss-cn-hongkong.aliyuncs.com/site-assets/original/home-showcase/testimonials/austin-ray.webp",
  },
  {
    initials: "AM",
    avatar: "https://vasthk.oss-cn-hongkong.aliyuncs.com/site-assets/original/home-showcase/testimonials/aaron-wang.webp",
  },
  {
    initials: "SC",
    avatar: "https://vasthk.oss-cn-hongkong.aliyuncs.com/site-assets/original/home-showcase/testimonials/tres-wong-godfrey.webp",
  },
];

const footerGroups = [
  {
    links: [
      ["tryon", "/create"],
      ["productSet", "/product-set"],
      ["grass", "/grass"],
      ["background", "/model-background"],
      ["pose", "/pose"],
    ],
  },
  {
    links: [
      ["material", "/general-image"],
      ["model", "/model"],
      ["garment3d", "/garment-3d"],
    ],
  },
  {
    links: [
      ["history", "/history"],
      ["apiTest", "/api-platform-test"],
      ["modelLibrary", "/model"],
      ["imageTool", "/general-image/image-to-image"],
    ],
  },
  {
    links: [
      ["about", "/"],
      ["cases", "/history"],
      ["pricing", "/create"],
      ["login", "/login"],
    ],
  },
];

export default async function HomePage() {
  const t = await getTranslations("Home");
  return (
    <div className="home-marketing-page min-h-screen bg-codex-surface text-codex-ink">
      <section className="home-landing-hero relative isolate overflow-hidden bg-[#e8e9f7] text-codex-ink">
        {/* P2.1 hero video: preload=metadata saves bandwidth, hidden on mobile,
            poster fallback so reduced-motion / mobile users see a still frame. */}
        <video className="home-hero-video-bg hidden md:block" autoPlay muted loop playsInline preload="metadata" poster="https://vasthk.oss-cn-hongkong.aliyuncs.com/site-assets/original/home-showcase/floral-a-poster.jpg" aria-hidden="true">
          <source src="https://vasthk.oss-cn-hongkong.aliyuncs.com/site-assets/original/home-showcase/floral-a.mp4" type="video/mp4" />
        </video>
        {/* Artistry：iridescent 光斑 + Liquid Glass scrim（大师级氛围层，位于视频之上） */}
        <div className="artistry-hero-glow" aria-hidden="true">
          <div className="artistry-hero-blob artistry-hero-blob--violet" />
          <div className="artistry-hero-blob artistry-hero-blob--pink" />
          <div className="artistry-hero-blob artistry-hero-blob--ice" />
        </div>
        <div className="artistry-hero-glass" aria-hidden="true" />
        <div className="home-hero-video-scrim" aria-hidden="true" />
        <div className="home-hero-frame relative mx-auto flex min-h-[640px] max-w-[1440px] flex-col items-center px-5 pb-0 pt-[88px] text-center sm:min-h-[760px] sm:px-8 sm:pt-[108px] md:min-h-[960px] md:pt-[138px] lg:min-h-[1100px] lg:px-10 lg:pt-[156px] xl:min-h-[1240px] xl:pt-[176px]">
          <div className="home-logo-tile">
            <Image src="/gemini-icon.png" alt="" width={52} height={52} className="h-[52px] w-[52px] object-contain" priority />
          </div>

          <h1 className="mt-8 text-[48px] font-semibold leading-[0.98] tracking-[-0.022em] text-codex-ink sm:text-[52px] lg:text-[56px]">
            {codexTheme.brand.name}
          </h1>
          <p className="mt-7 max-w-[720px] text-[18px] font-semibold leading-8 text-codex-ink/84 sm:text-[20px]">
            {t("heroSubtitle")}
          </p>
          <p className="mt-3 max-w-[760px] text-[15px] leading-7 text-codex-muted/68">
            {t("heroDesc")}
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link href="/create" className="home-button home-button-dark">
              {t("ctaEnterWorkspace")}
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
            <Link href="#same-agent" className="home-button home-button-soft">
              {t("ctaViewCases")}
            </Link>
          </div>

          <p className="mt-8 text-[13px] font-semibold text-[#29354d]/58 dark:text-codex-faint/60">
            {t("heroCapabilities")}
          </p>

          <HeroConsole t={t} />
        </div>
      </section>

      <main className="bg-codex-surface text-codex-ink">
        <section id="partners" className="home-partner-band" aria-label={t("partnersAria")}>
          {partnerLogos.map((partner) => (
            <div key={partner.name} className="home-partner-item" aria-label={partner.name}>
              <Image src={partner.src} alt={partner.name} width={170} height={38} unoptimized />
            </div>
          ))}
        </section>

        <section id="features" className="mx-auto max-w-[1440px] px-5 py-24 sm:px-8 lg:px-10">
          <div className="home-feature-intro">
            <h2>{t("featuresIntroTitle")}</h2>
          </div>
          <div className="mt-14 space-y-32">
            {featureRows.map((feature, index) => (
              <FeatureStrip key={feature.visual} t={t} feature={feature} index={index} reverse={index % 2 === 1} />
            ))}
          </div>
        </section>

        <section id="same-agent" className="mx-auto max-w-[1440px] px-5 pb-24 sm:px-8 lg:px-10">
          <div className="mx-auto max-w-[760px] text-center">
            <h2 className="text-[32px] font-semibold leading-tight tracking-[-0.014em] sm:text-[36px]">{t("sameAgentTitle")}</h2>
            <p className="mt-5 text-[15px] leading-7 text-codex-muted">
              {t("sameAgentDesc")}
            </p>
            <Link href="/create" className="home-button home-button-dark mt-8">
              {t("ctaEnterWorkspace")}
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
          </div>

          <div className="mt-16 grid gap-8 md:grid-cols-2 lg:grid-cols-4">
            {sceneCards.map((card, index) => (
              <Link key={index} href="/create" className="home-scene-card artistry-glass-shine group">
                <div className="relative aspect-[1.16] overflow-hidden bg-[#f4f4f4]">
                  {"video" in card ? (
                    <video className="h-full w-full object-cover transition duration-[var(--codex-motion-slow)] group-hover:scale-[1.025]" autoPlay muted loop playsInline preload="auto" aria-hidden="true">
                      <source src={card.video} type="video/mp4" />
                    </video>
                  ) : (
                    <Image
                      src={getImageVariantUrl(card.image, "preview")}
                      alt={t(`sceneTitle.${index}`)}
                      fill
                      sizes="(min-width: 1024px) 33vw, 100vw"
                      className="object-cover object-top transition duration-[var(--codex-motion-slow)] group-hover:scale-[1.025]"
                    />
                  )}
                </div>
                <div className="p-6">
                  <h3 className="text-[20px] font-semibold leading-tight">{t(`sceneTitle.${index}`)}</h3>
                  <p className="mt-3 text-[14px] leading-6 text-codex-muted">{t(`sceneDesc.${index}`)}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>

        <section id="testimonials" className="mx-auto max-w-[1440px] px-5 pb-28 sm:px-8 lg:px-10">
          <h2 className="text-center text-[32px] font-semibold leading-tight tracking-[-0.014em] sm:text-[40px]">{t("testimonialsTitle")}</h2>
          <div className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {testimonials.map((item, index) => (
              <article key={item.initials} className="home-testimonial">
                <Image
                  src={getImageVariantUrl(item.avatar, "thumb")}
                  alt=""
                  width={64}
                  height={64}
                  className="home-testimonial-avatar"
                  aria-hidden="true"
                />
                <p className="mt-12 text-[18px] font-medium leading-8 text-codex-ink">“{t(`testimonialQuote.${index}`)}”</p>
                <p className="mt-16 text-[14px] font-semibold text-codex-faint">{t(`testimonialName.${index}`)}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="home-final-video-cta relative isolate overflow-hidden">
          <video className="home-hero-video-bg" autoPlay muted loop playsInline preload="auto" aria-hidden="true">
            <source src="https://vasthk.oss-cn-hongkong.aliyuncs.com/site-assets/original/home-showcase/floral-a.mp4" type="video/mp4" />
          </video>
          <div className="home-final-video-scrim" aria-hidden="true" />
          <div className="relative z-[3] mx-auto flex min-h-[475px] max-w-[1440px] flex-col items-center justify-center px-5 py-20 text-center text-codex-ink sm:px-8 lg:px-10">
            <h2 className="text-[32px] font-semibold leading-tight tracking-[-0.014em] sm:text-[40px]">{t("finalCtaTitle")}</h2>
            <p className="mt-6 max-w-[660px] text-[16px] font-medium leading-7 text-codex-ink/84">
              {t("finalCtaDesc")}
            </p>
            <Link href="/create" className="home-button home-button-dark mt-9">
              {t("ctaEnterWorkspace")}
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
          </div>
        </section>
      </main>

      <Footer t={t} />
    </div>
  );
}

function HeroConsole({ t }: { t: (key: string) => string }) {
  return (
    <div className="home-hero-console">
      <div className="home-codex-hero-shot home-codex-hero-shot-screenshot">
        <MacWindowShell className="home-hero-macos-shell">
          <Image
            src={showcase.heroScreen}
            alt={t("heroScreenAlt")}
            fill
            priority
            sizes="(min-width: 1280px) 1180px, 92vw"
            className="home-codex-hero-image"
          />
        </MacWindowShell>
      </div>
    </div>
  );
}

function FeatureStrip({
  t,
  feature,
  index,
  reverse = false,
}: {
  t: (key: string) => string;
  feature: FeatureRow;
  index: number;
  reverse?: boolean;
}) {
  return (
    <article className={`home-feature-strip ${reverse ? "home-feature-strip-reverse" : ""}`}>
      <FeatureVisual t={t} type={feature.visual} />
      <div className="home-feature-copy-panel">
        <div className="max-w-[460px]">
          <p className="text-[13px] font-semibold text-[#3f5dff]">{t(`featureEyebrow.${index}`)}</p>
          <h2 className="mt-5 text-[30px] font-semibold leading-tight text-codex-ink sm:text-[38px]">{t(`featureTitle.${index}`)}</h2>
          <p className="mt-7 text-[15px] font-medium leading-7 text-codex-muted">{t(`featureBody.${index}`)}</p>
        </div>
      </div>
    </article>
  );
}

function FeatureVisual({ t, type }: { t: (key: string) => string; type: string }) {
  if (type === "fusion") {
    return <FeatureScreenshot src={showcase.fusionScreen} alt={t("fusionScreenAlt")} className="home-feature-screen-fusion" />;
  }

  if (type === "fission") {
    return <FeatureScreenshot src={showcase.poseScreen} alt={t("poseScreenAlt")} className="home-feature-screen-pose" />;
  }

  if (type === "video") {
    return (
      <div className="home-feature-visual home-feature-screen home-feature-visual-video">
        <MacWindowShell className="home-feature-macos-shell">
          <video className="h-full w-full object-cover" autoPlay muted loop playsInline preload="auto" aria-hidden="true">
            <source src="https://vasthk.oss-cn-hongkong.aliyuncs.com/site-assets/original/home-showcase/ai-video-preview.mp4" type="video/mp4" />
          </video>
          <div className="absolute inset-0 bg-gradient-to-br from-[#244cff]/20 via-transparent to-white/18" />
        </MacWindowShell>
      </div>
    );
  }

  return (
    <FeatureScreenshot src={showcase.tryonScreen} alt={t("heroScreenAlt")} className="home-feature-screen-tryon" />
  );
}

function FeatureScreenshot({ src, alt, className = "" }: { src: string; alt: string; className?: string }) {
  return (
    <div className={`home-feature-visual home-feature-screen ${className}`}>
      <MacWindowShell className="home-feature-macos-shell">
        <Image src={src} alt={alt} fill sizes="(min-width: 1024px) 58vw, 100vw" className="home-feature-screen-img" />
      </MacWindowShell>
      <div className="home-feature-screen-glow" aria-hidden="true" />
    </div>
  );
}

function MacWindowShell({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`home-macos-shell ${className}`}>
      <div className="home-macos-topbar" aria-hidden="true">
        <span className="home-macos-dot home-macos-dot-red" />
        <span className="home-macos-dot home-macos-dot-yellow" />
        <span className="home-macos-dot home-macos-dot-green" />
        <span className="home-macos-layout-icon" />
      </div>
      <div className="home-macos-body">{children}</div>
    </div>
  );
}

function Footer({ t }: { t: (key: string) => string }) {
  return (
    <footer className="border-t border-[var(--codex-border)] bg-codex-surface text-codex-ink">
      <div className="mx-auto grid max-w-[1440px] gap-12 px-5 py-16 sm:px-8 md:grid-cols-[1.1fr_repeat(4,1fr)] lg:px-10">
        <div>
          <p className="text-[18px] font-semibold text-codex-ink">Pixel Diffusion</p>
          <p className="mt-4 max-w-[260px] text-[14px] leading-7 text-codex-muted">
            {t("footNote")}
          </p>
        </div>
        {footerGroups.map((group, index) => (
          <div key={index}>
            <h3 className="text-[13px] font-semibold text-codex-faint">{t(`footerGroupTitle.${index}`)}</h3>
            <ul className="mt-5 space-y-3">
              {group.links.map(([labelKey, href]) => (
                <li key={labelKey}>
                  <Link href={href} className="inline-flex items-center gap-1 py-1.5 text-[14px] font-semibold text-codex-ink transition hover:text-codex-muted">
                    {t(`footerLink.${labelKey}`)}
                    {href !== "/" && <ExternalLink aria-hidden="true" className="h-3 w-3" />}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </footer>
  );
}
