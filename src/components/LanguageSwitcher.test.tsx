// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LanguageProvider } from "../i18n/LanguageContext";
import { useTranslation } from "../i18n/useTranslation";
import { LanguageSwitcher } from "./LanguageSwitcher";

function Harness() {
  const { t } = useTranslation();
  return (
    <>
      <LanguageSwitcher />
      <p data-testid="probe">{t("app.title")}</p>
    </>
  );
}

describe("LanguageSwitcher", () => {
  test("defaults to the Korean radio checked and Korean text shown", () => {
    render(
      <LanguageProvider>
        <Harness />
      </LanguageProvider>,
    );
    expect((screen.getByRole("radio", { name: "한국어" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("group", { name: "언어" })).toBeTruthy();
    expect(screen.getByTestId("probe").textContent).toBe("순환 재고 조사 경로 최적화");
  });

  test("selecting English switches the rendered text", () => {
    render(
      <LanguageProvider>
        <Harness />
      </LanguageProvider>,
    );
    fireEvent.click(screen.getByRole("radio", { name: "English" }));
    expect(screen.getByTestId("probe").textContent).toBe("Cycle Count Route Optimizer");
    expect(screen.getByRole("group", { name: "Language" })).toBeTruthy();
  });
});
