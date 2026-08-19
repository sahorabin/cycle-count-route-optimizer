import { useCallback, useState } from "react";
import type { NodeId } from "../domain/types";

export function useManualRoute(initialStopIds: NodeId[] = []) {
  const [stopIds, setStopIds] = useState<NodeId[]>(initialStopIds);

  const addStop = useCallback((id: NodeId) => {
    setStopIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }, []);

  const removeStop = useCallback((id: NodeId) => {
    setStopIds((prev) => prev.filter((stopId) => stopId !== id));
  }, []);

  const removeStops = useCallback((ids: ReadonlySet<NodeId>) => {
    setStopIds((prev) => prev.filter((stopId) => !ids.has(stopId)));
  }, []);

  const moveUp = useCallback((index: number) => {
    setStopIds((prev) => {
      if (index <= 0 || index >= prev.length) return prev;
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  }, []);

  const moveDown = useCallback((index: number) => {
    setStopIds((prev) => {
      if (index < 0 || index >= prev.length - 1) return prev;
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  }, []);

  const moveStop = useCallback((fromIndex: number, toIndex: number) => {
    setStopIds((prev) => {
      if (fromIndex < 0 || fromIndex >= prev.length || toIndex < 0 || toIndex >= prev.length || fromIndex === toIndex) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, []);

  const clear = useCallback(() => setStopIds([]), []);

  return { stopIds, addStop, removeStop, removeStops, moveUp, moveDown, moveStop, clear };
}
