// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
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
