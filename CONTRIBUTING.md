# Contributing to Docker and Podman Studio

Thank you for your interest in contributing to **Docker and Podman Studio**!

## Project Structure

- `src/` — VS Code Extension Host backend (TypeScript, bundled via `esbuild`):
  - `src/extension.ts` — Extension lifecycle, commands, and Webview message router
  - `src/config.ts` — `dockerPodmanStudio.*` configuration & dual-engine helpers
  - `src/i18n.ts` — Extension Host localization dictionaries (16 languages)
  - `src/services/` — Dual-engine `PodmanService` (`docker` & `podman` CLI runtime), `YamlService`, `ComposeFileDetector`, `StatusProvider`, and `LogProvider`
  - `src/language/` — Compose YAML completion and diagnostics providers
  - `src/wizards/` — Command Palette & Explorer context menu wizards
- `webview-ui/` — Studio Frontend (React 18 + TypeScript + Tailwind CSS + Zustand + Vite):
  - `webview-ui/src/i18n/` — Multi-language dictionaries (`en`, `pt-BR`, `es`, `fr`, `de`, `it`, `ru`, `uk`, `pl`, `tr`, `nl`, `ja`, `ko`, `zh-CN`, `zh-TW`, `hi`)
  - `webview-ui/src/pages/` — Studio feature pages (Dashboard, Compose, Containers, Pods, Images, Volumes, Networks, Tools, Settings)
  - `webview-ui/src/components/` — Shared UI primitives, Sidebar switcher, Topology graph, Log viewer, and modals

## Local Development

1. Install dependencies:
   ```bash
   npm install
   npm --prefix webview-ui install
   ```
2. Build everything:
   ```bash
   npm run build:all
   ```
3. Press `F5` in VS Code to launch an **Extension Development Host** window.

## Tests

Run `npm test` for the regression suite. It does not require Podman and skips the opt-in integration tests. CI runs the same suite, type-checks the extension host, and builds the webview and extension.

### Podman integration tests

These opt-in tests create uniquely named containers, pods, networks, volumes, images, and Compose projects, then remove only those test resources. They require a running Podman engine with CPU and memory limit support, a compatible Compose provider, and a Linux image that is already available locally and contains `sh`. Image-declared volume paths are mounted as temporary filesystems to avoid leaving anonymous volumes; paths containing commas, colons, dollar signs, or newlines are not supported. They do not run global prune, machine lifecycle, registry login/logout, or push commands. Use an isolated test engine when possible.

On Windows PowerShell:

```powershell
$env:PODMAN_INTEGRATION_TESTS = '1'
$env:PODMAN_TEST_IMAGE = 'docker.io/library/redis:7-alpine'
# Optional: an existing writable directory for temporary Compose and build files.
$env:PODMAN_TEST_ROOT = $env:TEMP
node --test tests\podman.integration.test.cjs
```

On Linux or macOS:

```bash
export PODMAN_INTEGRATION_TESTS=1
export PODMAN_TEST_IMAGE=docker.io/library/redis:7-alpine
# Optional: export PODMAN_TEST_ROOT=/path/to/existing/writable/directory
node --test tests/podman.integration.test.cjs
```

The image is checked locally rather than pulled automatically. The tests cover runtime-scaled replica lifecycle/logs and Down directly after scale-up, both standalone and grouped into a pod. They report cleanup failures explicitly. Podman 6.1.4 with podman-compose 1.6.0 on Windows has been exercised; other Podman versions, operating systems, and Compose providers should also be tested in their own environments.

To additionally exercise Studio and its interactive shell and logs terminals in an isolated VS Code Extension Development Host on Windows, run from the repository root:

```powershell
$testRoot = Join-Path $env:TEMP ("studio-vscode-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot | Out-Null
$env:PODMAN_TEST_IMAGE = 'docker.io/library/redis:7-alpine'
$env:PODMAN_VSCODE_TEST_RESULT = Join-Path $testRoot 'result.txt'
$extensionPath = (Get-Location).Path
code --new-window --wait --user-data-dir (Join-Path $testRoot 'profile') `
  --extensions-dir (Join-Path $testRoot 'extensions') --disable-extensions `
  --disable-workspace-trust --skip-welcome --skip-release-notes `
  "--extensionDevelopmentPath=$extensionPath" `
  "--extensionTestsPath=$extensionPath\tests\vscode-host.cjs"
if (!(Test-Path -LiteralPath $env:PODMAN_VSCODE_TEST_RESULT)) { throw 'No test result was written.' }
$result = (Get-Content -LiteralPath $env:PODMAN_VSCODE_TEST_RESULT -Raw).Trim()
if ($result -ne 'passed') { throw $result }
```

This opens a separate VS Code profile, creates one uniquely named Podman container from the local image, and removes that container afterward. Its profile and logs remain under `$testRoot`.

## Adding or Updating Translations

1. Add any new keys to `webview-ui/src/i18n/en.ts` (`TranslationDict` enforces compile-time parity across all 16 locale files), `src/i18n.ts`, and `package.nls.json`.
2. Update the corresponding locale files in `webview-ui/src/i18n/*.ts` and `package.nls.*.json`.
3. Run `npm run build:all` to verify TypeScript type safety across all languages.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
