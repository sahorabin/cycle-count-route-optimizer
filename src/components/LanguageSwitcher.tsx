import { useTranslation } from "../i18n/useTranslation";
import type { Language } from "../i18n/translations";

export function LanguageSwitcher() {
  const { language, setLanguage, t } = useTranslation();

  function radio(value: Language, label: string) {
    return (
      <label>
        <input
          type="radio"
          name="language"
          value={value}
          checked={language === value}
          onChange={() => setLanguage(value)}
        />
        {label}
      </label>
    );
  }

  return (
    <fieldset className="language-switcher">
      <legend className="visually-hidden">{t("language.selectorLabel")}</legend>
      {radio("ko", t("language.korean"))}
      {radio("en", t("language.english"))}
    </fieldset>
  );
}
