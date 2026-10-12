// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { WorkflowSteps } from "./WorkflowSteps";
import { LanguageProvider } from "../i18n/LanguageContext";

function setup(step: 1 | 2 | 3) {
  return render(
    <LanguageProvider initialLanguage="en">
      <WorkflowSteps step={step} />
    </LanguageProvider>,
  );
}

describe("WorkflowSteps", () => {
  test("marks exactly the current step with aria-current='step'", () => {
    setup(2);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0].getAttribute("aria-current")).toBeNull();
    expect(items[1].getAttribute("aria-current")).toBe("step");
    expect(items[2].getAttribute("aria-current")).toBeNull();
  });

  test("shows all three step labels", () => {
    setup(1);
    expect(screen.getByText("Select locations")).toBeTruthy();
    expect(screen.getByText("Generate & compare")).toBeTruthy();
    expect(screen.getByText("Play simulation")).toBeTruthy();
  });
});

test("all steps are semantic buttons that dispatch navigation", () => {
  const navigate = vi.fn();
  render(<LanguageProvider initialLanguage="en"><WorkflowSteps step={1} onNavigate={navigate} /></LanguageProvider>);
  const buttons = screen.getAllByRole("button");
  expect(buttons).toHaveLength(3);
  buttons.forEach((button) => fireEvent.click(button));
  expect(navigate.mock.calls).toEqual([[1], [2], [3]]);
  expect(buttons[0].getAttribute("aria-current")).toBe("step");
});
