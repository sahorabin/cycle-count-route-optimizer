import { createContext } from "react";
import type { Language, TranslationKey } from "./translations";

export interface TranslationApi {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

export const LanguageContext = createContext<TranslationApi | null>(null);
