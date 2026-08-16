// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ComponentProps } from "react";
import { ComparisonHero } from "./ComparisonHero";
import { LanguageProvider } from "../i18n/LanguageContext";

function setup(
  props: Partial<ComponentProps<typeof ComparisonHero>> = {},
  language: "ko" | "en" = "en",
) {
  const onWalkingSpeedChange = vi.fn();
  const onRouteVisibilityChange = vi.fn();
  const rendered = render(
    <LanguageProvider initialLanguage={language}>
      <ComparisonHero
        step={3}
        manual={{ order: ["office", "a", "b"], totalDistance: 132 }}
        recommended={{ order: ["office", "b", "a"], totalDistance: 91.4 }}
        walkingSpeed={60}
        onWalkingSpeedChange={onWalkingSpeedChange}
        manualStopCount={2}
        comparisonRequested={true}
        routeVisibility="both"
        onRouteVisibilityChange={onRouteVisibilityChange}
        {...props}
      />
    </LanguageProvider>,
  );
  return { onWalkingSpeedChange, onRouteVisibilityChange, ...rendered };
}

describe("ComparisonHero", () => {
  test("step 1 shows an instruction to select today's locations, not the route-comparison heading", () => {
    setup({ step: 1 });
    expect(screen.getByText("Select today's count locations")).toBeTruthy();
    expect(screen.queryByText("Route comparison")).toBeNull();
  });

  test("step 2 shows an instruction to build the worker visit order, not the route-comparison heading", () => {
    setup({ step: 2 });
    expect(screen.getByText("Build the worker visit order")).toBeTruthy();
    expect(screen.queryByText("Route comparison")).toBeNull();
  });

  test("shows the compact empty state, not the full comparison, before a comparison is requested", () => {
    setup({ comparisonRequested: false });
    expect(
      screen.getByText("Add two or more stops to your route, then generate a recommendation"),
    ).toBeTruthy();
    expect(screen.queryByText(/saved/)).toBeNull();
  });

  test("shows the compact empty state with fewer than 2 stops even if a comparison was previously requested", () => {
    setup({ comparisonRequested: true, manualStopCount: 1 });
    expect(
      screen.getByText("Add two or more stops to your route, then generate a recommendation"),
    ).toBeTruthy();
  });

  test("leads with the single-sentence savings summary once a valid comparison is shown", () => {
    const { container } = setup();
    expect(screen.getByText(/saved/)).toBeTruthy();
    expect(screen.getByText(/less walking/)).toBeTruthy();
    const [manualDistance, recommendedDistance] = container.querySelectorAll(".comparison-hero__distance");
    expect(manualDistance.textContent).toBe("132 m");
    expect(recommendedDistance.textContent).toBe("91.4 m");
  });

  test("distance values carry a unit and locale-aware thousands separators", () => {
    const { container } = setup({
      manual: { order: ["office", "a", "b"], totalDistance: 1145 },
      recommended: { order: ["office", "b", "a"], totalDistance: 245 },
    });
    const [manualDistance, recommendedDistance] = container.querySelectorAll(".comparison-hero__distance");
    expect(manualDistance.textContent).toBe("1,145 m");
    expect(recommendedDistance.textContent).toBe("245 m");
    expect(document.querySelector(".comparison-hero__summary")!.textContent).toContain("900 m");
  });

  test("the unit is a visually distinct element from the number, not part of the same text run", () => {
    const { container } = setup();
    const distanceEl = container.querySelector(".comparison-hero__distance")!;
    expect(distanceEl.querySelector(".comparison-hero__unit")).not.toBeNull();
    expect(distanceEl.querySelector(".comparison-hero__unit")!.textContent?.trim()).toBe("m");
  });

  test("never claims a saving when manual and recommended are identical", () => {
    setup({
      manual: { order: ["office", "a"], totalDistance: 50 },
      recommended: { order: ["office", "a"], totalDistance: 50 },
      manualStopCount: 1,
    });
    // Falls back to the compact "need more stops" state since stopCount < 2 --
    // but even if it didn't, no "saved"/"faster" claim exists here.
    expect(screen.queryByText(/saved/)).toBeNull();
    expect(screen.queryByText(/faster/i)).toBeNull();
  });

  test("walking speed input reports changes", () => {
    const { onWalkingSpeedChange } = setup();
    fireEvent.change(screen.getByLabelText("Walking speed (metres/minute)"), {
      target: { value: "75" },
    });
    expect(onWalkingSpeedChange).toHaveBeenCalledWith(75);
  });

  test("route visibility toggle reports changes and reflects the current selection", () => {
    const { onRouteVisibilityChange } = setup({ routeVisibility: "worker" });
    const workerRadio = screen.getByRole("radio", { name: "Worker route" }) as HTMLInputElement;
    const bothRadio = screen.getByRole("radio", { name: "Both" }) as HTMLInputElement;
    expect(workerRadio.checked).toBe(true);
    expect(bothRadio.checked).toBe(false);
    fireEvent.click(bothRadio);
    expect(onRouteVisibilityChange).toHaveBeenCalledWith("both");
  });

  test("localizes the route-visibility group and links the result to replay", () => {
    const english = setup();
    expect(screen.getByRole("group", { name: "Route visibility" })).toBeTruthy();
    expect(
      screen.getByText("Next: See how both routes progress on the shared-clock simulation below."),
    ).toBeTruthy();
    english.unmount();

    setup({}, "ko");
    expect(screen.getByRole("group", { name: "경로 표시" })).toBeTruthy();
    expect(
      screen.getByText("다음: 아래 공유 시계 시뮬레이션에서 두 경로의 진행 차이를 확인하세요."),
    ).toBeTruthy();
  });

  test("never labels the recommended route as mathematically optimal", () => {
    setup();
    expect(screen.queryByText(/mathematically optimal/i)).toBeNull();
    expect(screen.getAllByText("System recommended route").length).toBeGreaterThan(0);
  });
});
