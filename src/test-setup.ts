import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(cleanup);

/**
 * Node 25+ ships its own experimental global `localStorage` (backed by a
 * file, gated behind --localstorage-file), which under jsdom's test
 * environment shadows jsdom's real Storage implementation with a
 * non-functional stub (no setItem/getItem/clear). Replace it with a
 * plain in-memory Storage-compatible polyfill for tests, matching
 * jsdom/browser localStorage semantics closely enough for this app's use.
 */
if (typeof window !== "undefined" && typeof window.localStorage?.setItem !== "function") {
  class MemoryStorage {
    #store = new Map<string, string>();
    getItem(key: string): string | null {
      return this.#store.has(key) ? this.#store.get(key)! : null;
    }
    setItem(key: string, value: string): void {
      this.#store.set(key, String(value));
    }
    removeItem(key: string): void {
      this.#store.delete(key);
    }
    clear(): void {
      this.#store.clear();
    }
    key(index: number): string | null {
      return [...this.#store.keys()][index] ?? null;
    }
    get length(): number {
      return this.#store.size;
    }
  }

  Object.defineProperty(window, "localStorage", {
    value: new MemoryStorage(),
    configurable: true,
  });
}
