// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ManualRouteEditor } from "./ManualRouteEditor";
import { LanguageProvider } from "../i18n/LanguageContext";

function setup(stopIds: string[]) {
  const labels = new Map(stopIds.map((id) => [id, `Label ${id}`]));
  const moveUp = vi.fn();
  const moveDown = vi.fn();
  const move = vi.fn();
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
        onMove={move}
        onRemove={removeStop}
        onClear={clear}
        onGenerate={generate}
      />
    </LanguageProvider>,
  );
  return { moveUp, moveDown, move, removeStop, clear, generate };
}

describe("ManualRouteEditor", () => {
  test("Office is always shown as the fixed first row, even with no stops", () => {
    setup([]);
    const items = screen.getAllByRole("listitem");
    expect(items[0].textContent).toContain("Office (fixed start)");
    expect(items[0].getAttribute("draggable")).not.toBe("true");
    expect(items[0].querySelector("button")).toBeNull();
  });

  test("shows an empty-state hint with no stops", () => {
    setup([]);
    expect(screen.getByText("Check locations and they will appear here in selection order.")).toBeTruthy();
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
    fireEvent.click(screen.getByRole("button", { name: "Remove Label c" }));
    expect(removeStop).toHaveBeenCalledWith("c");
  });

  test("dragging a destination row reorders the worker route directly", () => {
    const { move } = setup(["a", "b", "c"]);
    const rows = screen.getAllByRole("listitem");
    fireEvent.dragStart(rows[1], { dataTransfer: { effectAllowed: "move", setData: vi.fn() } });
    fireEvent.dragOver(rows[3], { dataTransfer: { dropEffect: "move" } });
    fireEvent.drop(rows[3], { dataTransfer: { getData: () => "0" } });
    expect(move).toHaveBeenCalledWith(0, 2);
  });

  test("Reset route calls onClear", () => {
    const { clear } = setup(["a"]);
    fireEvent.click(screen.getByRole("button", { name: "Reset route" }));
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
    expect(button.className).toContain("manual-route-editor__generate--eligible");
    expect(screen.getByText("The system will calculate a shorter visit route.")).toBeTruthy();
    expect(button.closest(".manual-route-editor__primary-action")).toBeTruthy();
    fireEvent.click(button);
    expect(generate).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Reset route" }).className)
      .toContain("manual-route-editor__reset");
  });

  test("activates restrained CTA attention after 3.5 seconds and interaction cancels it", () => {
    vi.useFakeTimers();
    setup(["a", "b"]);
    const button = screen.getByRole("button", { name: "Generate recommended route" });
    expect(button.className).toContain("manual-route-editor__generate--eligible");
    expect(button.className).not.toContain("manual-route-editor__generate--attention");
    act(() => vi.advanceTimersByTime(3_500));
    expect(button.className).toContain("manual-route-editor__generate--attention");
    fireEvent.click(screen.getByRole("button", { name: "Reset route" }));
    expect(button.className).not.toContain("manual-route-editor__generate--attention");
    vi.useRealTimers();
  });
});
