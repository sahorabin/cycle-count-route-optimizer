// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ComponentProps } from "react";
import { ProgressPanel } from "./ProgressPanel";
import { LanguageProvider } from "../i18n/LanguageContext";

function setup(
  overrides: Partial<ComponentProps<typeof ProgressPanel>> = {},
  initialLanguage: "ko" | "en" = "en",
) {
  const onTargetCountChange = vi.fn();
  const onMarkSelectedComplete = vi.fn();
  const onUndoSelectedCompletion = vi.fn();
  render(
    <LanguageProvider initialLanguage={initialLanguage}>
      <ProgressPanel
        targetCount={10}
        completedIds={new Set()}
        selectedIds={new Set()}
        onTargetCountChange={onTargetCountChange}
        onMarkSelectedComplete={onMarkSelectedComplete}
        onUndoSelectedCompletion={onUndoSelectedCompletion}
        {...overrides}
      />
    </LanguageProvider>,
  );
  return { onTargetCountChange, onMarkSelectedComplete, onUndoSelectedCompletion };
}

describe("ProgressPanel", () => {
  test("shows completed, remaining, and completion percentage", () => {
    setup({ targetCount: 10, completedIds: new Set(["a", "b", "c"]) });
    expect(screen.getByText("3")).toBeTruthy(); // completed
    expect(screen.getByText("7")).toBeTruthy(); // remaining
    expect(screen.getByText(/30%/)).toBeTruthy();
  });

  test("clamps completion percentage at 100% and reports overage separately when completed exceeds target", () => {
    setup({ targetCount: 5, completedIds: new Set(["a", "b", "c", "d", "e", "f"]) });
    expect(screen.getByText(/100%/)).toBeTruthy();
    expect(screen.getByText("0")).toBeTruthy(); // remaining never negative
    expect(screen.getByText(/\+1 over target/)).toBeTruthy();
  });

  test("does not show an over-target note when completed is within target", () => {
    setup({ targetCount: 10, completedIds: new Set(["a"]) });
    expect(screen.queryByText(/over target/)).toBeNull();
  });

  test("target count input only accepts 1-100 and reports changes", () => {
    setup();
    const input = screen.getByLabelText("Today's target count") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "55" } });
    expect(input.min).toBe("1");
    expect(input.max).toBe("100");
  });

  test("mark-complete and undo buttons call their handlers", () => {
    const { onMarkSelectedComplete, onUndoSelectedCompletion } = setup({
      selectedIds: new Set(["a"]),
      undoAvailable: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "Mark selected complete" }));
    expect(onMarkSelectedComplete).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Undo completion" }));
    expect(onUndoSelectedCompletion).toHaveBeenCalled();
  });

  test("hides the mark-complete/undo actions entirely when nothing is selected", () => {
    setup({ selectedIds: new Set() });
    expect(screen.queryByRole("button", { name: "Mark selected complete" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Undo completion" })).toBeNull();
  });

  describe("progress bar", () => {
    test("renders zero progress with correct fill and accessible attributes", () => {
      setup({ targetCount: 20, completedIds: new Set() });
      const bar = screen.getByRole("progressbar");
      expect(bar.getAttribute("aria-valuemin")).toBe("0");
      expect(bar.getAttribute("aria-valuemax")).toBe("100");
      expect(bar.getAttribute("aria-valuenow")).toBe("0");
      const fill = bar.querySelector(".progress-panel__bar-fill") as HTMLElement;
      expect(fill.style.width).toBe("0%");
    });

    test("renders partial progress with a proportional fill", () => {
      setup({ targetCount: 4, completedIds: new Set(["a"]) });
      const bar = screen.getByRole("progressbar");
      expect(bar.getAttribute("aria-valuenow")).toBe("25");
      const fill = bar.querySelector(".progress-panel__bar-fill") as HTMLElement;
      expect(fill.style.width).toBe("25%");
    });

    test("renders 100% progress when completed exactly meets the target", () => {
      setup({ targetCount: 3, completedIds: new Set(["a", "b", "c"]) });
      const bar = screen.getByRole("progressbar");
      expect(bar.getAttribute("aria-valuenow")).toBe("100");
      const fill = bar.querySelector(".progress-panel__bar-fill") as HTMLElement;
      expect(fill.style.width).toBe("100%");
    });

    test("clamps the fill and aria-valuenow at 100% when completed exceeds the target", () => {
      setup({ targetCount: 2, completedIds: new Set(["a", "b", "c", "d"]) });
      const bar = screen.getByRole("progressbar");
      expect(bar.getAttribute("aria-valuenow")).toBe("100");
      const fill = bar.querySelector(".progress-panel__bar-fill") as HTMLElement;
      expect(fill.style.width).toBe("100%");
    });

    test("has an accessible name in Korean by default", () => {
      setup({ targetCount: 10, completedIds: new Set(["a"]) }, "ko");
      const bar = screen.getByRole("progressbar");
      expect(bar.getAttribute("aria-label")).toBe("완료율");
    });

    test("has an accessible name in English", () => {
      setup({ targetCount: 10, completedIds: new Set(["a"]) }, "en");
      const bar = screen.getByRole("progressbar");
      expect(bar.getAttribute("aria-label")).toBe("Completion");
    });
  });
});
