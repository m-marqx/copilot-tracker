/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Minimal VS Code API mock for unit tests.
 * Only the surfaces used by the extension are implemented.
 */

export class MockMemento {
  private store = new Map<string, any>();
  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): T;
  get<T>(key: string, defaultValue?: T): T | undefined {
    return this.store.has(key) ? this.store.get(key) : defaultValue;
  }
  async update(key: string, value: any): Promise<void> {
    if (value === undefined) {
      this.store.delete(key);
    } else {
      this.store.set(key, value);
    }
  }
  keys(): readonly string[] {
    return [...this.store.keys()];
  }
  setKeysForSync(_keys: readonly string[]): void {}
}

export class MockSecretStorage {
  private _store = new Map<string, string>();
  async get(key: string): Promise<string | undefined> {
    return this._store.get(key);
  }
  async store(key: string, value: string): Promise<void> {
    this._store.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this._store.delete(key);
  }
}

// ---- VS Code namespace mock ----

let _configStore: Record<string, any> = {};

export class ThemeColor {
  id: string;
  constructor(id: string) { this.id = id; }
}

export class ThemeIcon {
  id: string;
  color?: ThemeColor;
  constructor(id: string, color?: ThemeColor) { this.id = id; this.color = color; }
}

export class Uri {
  scheme: string;
  authority: string;
  path: string;
  query: string;
  fragment: string;
  constructor(scheme: string, authority: string, path: string, query = '', fragment = '') {
    this.scheme = scheme;
    this.authority = authority;
    this.path = path;
    this.query = query;
    this.fragment = fragment;
  }
  static parse(value: string): Uri {
    try {
      const url = new URL(value);
      return new Uri(url.protocol.replace(':', ''), url.host, url.pathname, url.search, url.hash);
    } catch {
      return new Uri('file', '', value);
    }
  }
  static file(path: string): Uri {
    return new Uri('file', '', path);
  }
  static joinPath(base: Uri, ...segments: string[]): Uri {
    const joined = [base.path, ...segments].join('/').replace(/\/+/g, '/');
    return new Uri(base.scheme, base.authority, joined, base.query, base.fragment);
  }
  toString(): string {
    return `${this.scheme}://${this.authority}${this.path}`;
  }
}

export const StatusBarAlignment = { Left: 1, Right: 2 };

function createMockStatusBarItem(): any {
  return {
    alignment: StatusBarAlignment.Right,
    priority: 100,
    text: '',
    tooltip: '',
    color: undefined,
    backgroundColor: undefined,
    command: undefined,
    name: undefined,
    show: function () {},
    hide: function () {},
    dispose: function () {},
  };
}

const _authentication = {
  getSession: async (_providerId: string, _scopes: string[], _options?: any): Promise<any> => undefined,
};

export const window = {
  createStatusBarItem: (_idOrAlignment?: any, _alignmentOrPriority?: any, _priority?: any) => {
    const item = createMockStatusBarItem();
    if (typeof _idOrAlignment === 'string') {
      item.id = _idOrAlignment;
      if (typeof _alignmentOrPriority === 'number') { item.alignment = _alignmentOrPriority; }
      if (typeof _priority === 'number') { item.priority = _priority; }
    } else if (typeof _idOrAlignment === 'number') {
      item.alignment = _idOrAlignment;
      if (typeof _alignmentOrPriority === 'number') { item.priority = _alignmentOrPriority; }
    }
    return item;
  },
  showInformationMessage: async (..._args: any[]) => undefined as any,
  showWarningMessage: async (..._args: any[]) => undefined as any,
  showErrorMessage: async (..._args: any[]) => undefined as any,
  showInputBox: async (_options?: any) => undefined as string | undefined,
  createWebviewPanel: (_viewType: string, _title: string, _showOptions: any, _options?: any) => {
    const panel: any = {
      viewType: _viewType,
      title: _title,
      webview: {
        html: '',
        options: _options || {},
        cspSource: 'https://mock.csp',
        onDidReceiveMessage: (_listener: any) => ({ dispose: () => {} }),
        postMessage: async (_msg: any) => true,
        asWebviewUri: (uri: any) => uri,
      },
      visible: true,
      viewColumn: 1,
      active: true,
      onDidDispose: (_listener: any) => ({ dispose: () => {} }),
      onDidChangeViewState: (_listener: any) => ({ dispose: () => {} }),
      reveal: () => {},
      dispose: () => {},
      iconPath: undefined,
    };
    return panel;
  },
};

export const workspace = {
  getConfiguration: (section?: string) => ({
    get: <T>(key: string, defaultValue?: T): T | undefined => {
      const fullKey = section ? `${section}.${key}` : key;
      return fullKey in _configStore ? _configStore[fullKey] : defaultValue;
    },
    has: (key: string): boolean => {
      const fullKey = section ? `${section}.${key}` : key;
      return fullKey in _configStore;
    },
    inspect: () => undefined,
    update: async () => {},
  }),
  onDidChangeConfiguration: (_listener: any) => ({ dispose: () => {} }),
  _setConfig: (key: string, value: any) => { _configStore[key] = value; },
  _clearConfig: () => { _configStore = {}; },
};

export const commands = {
  registerCommand: (_command: string, _callback: (...args: any[]) => any) => ({ dispose: () => {} }),
  executeCommand: async (..._args: any[]) => undefined,
};

export const authentication = _authentication;

export const env = {
  openExternal: async (_uri: any) => true,
};

export const ViewColumn = { One: 1, Two: 2, Three: 3 };
