/**
 * Locale resources: one file per language (en.ts, ta.ts, hi.ts), each holding
 * the full { translation: { common, login, ..., dashboard, admin } } resource.
 *
 * Loaded on demand per language instead of being bundled into the app's main
 * entry chunk: only the active language is fetched at startup; the others are
 * fetched only if the user switches to them (see i18n.ts's
 * ensureLanguageLoaded / switchLanguage), and cached after their first load.
 */

export type LanguageCode = "en" | "ta" | "hi";

export function loadLocale(lang: LanguageCode) {
  if (lang === "ta") return import("./ta").then((m) => m.default);
  if (lang === "hi") return import("./hi").then((m) => m.default);
  return import("./en").then((m) => m.default);
}

// Tracks which languages have had their translation bundle merged into the
// live i18next instance already, so switching back to a language already
// loaded this session is a no-op instead of re-fetching/re-merging it.
// Lives here (not in i18n.ts) so callers that only need to *load and merge
// a language into an existing i18n instance* — e.g. LanguageSwitcher — don't
// have to import i18n.ts and re-run its module-level i18n.init() side effect.
const loadedLanguages = new Set<LanguageCode>();

export function isLanguageLoaded(lang: LanguageCode) {
  return loadedLanguages.has(lang);
}

export function markLanguageLoaded(lang: LanguageCode) {
  loadedLanguages.add(lang);
}
