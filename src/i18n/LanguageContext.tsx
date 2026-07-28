import { useMemo, useState, type ReactNode } from "react";
import { translations, type Language } from "./translations";
import { LanguageContext, type TranslationApi } from "./context";

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    name in params ? String(params[name]) : match,
  );
}

export function LanguageProvider({
  initialLanguage = "ko",
  onLanguageChange,
  children,
}: {
  initialLanguage?: Language;
  onLanguageChange?: (language: Language) => void;
  children: ReactNode;
}) {
  const [language, setLanguageState] = useState<Language>(initialLanguage);

  const value = useMemo<TranslationApi>(
    () => ({
      language,
      setLanguage: (next: Language) => {
        setLanguageState(next);
        onLanguageChange?.(next);
      },
      t: (key, params) => interpolate(translations[language][key], params),
    }),
    [language, onLanguageChange],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}
