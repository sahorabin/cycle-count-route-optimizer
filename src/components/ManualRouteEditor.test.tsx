// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ManualRouteEditor } from "./ManualRouteEditor";
import { LanguageProvider } from "../i18n/LanguageContext";

function setup(stopIds: string[]) {
  const labels = new Map(stopIds.map((id) => [id, `Label ${id}`]));
  const moveUp = vi.fn();
  const moveDown = vi.fn();
  const removeStop = vi.fn();
  const clear = vi.fn();
  const generate = vi.fn();
  render(
    <LanguageProvider initialLanguage="en">
      <ManualRouteEditor
        stopIds={stopIds}
        labels={labels}
        onMoveUp={moveUp}
        onMoveDown={moveDown}
        onRemove={removeStop}
        onClear={clear}
        onGenerate={generate}
      />
    </LanguageProvider>,
  );
  return { moveUp, moveDown, removeStop, clear, generate };
}

describe("ManualRouteEditor", () => {
  test("Office is always shown as the fixed first row, even with no stops", () => {
    setup([]);
    const items = screen.getAllByRole("listitem");
    expect(items[0].textContent).toContain("Office (fixed start)");
  });

  test("shows an empty-state hint with no stops", () => {
    setup([]);
    expect(screen.getByText("Click a selected location on the map to add it to the route.")).toBeTruthy();
  });

  test("lists stops in order with sequence numbers after the office row", () => {
    setup(["a", "b"]);
    const items = screen.getAllByRole("listitem");
    expect(items[0].textContent).toContain("Office (fixed start)");
    expect(items[1].textContent).toContain("1");
    expect(items[1].textContent).toContain("Label a");
    expect(items[2].textContent).toContain("Label b");
  });

  test("move up/down and remove call back with the correct index/id", () => {
    const { moveUp, moveDown, removeStop } = setup(["a", "b", "c"]);
    fireEvent.click(screen.getAllByRole("button", { name: "Move up" })[1]);
    expect(moveUp).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getAllByRole("button", { name: "Move down" })[0]);
    expect(moveDown).toHaveBeenCalledWith(0);
    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[2]);
    expect(removeStop).toHaveBeenCalledWith("c");
  });

  test("Clear route calls onClear", () => {
    const { clear } = setup(["a"]);
    fireEvent.click(screen.getByRole("button", { name: "Clear route" }));
    expect(clear).toHaveBeenCalled();
  });

  test("Generate recommended route is disabled with fewer than 2 stops", () => {
    setup(["a"]);
    expect(screen.getByRole("button", { name: "Generate recommended route" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  test("Generate recommended route is enabled at 2+ stops and calls back", () => {
    const { generate } = setup(["a", "b"]);
    const button = screen.getByRole("button", { name: "Generate recommended route" });
    expect(button).toHaveProperty("disabled", false);
    fireEvent.click(button);
    expect(generate).toHaveBeenCalled();
  });
});
