import "@testing-library/jest-dom/vitest";
import { loadEnv } from "vite";

// Vitest's jsdom environment replaces global Uint8Array with jsdom's own
// constructor, which breaks esbuild's own `instanceof` self-check on the
// very next transform (vitest-dev/vitest#4043, still open). Restore Node's
// original Uint8Array via Buffer's prototype chain (fixed at Node startup,
// unaffected by jsdom's later reassignment) so per-file jsdom tests can
// coexist with the rest of the node-environment suite.
globalThis.Uint8Array = Object.getPrototypeOf(globalThis.Buffer) as Uint8ArrayConstructor;

// jsdom (v30) doesn't implement HTMLDialogElement.showModal()/close() yet.
// The app relies on native <dialog> for its confirm dialogs, so polyfill just
// enough for jsdom-environment component tests: toggle the `open` attribute,
// which both `dialog.open` and Testing Library's dialog-visibility check
// (which treats a <dialog> without `open` as inaccessible) key off of.
// lib.dom.d.ts declares showModal/close as always-present, so this widens the
// local view to `?:` to reflect what's actually true in jsdom at runtime.
interface PartialDialogProto {
  showModal?: () => void;
  close?: () => void;
}
if (typeof HTMLDialogElement !== "undefined") {
  const dialogProto = HTMLDialogElement.prototype as Omit<HTMLDialogElement, "showModal" | "close"> &
    PartialDialogProto;
  if (!dialogProto.showModal) {
    dialogProto.showModal = function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
    dialogProto.close = function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    };
  }
}

// astro:env only exposes vars declared in astro.config.mjs's schema (app-facing).
// Test-only secrets like SUPABASE_SERVICE_ROLE_KEY live outside that schema, so
// tests read them from process.env directly; this loads .env.test.local (and
// .env) the same way CI's `$GITHUB_ENV` step does, without overriding any var a
// real shell/CI environment already set.
const testEnv = loadEnv("test", process.cwd(), "");
for (const [key, value] of Object.entries(testEnv)) {
  process.env[key] ??= value;
}
