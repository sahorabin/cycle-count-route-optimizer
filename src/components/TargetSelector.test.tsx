// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState, type ComponentProps } from "react";
import { TargetSelector } from "./TargetSelector";
import { LanguageProvider } from "../i18n/LanguageContext";
import { largeWarehouse } from "../data/largeWarehouse";

function Controlled(overrides: Partial<ComponentProps<typeof TargetSelector>> = {}) {
  const [search, setSearch] = useState(overrides.search ?? "");
  const [zone, setZone] = useState(overrides.zone ?? "");
  return (
    <TargetSelector
      locations={largeWarehouse.locations}
      selected={new Set()}
      completedIds={new Set()}
      search={search}
      zone={zone}
      onSearchChange={setSearch}
      onZoneChange={setZone}
      onToggle={vi.fn()}
      onSelectVisible={vi.fn()}
      onClearAll={vi.fn()}
      onContinueToRoute={vi.fn()}
      {...overrides}
      orderedIds={overrides.orderedIds ?? []}
    />
  );
}

function setup(overrides: Partial<ComponentProps<typeof TargetSelector>> = {}) {
  const onToggle = vi.fn();
  const onSelectVisible = vi.fn();
  const onClearAll = vi.fn();
  const onContinueToRoute = vi.fn();
  const { container } = render(
    <LanguageProvider initialLanguage="en">
      <Controlled
        onToggle={onToggle}
        onSelectVisible={onSelectVisible}
        onClearAll={onClearAll}
        onContinueToRoute={onContinueToRoute}
        {...overrides}
      />
    </LanguageProvider>,
  );
  return { onToggle, onSelectVisible, onClearAll, onContinueToRoute, container };
}

