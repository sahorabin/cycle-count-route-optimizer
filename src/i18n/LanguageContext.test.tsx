// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LanguageProvider } from "./LanguageContext";
import { useTranslation } from "./useTranslation";

function Probe() {
  const { language, setLanguage, t } = useTranslation();
  return (
    <div>
      <p data-testid="lang">{language}</p>
      <p data-testid="text">{t("selector.selectedCount", { count: 3, total: 100 })}</p>
      <button onClick={() => setLanguage("en")}>switch</button>
    </div>
  );
}

describe("LanguageContext", () => {
  test("defaults to Korean when no initialLanguage is given", () => {
    render(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>,
    );
    expect(screen.getByTestId("lang").textContent).toBe("ko");
    expect(screen.getByTestId("text").textContent).toBe("100개 중 3개 선택됨");
  });

  test("renders the requested initial language and interpolates params", () => {
    render(
      <LanguageProvider initialLanguage="en">
        <Probe />
      </LanguageProvider>,
    );
    expect(screen.getByTestId("text").textContent).toBe("3 of 100 selected");
  });

  test("switching language re-renders translated text and notifies the caller", () => {
    const onLanguageChange = vi.fn();
    render(
      <LanguageProvider initialLanguage="ko" onLanguageChange={onLanguageChange}>
        <Probe />
      </LanguageProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "switch" }));
    expect(screen.getByTestId("lang").textContent).toBe("en");
    expect(screen.getByTestId("text").textContent).toBe("3 of 100 selected");
    expect(onLanguageChange).toHaveBeenCalledWith("en");
  });
});
