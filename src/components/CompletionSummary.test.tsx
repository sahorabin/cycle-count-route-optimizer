// @vitest-environment jsdom
import { render, screen, fireEvent } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { sampleWarehouse } from "../data/sampleWarehouse";
import { buildValidatedDistanceMatrix } from "../domain/distanceMatrix";
import { buildRouteTraversal } from "../domain/routeTraversal";
import { buildRouteTimeline } from "../domain/routeTimeline";
import { nearestNeighborRoute } from "../domain/nearestNeighbor";
import { twoOptRoute } from "../domain/twoOpt";
import { LanguageProvider } from "../i18n/LanguageContext";
import { CompletionSummary } from "./CompletionSummary";
import { compareRoutes } from "../ui/routeComparison";
import { getSharedComparisonSavings } from "../ui/sharedSimulationComparison";
import { buildDemoCountServiceProfiles } from "../data/demoCountService";

for (const language of ["en", "ko"] as const) {
  test(`summary consumes authoritative distance, walking and service values (${language})`, () => {
    const ids = sampleWarehouse.locations.map((location) => location.id);
    const route = nearestNeighborRoute(sampleWarehouse, ids);
    const recommendedRoute = twoOptRoute(sampleWarehouse, ids, route);
    const matrix = buildValidatedDistanceMatrix(sampleWarehouse);
    const service = buildDemoCountServiceProfiles(ids);
    const worker = { route, timeline: buildRouteTimeline(buildRouteTraversal(sampleWarehouse, route, matrix), 60, service) };
    const recommended = { route: recommendedRoute, timeline: buildRouteTimeline(buildRouteTraversal(sampleWarehouse, recommendedRoute, matrix), 60, service) };
    const review = vi.fn();
    render(<LanguageProvider initialLanguage={language}><CompletionSummary worker={worker} recommended={recommended} onReview={review} onStartNewWork={vi.fn()} /></LanguageProvider>);
    const text = screen.getByRole("dialog").textContent!;
    const duration = (seconds: number) => language === "en" ? `${Math.floor(Math.round(seconds) / 60)} min ${Math.round(seconds) % 60} sec` : `${Math.floor(Math.round(seconds) / 60)}분 ${Math.round(seconds) % 60}초`;
    for (const input of [worker, recommended]) {
      expect(text).toContain(input.timeline.totalDistance.toLocaleString(language, { maximumFractionDigits: 1 }));
      expect(text).toContain(duration(input.timeline.walkingDurationSeconds));
    }
    const distance = compareRoutes(route, recommendedRoute);
    expect(text).toContain(distance.distanceSaved.toLocaleString(language, { maximumFractionDigits: 1 }));
    expect(text).toContain(`${distance.improvementPct.toFixed(1)}%`);
    expect(text).toContain(duration(getSharedComparisonSavings(worker.timeline, recommended.timeline).walkingSecondsSaved));
    expect(text).toContain(duration(worker.timeline.serviceDurationSeconds));
    expect(worker.timeline.serviceDurationSeconds).toBe(recommended.timeline.serviceDurationSeconds);
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { bubbles: false, cancelable: true }));
    expect(review).toHaveBeenCalledOnce();
  });
}
