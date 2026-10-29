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

## Adding or Updating Translations

1. Add any new keys to `webview-ui/src/i18n/en.ts` (`TranslationDict` enforces compile-time parity across all 16 locale files), `src/i18n.ts`, and `package.nls.json`.
2. Update the corresponding locale files in `webview-ui/src/i18n/*.ts` and `package.nls.*.json`.
3. Run `npm run build:all` to verify TypeScript type safety across all languages.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
