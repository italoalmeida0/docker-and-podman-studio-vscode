# Changelog

All notable changes to **Docker and Podman Studio** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.0] - 2026-10-30

### Added
- Live command output, elapsed time, and actual batch counts for supported Studio operations, with VS Code progress for Command Palette actions.
- Configurable timeout for long-running engine actions, from 5 to 720 minutes.
- Concise explanations for common failures and expandable technical details, including partial batch results.

### Changed
- Success messages dismiss automatically; errors remain until closed. Forms retain their input after failed actions, and settings refreshes preserve unsaved fields.
- Builds and image transfers explain that they can take longer without inventing a completion estimate. The Studio output channel keeps the available operation log.
- On timeout, Studio requests that the local command stop, warns that engine-side work may continue, and leaves remaining batch items unattempted.

### Fixed
- Prevented concurrent operation output and completion indicators from being attributed to the wrong action.
- Grouped settings refreshes and retained settings polling updates, while surfacing a failed registry login after a partial settings save.

## [1.3.0] - 2026-10-30

### Added
- Create multiple services in the Compose wizard and add image- or build-based services to an existing project.
- Configure ordered Compose files, profiles, and an environment file, with provider-resolved project details.
- Build individual or selected services, rebuild without cache, or explicitly build and start them.
- Follow logs from all replicas or one container, pause the display, and replay retained timestamped lines.

### Changed
- Edit common service fields visually or switch to YAML while preserving untouched advanced fields, comments, and anchors.
- Expanded topology and replica details, with sensitive environment values masked by default in selected views.

### Fixed
- Protected drafts against external changes, unsaved editors, project changes, and active services, including those in unselected profiles.
- Podman batch removal now removes selected dependent containers before their dependencies without deleting unselected containers.
- Fixed creation of missing YAML resource sections and duplicate Compose file choices on Windows.

## [1.2.0] - 2026-10-30

### Added
- Multi-selection for images, unused volumes and networks, and Compose services, including batch lifecycle and build actions for selected services.
- Visible progress indicators, persistent error messages, and access to the Studio output channel for operation diagnostics.
- Unused volume and network cleanup with explicit candidate names and confirmation, including named and anonymous volumes.

### Changed
- Podman pods and their containers, including empty pods, are grouped in the Containers tree; other Compose containers are grouped by project.
- VS Code activity bar, status bar, and Studio tab icons use branding based on the original extension icon.
- Cleanup protects default networks and resources referenced by stopped containers, and rechecks resource identities before removal without force.

### Fixed
- Prevented stale resource and Compose status updates when switching engines or changing the active Compose file.
- Reported unavailable Compose files clearly and cleared their stale status.
- Added timeouts, cancellation, and visible errors for registry connection tests and Compose image searches.
- The Studio sidebar now displays the installed extension version instead of a hard-coded version.

## [1.1.0] - 2026-10-29

### Added
- Podman container and pod multi-selection with batch start, stop, and restart, plus individual pause and resume controls.
- Podman Compose service scaling, including zero replicas, explicit replica-count input, and confirmation before reducing replicas.
- Replica-aware Compose status, lifecycle controls, and log streaming, including remote Podman connections.
- Automated Marketplace publishing through GitHub Actions and Trusted Publishing, triggered by version tags or manually from main.
- Regression coverage and opt-in practical Podman and VS Code extension-host tests.

### Fixed
- Podman Compose Down now verifies removal and cleans up confirmed replicas left behind by the provider after runtime scaling.
- Safer image, network, and volume removal without forcing deletion of resources in use.
- Correct paused and restarting states, exposed-only ports, and protection for Podman infra containers.
- Command argument handling, custom executable paths, timeout handling, provider fallback, and registry logout error reporting.
- Log buffering, UTF-8 decoding, stream cancellation, stale status updates, and overlapping operation state.

### Changed
- Windows Podman commands require native executables or PowerShell scripts; unsafe `.cmd` and `.bat` wrappers are rejected.
- Development and publishing tools now require Node.js 22 or newer.

## [1.0.0] - 2026-10-29

### Added
- **Dual-Engine Container Runtime (`Docker` Default & `Podman`)**:
  - Instant switching between **Docker** (`docker` + `docker compose` / `docker-compose`, default) and **Podman** (`podman` + `podman-compose` / `podman compose`) via Settings (`dockerPodmanStudio.engine`), Sidebar toggle, Activity Bar, or Command Palette.
  - **Docker Contexts** manager (`docker context ls` / `docker context use`) in Docker mode and **Podman Machine** VM lifecycle controls (`start`, `stop`, `restart`) in Podman mode.
- **Visual Compose Studio**:
  - Overview dashboard, interactive drag-and-drop **Topology Graph** with right-click service context menu, **Services** inspector with runtime-locked YAML fragment editing, **Variables** explorer, **Resources** manager, **Raw YAML** editor, real-time **Log Streaming**, and visual **Service Builder**.
  - **New Compose Wizard** with `Dockerfile` & `Containerfile` support, healthcheck configurator, live YAML preview, and OCI image search across **Docker Hub**, **Quay.io**, **GHCR**, **ACR**, **ECR**, and custom registries.
  - Smart Compose auto-discovery across workspace folders, persisted user-registered paths, and active Docker/Podman container labels.
  - YAML IntelliSense completions and schema diagnostics for Compose files.
- **Complete Resource Management**:
  - **Dashboard**: Daemon/engine health, contexts/machines, host specifications, and `system df` disk usage breakdown.
  - **Containers**: Simple & Advanced creation wizards, Interactive Terminal (`exec -it`), and multi-target log viewing (Studio, Output Channel, Terminal).
  - **Pods *(Podman Mode)***: Create Kubernetes-style Pods (`--hostname`, `-p`, `--network`, `--add-host`, `--cpu-shares`, `--label`), inspect member containers, stream Pod logs, and control lifecycles.
  - **OCI Images**: Pull, Build from `Dockerfile` / `Containerfile`, Push to registries, and Prune suite (dangling images, unused images, builder cache).
  - **Volumes & Networks**: Full CRUD, driver/subnet/DNS/IPv6 inspection, and unused volume pruning.
  - **Encrypted Private Registry Auth**: Backed by VS Code `SecretStorage` with automatic `docker login` / `podman login` integration.
- **Multi-Language Support (16 Languages + `auto`)**:
  - Full UI, Status Bar, notifications, Command Palette (`package.nls.*.json`), and Settings localization for English (`en`), Portuguese (`pt-BR`), Spanish (`es`), French (`fr`), German (`de`), Italian (`it`), Russian (`ru`), Ukrainian (`uk`), Polish (`pl`), Turkish (`tr`), Dutch (`nl`), Japanese (`ja`), Korean (`ko`), Simplified Chinese (`zh-CN`), Traditional Chinese (`zh-TW`), and Hindi (`hi`).
