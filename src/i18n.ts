import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import { isLanguageLoaded, loadLocale, markLanguageLoaded, type LanguageCode } from "@/locales";

export const LANGUAGE_STORAGE_KEY = "iwms.language";

const normalizeLanguageCode = (value?: string | null): LanguageCode => {
  if (!value) return "en";
  const lower = value.toLowerCase();
  if (lower.startsWith("ta") || lower.includes("tamil") || value.includes("தமிழ்")) {
    return "ta";
  }
  if (lower.startsWith("hi") || lower.includes("hindi") || value.includes("हिन्दी")) {
    return "hi";
  }
  if (lower.startsWith("en") || lower.includes("english")) {
    return "en";
  }
  return "en";
};

const initialLanguage = (() => {
  if (typeof window === "undefined") return "en";
  return normalizeLanguageCode(localStorage.getItem(LANGUAGE_STORAGE_KEY));
})();

const initialization = i18n.use(initReactI18next).init({
  resources: {},
  lng: initialLanguage,
  fallbackLng: "en",
  supportedLngs: ["en", "ta", "hi"],
  react: { bindI18n: "languageChanged", bindI18nStore: "added removed" },
  interpolation: {
    escapeValue: false,
  },
});

const pendingLoads = new Map<LanguageCode, Promise<void>>();

export async function ensureLanguageLoaded(lang: LanguageCode) {
  if (isLanguageLoaded(lang)) return;
  let pending = pendingLoads.get(lang);
  if (!pending) {
    pending = loadLocale(lang).then((bundle) => {
      i18n.addResourceBundle(lang, "translation", bundle.translation, true, true);
      markLanguageLoaded(lang);
    }).finally(() => pendingLoads.delete(lang));
    pendingLoads.set(lang, pending);
  }
  await pending;
}

export async function switchLanguage(lang: LanguageCode) {
  await i18nReady;
  await ensureLanguageLoaded(lang);
  await i18n.changeLanguage(lang);
}

// Render only after resources are ready. Always load the English fallback,
// including on a direct refresh in Tamil or Hindi.
export const i18nReady = initialization.then(() => Promise.all([
  ensureLanguageLoaded("en"),
  ensureLanguageLoaded(initialLanguage),
]));

if (typeof window !== "undefined") {
  const applyLanguageAttributes = (lng: string) => {
    const normalized = normalizeLanguageCode(lng);
    document.documentElement.lang = normalized;
  };

  applyLanguageAttributes(initialLanguage);
  i18n.on("languageChanged", (lng) => {
    const normalized = normalizeLanguageCode(lng);
    localStorage.setItem(LANGUAGE_STORAGE_KEY, normalized);
    applyLanguageAttributes(normalized);
  });
}

export default i18n;