describe("TargetSelector", () => {
  test("shows the selected count out of 100", () => {
    setup({ selected: new Set(["loc-A01", "loc-A02"]) });
    expect(screen.getByText("2 of 100 selected")).toBeTruthy();
  });

  test("explains that checkbox order directly becomes worker visit order", () => {
    setup();
    expect(
      screen.getByText("Select locations in visit order. Your selection order becomes the worker route."),
    ).toBeTruthy();
  });

  test("text search filters the visible list by label", () => {
    setup();
    fireEvent.change(screen.getByPlaceholderText("Search locations"), {
      target: { value: "Zone B - Bin 03" },
    });
    expect(screen.getByText("Zone B - Bin 03")).toBeTruthy();
    expect(screen.queryByText("Zone A - Bin 01")).toBeNull();
  });

  test("zone filter narrows the visible list to one zone", () => {
    setup();
    fireEvent.change(screen.getByLabelText("zone"), { target: { value: "Zone C" } });
    expect(screen.getAllByRole("checkbox")).toHaveLength(11); // 10 locations + the "selected only" toggle
  });

  test("Select visible calls back with only the currently filtered ids", () => {
    const { onSelectVisible } = setup();
    fireEvent.change(screen.getByLabelText("zone"), { target: { value: "Zone C" } });
    fireEvent.click(screen.getByRole("button", { name: "Select visible" }));
    const calledWith = onSelectVisible.mock.calls[0][0] as string[];
    expect(calledWith).toHaveLength(10);
    expect(calledWith.every((id) => id.startsWith("loc-C"))).toBe(true);
  });

  test("completed locations stay visible and disabled and bulk selection excludes them", () => {
    const { onToggle, onSelectVisible, container } = setup({ completedIds: new Set(["loc-C03"]) });
    fireEvent.change(screen.getByLabelText("zone"), { target: { value: "Zone C" } });
    const completed = screen.getByRole("checkbox", { name: /Zone C - Bin 03/ }) as HTMLInputElement;
    expect(completed.disabled).toBe(true);
    expect(container.querySelector(".target-selector__row--completed")?.textContent)
      .toContain("Completed");
    fireEvent.click(completed);
    expect(onToggle).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Select visible" }));
    const ids = onSelectVisible.mock.calls[0][0] as string[];
    expect(ids).toHaveLength(9);
    expect(ids).not.toContain("loc-C03");
  });

  test("Selected only shows just the currently selected locations", () => {
    setup({ selected: new Set(["loc-A01"]) });
    fireEvent.click(screen.getByRole("checkbox", { name: "Show selected only" }));
    expect(screen.getAllByRole("checkbox")).toHaveLength(2); // the "selected only" toggle + the 1 location
  });

  test("the list container is height-bounded and scrollable", () => {
    setup();
    const list = screen.getByRole("list");
    expect(list.className).toContain("target-selector__list");
  });

  test("the selected tray shows an empty message with nothing selected", () => {
    setup({ selected: new Set() });
    expect(screen.getByText("No locations selected yet.")).toBeTruthy();
  });

  test("the selected tray lists chips for each selected location", () => {
    setup({ selected: new Set(["loc-A01", "loc-B02"]), orderedIds: ["loc-B02", "loc-A01"] });
    const tray = screen.getByText("Worker visit order").closest("div")!;
    expect(tray.textContent).toContain("Zone A - Bin 01");
    expect(tray.textContent).toContain("Zone B - Bin 02");
    expect(tray.textContent?.indexOf("Zone B - Bin 02")).toBeLessThan(
      tray.textContent?.indexOf("Zone A - Bin 01") ?? 0,
    );
  });

  test("each tray chip has an individual remove control that deselects just that location", () => {
    const { onToggle } = setup({ selected: new Set(["loc-A01", "loc-B02"]), orderedIds: ["loc-A01", "loc-B02"] });
    fireEvent.click(screen.getByRole("button", { name: "Remove Zone A - Bin 01" }));
    expect(onToggle).toHaveBeenCalledWith("loc-A01");
    expect(onToggle).not.toHaveBeenCalledWith("loc-B02");
  });

  test("beyond 6 selected locations, the tray collapses to a +N more control instead of clipping silently", () => {
    const eightIds = ["loc-A01", "loc-A02", "loc-A03", "loc-A04", "loc-A05", "loc-A06", "loc-A07", "loc-A08"];
    const { container } = setup({ selected: new Set(eightIds), orderedIds: eightIds });
    const chips = () => container.querySelector(".target-selector__tray-chips")!;

    expect(chips().textContent).toContain("Zone A - Bin 06");
    expect(chips().textContent).not.toContain("Zone A - Bin 07");
    expect(screen.getByRole("button", { name: "+2 more" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "+2 more" }));
    expect(chips().textContent).toContain("Zone A - Bin 07");
    expect(chips().textContent).toContain("Zone A - Bin 08");

    fireEvent.click(screen.getByRole("button", { name: "Show less" }));
    expect(chips().textContent).not.toContain("Zone A - Bin 07");
  });

  test("a location is still individually removable while the tray is expanded", () => {
    const eightIds = ["loc-A01", "loc-A02", "loc-A03", "loc-A04", "loc-A05", "loc-A06", "loc-A07", "loc-A08"];
    const { onToggle } = setup({ selected: new Set(eightIds), orderedIds: eightIds });
    fireEvent.click(screen.getByRole("button", { name: "+2 more" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Zone A - Bin 08" }));
    expect(onToggle).toHaveBeenCalledWith("loc-A08");
  });

  test("Continue to route is disabled with nothing selected and calls back when clicked", () => {
    const { onContinueToRoute } = setup({ selected: new Set(["loc-A01"]), orderedIds: ["loc-A01"] });
    const button = screen.getByRole("button", { name: "Continue to route" });
    expect(button).toHaveProperty("disabled", false);
    fireEvent.click(button);
    expect(onContinueToRoute).toHaveBeenCalled();
  });

  test("Continue to route is disabled when nothing is selected", () => {
    setup({ selected: new Set() });
    expect(screen.getByRole("button", { name: "Continue to route" })).toHaveProperty("disabled", true);
  });
});
