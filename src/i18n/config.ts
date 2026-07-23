export const locales = [
  "en",
  "pt-BR",
  "es",
  "fr",
  "de",
  "nl",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "vi",
] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";
