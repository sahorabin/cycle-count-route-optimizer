import { useContext } from "react";
import { LanguageContext, type TranslationApi } from "./context";

export function useTranslation(): TranslationApi {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useTranslation must be used within a LanguageProvider");
  return ctx;
}
