/**
 * Test-only module augmentation. The jest/mocha `vscode` mock in
 * `src/__tests__/__mocks__/vscode.ts` exposes two helpers on
 * `vscode.workspace` that are not part of the real VS Code API.
 *
 * Declare them here so the test tree type-checks against the real
 * `@types/vscode` definitions without requiring `(x as any)` casts.
 */
import 'vscode';

declare module 'vscode' {
  namespace workspace {
    function _setConfig(key: string, value: unknown): void;
    function _clearConfig(): void;
  }
}
