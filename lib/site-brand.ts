export const SITE_NAME = "Pixel Diffusion";

export function replaceLegacyCanvasBrand(value: string) {
  return value.replace(/^VOZEB\s+PRO(?=\s|$)/i, SITE_NAME);
}

