// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TargetSelector } from "./TargetSelector";
import { sampleWarehouse } from "../data/sampleWarehouse";

describe("TargetSelector", () => {
  test("renders one accessible checkbox per cycle-count location, and nothing for office/aisle nodes", () => {
    render(
      <TargetSelector
        locations={sampleWarehouse.locations}
        selected={new Set()}
        onToggle={() => {}}
        onSelectAll={() => {}}
        onClearAll={() => {}}
      />,
    );

    for (const location of sampleWarehouse.locations) {
      expect(screen.getByRole("checkbox", { name: new RegExp(location.label) })).toBeTruthy();
    }
    expect(screen.queryByText(sampleWarehouse.start.label)).toBeNull();
    for (const aisleNode of sampleWarehouse.aisleNodes) {
      expect(screen.queryByRole("checkbox", { name: new RegExp(`^${aisleNode.id}$`) })).toBeNull();
    }
  });

  test("reflects the selected set in checkbox state", () => {
    render(
      <TargetSelector
        locations={sampleWarehouse.locations}
        selected={new Set(["loc-B"])}
        onToggle={() => {}}
        onSelectAll={() => {}}
        onClearAll={() => {}}
      />,
    );

    const checkbox = screen.getByRole("checkbox", { name: /Bin A2-Mid/ }) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    const other = screen.getByRole("checkbox", { name: /Bin A1-Back/ }) as HTMLInputElement;
    expect(other.checked).toBe(false);
  });

  test("calls onToggle with the location id when its checkbox is clicked", () => {
    const onToggle = vi.fn();
    render(
      <TargetSelector
        locations={sampleWarehouse.locations}
        selected={new Set()}
        onToggle={onToggle}
        onSelectAll={() => {}}
        onClearAll={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: /Bin A3-Back/ }));

    expect(onToggle).toHaveBeenCalledWith("loc-C");
  });

  test("Select all and Clear all call their handlers", () => {
    const onSelectAll = vi.fn();
    const onClearAll = vi.fn();
    render(
      <TargetSelector
        locations={sampleWarehouse.locations}
        selected={new Set()}
        onToggle={() => {}}
        onSelectAll={onSelectAll}
        onClearAll={onClearAll}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));

    expect(onSelectAll).toHaveBeenCalledTimes(1);
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });
});
