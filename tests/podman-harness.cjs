const Module = require('node:module');
const path = require('node:path');
const esbuild = require('esbuild');

const config = {
  engine: 'podman',
  podmanPath: 'podman',
  dockerPath: 'docker',
  composePath: '',
  composeCommandStyle: 'auto',
  inPod: 'default',
  machineName: 'podman-machine-default',
};

class EventEmitter {
  constructor() {
    this.listeners = new Set();
    this.event = (listener) => {
      this.listeners.add(listener);
      return { dispose: () => this.listeners.delete(listener) };
    };
  }

  fire(value) {
    for (const listener of this.listeners) {
      listener(value);
    }
  }

  dispose() {
    this.listeners.clear();
  }
}

const vscode = {
  EventEmitter,
  StatusBarAlignment: { Left: 1 },
  env: { language: 'en' },
  workspace: {
    workspaceFolders: undefined,
    getConfiguration: () => ({
      get: (key, fallback) => config[key] ?? fallback,
    }),
  },
  window: {
    createTerminal: () => ({ show() {}, sendText() {} }),
    createOutputChannel: () => ({ appendLine() {}, show() {} }),
    createStatusBarItem: () => ({ show() {}, hide() {}, dispose() {} }),
    showErrorMessage: async () => undefined,
    showInformationMessage: async () => undefined,
    showWarningMessage: async () => undefined,
  },
};

function loadModule(relativePath) {
  const entry = path.resolve(__dirname, '..', relativePath);
  const output = esbuild.buildSync({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['vscode'],
    write: false,
    logLevel: 'silent',
  }).outputFiles[0].text;
  const instance = new Module(entry, module);
  instance.filename = entry;
  instance.paths = Module._nodeModulePaths(path.dirname(entry));
  const requireOriginal = instance.require;
  instance.require = function (id) {
    return id === 'vscode' ? vscode : requireOriginal.call(this, id);
  };
  instance._compile(output, entry);
  return instance.exports;
}

const loadService = () => loadModule(path.join('src', 'services', 'podmanService.ts')).PodmanService;
const loadLogProvider = () => loadModule(path.join('src', 'services', 'logProvider.ts')).LogProvider;
const loadStatusProvider = () => loadModule(path.join('src', 'services', 'statusProvider.ts')).StatusProvider;
const loadNativeCommands = () => loadModule(path.join('src', 'wizards', 'nativeWizards.ts')).NativeCommandsManager;

module.exports = {
  config,
  vscode,
  loadModule,
  loadService,
  loadLogProvider,
  loadStatusProvider,
  loadNativeCommands,
};
