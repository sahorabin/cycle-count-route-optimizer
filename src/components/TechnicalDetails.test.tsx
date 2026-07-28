// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { TechnicalDetails } from "./TechnicalDetails";
import { LanguageProvider } from "../i18n/LanguageContext";
import { largeWarehouse } from "../data/largeWarehouse";

describe("TechnicalDetails", () => {
  test("is collapsed by default and shows NN vs optimized-heuristic details when targets are given", () => {
    render(
      <LanguageProvider initialLanguage="en">
        <TechnicalDetails graph={largeWarehouse} targetIds={["loc-A01", "loc-A02"]} />
      </LanguageProvider>,
    );
    const details = screen
      .getByText("Technical details (Nearest Neighbor vs Optimized Heuristic)")
      .closest("details")!;
    expect(details.open).toBe(false);
    expect(screen.getByText("Nearest Neighbor")).toBeTruthy();
  });

  test("renders nothing route-specific with zero targets", () => {
    render(
      <LanguageProvider initialLanguage="en">
        <TechnicalDetails graph={largeWarehouse} targetIds={[]} />
      </LanguageProvider>,
    );
    expect(screen.queryByText("Nearest Neighbor")).toBeNull();
  });
});
