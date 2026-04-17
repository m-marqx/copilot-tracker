/**
 * Test setup — runs before all tests via mocha --require.
 * Registers a module alias so `import * as vscode from 'vscode'`
 * resolves to our mock.
 */
import Module from 'node:module';
import path from 'node:path';
import sinon from 'sinon';

const mockPath = path.resolve(__dirname, '__mocks__', 'vscode');

// Intercept require('vscode') and return the mock
const originalResolveFilename = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (request: string, ...args: any[]) {
  if (request === 'vscode') {
    return originalResolveFilename.call(this, mockPath, ...args);
  }
  return originalResolveFilename.call(this, request, ...args);
};

// Auto-restore sinon stubs after each test (root hook plugin for mocha)
export const mochaHooks = {
  afterEach() {
    sinon.restore();
  },
};
