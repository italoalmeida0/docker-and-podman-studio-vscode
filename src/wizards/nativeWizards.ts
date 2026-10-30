import * as path from 'path';
import * as vscode from 'vscode';
import {
  ContainerEngine,
  getConfig,
  getEngineLabel,
  resetEnginePaths,
  updateEngineSetting,
} from '../config';
import { bt } from '../i18n';
import { ComposeFileDetector } from '../services/composeDetector';
import { PodmanService } from '../services/podmanService';
import { StatusProvider } from '../services/statusProvider';
import { OperationEvent } from '../shared/operationFeedback';
import { CommandResult } from '../types';
import { showErrorWithCopy } from '../ui/messageUtil';
import { withStatus } from '../ui/statusBarManager';

export class NativeCommandsManager implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly podman: PodmanService,
    private readonly fileDetector: ComposeFileDetector,
    private readonly statusProvider: StatusProvider,
    private readonly onStateMutated: (selectedComposeFile?: string) => Promise<void>,
    private readonly withStudioProgress: <T>(
      key: string, label: string, task: (report: (event: OperationEvent) => void) => Promise<T>
    ) => Promise<T>,
    private readonly output: vscode.OutputChannel
  ) {}

  private showCommandFailure(label: string, result: CommandResult): void {
    const details = [result.stderr?.trim(), result.stdout?.trim()].filter(Boolean).join('\n') ||
      bt('engineFailedDefault', { engine: getEngineLabel() });
    showErrorWithCopy(details, result.commandStr, this.output, label, result.errorCode, result);
  }

  private async runCommand(
    label: string,
    task: () => Promise<CommandResult>
  ): Promise<CommandResult | undefined> {
    try {
      return await this.withStudioProgress('native-command', label, async (report) =>
        await vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: label,
          cancellable: false,
        }, (progress) => {
          progress.report({ message: bt('nativeProgressHint') });
          return withStatus(label, () => this.podman.withCommandProgress(report, task));
        })
      );
    } catch (error) {
      this.showCommandFailure(label, {
        success: false,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: -1,
      });
      return undefined;
    }
  }

  private async runLookup<T>(label: string, task: () => Promise<T>): Promise<T | undefined> {
    try {
      return await this.withStudioProgress('native-lookup', label, async () =>
        await vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: label,
          cancellable: false,
        }, task)
      );
    } catch (error) {
      this.showCommandFailure(label, {
        success: false,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: -1,
      });
      return undefined;
    }
  }

  public register(context: vscode.ExtensionContext): void {
    this.disposables.push(
      vscode.commands.registerCommand('dockerPodmanStudio.switchEngine', () =>
        this.switchEngineWizard()
      ),
      vscode.commands.registerCommand('dockerPodmanStudio.composeUp', (uri?: vscode.Uri) =>
        this.handleComposeAction('up', uri)
      ),
      vscode.commands.registerCommand('dockerPodmanStudio.composeStart', (uri?: vscode.Uri) =>
        this.handleComposeAction('start', uri)
      ),
      vscode.commands.registerCommand('dockerPodmanStudio.composeStop', (uri?: vscode.Uri) =>
        this.handleComposeAction('stop', uri)
      ),
      vscode.commands.registerCommand('dockerPodmanStudio.composeDown', (uri?: vscode.Uri) =>
        this.handleComposeAction('down', uri)
      ),
      vscode.commands.registerCommand('dockerPodmanStudio.composeRestart', (uri?: vscode.Uri) =>
        this.handleComposeAction('restart', uri)
      ),
      vscode.commands.registerCommand('dockerPodmanStudio.composeBuild', (uri?: vscode.Uri) =>
        this.handleComposeAction('build', uri)
      ),
      vscode.commands.registerCommand(
        'dockerPodmanStudio.registerComposeFiles',
        (uri?: vscode.Uri) => this.registerAndOpenCompose(uri)
      ),
      vscode.commands.registerCommand('dockerPodmanStudio.startMachine', () => this.startMachine()),
      vscode.commands.registerCommand('dockerPodmanStudio.stopMachine', () => this.stopMachine()),
      vscode.commands.registerCommand('dockerPodmanStudio.restartMachine', () =>
        this.restartMachine()
      ),
      vscode.commands.registerCommand('dockerPodmanStudio.createPod', () => this.createPodWizard()),
      vscode.commands.registerCommand('dockerPodmanStudio.createContainer', () =>
        this.createContainerWizard()
      ),
      vscode.commands.registerCommand('dockerPodmanStudio.createVolume', () =>
        this.createVolumeWizard()
      ),
      vscode.commands.registerCommand('dockerPodmanStudio.createNetwork', () =>
        this.createNetworkWizard()
      ),
      vscode.commands.registerCommand('dockerPodmanStudio.buildImage', (uri?: vscode.Uri) =>
        this.buildImageWizard(uri)
      ),
      vscode.commands.registerCommand('dockerPodmanStudio.pushImage', () => this.pushImageWizard()),
      vscode.commands.registerCommand('dockerPodmanStudio.pruneImages', () =>
        this.runPrune('pruneImages', bt('actionPruneImages'))
      ),
      vscode.commands.registerCommand('dockerPodmanStudio.pruneAllImages', () =>
        this.runPrune('pruneAll', bt('actionPruneAllImages'))
      ),
      vscode.commands.registerCommand('dockerPodmanStudio.pruneBuilderCache', () =>
        this.runPrune('pruneBuilder', bt('actionPruneBuilder', { engine: getEngineLabel() }))
      ),
      vscode.commands.registerCommand('dockerPodmanStudio.openToolsMenu', () =>
        this.openToolsMenu()
      ),
      vscode.commands.registerCommand('dockerPodmanStudio.resetEnginePaths', async () => {
        await resetEnginePaths();
        vscode.window.showInformationMessage(bt('pathsResetToast'));
        await this.onStateMutated();
      })
    );

    context.subscriptions.push(...this.disposables);
  }

  private async switchEngineWizard(): Promise<void> {
    const current = getConfig().engine;
    const picked = await vscode.window.showQuickPick<
      vscode.QuickPickItem & { engine: ContainerEngine }
    >(
      [
        {
          label: `${current === 'docker' ? '$(check) ' : ''}Docker (Default)`,
          description: 'Docker Engine, Docker Contexts & Docker Compose',
          engine: 'docker',
        },
        {
          label: `${current === 'podman' ? '$(check) ' : ''}Podman`,
          description: 'Daemonless Podman Engine, Pods, Machine & Podman Compose',
          engine: 'podman',
        },
      ],
      {
        placeHolder: `Select active container engine (Current: ${getEngineLabel(current)})`,
      }
    );
    if (!picked || picked.engine === current) {
      return;
    }
    await updateEngineSetting(picked.engine);
    vscode.window.showInformationMessage(
      bt('engineSwitchedToast', { engine: getEngineLabel(picked.engine) })
    );
    await this.onStateMutated();
  }

  private async ensurePodmanMode(message: string): Promise<boolean> {
    if (getConfig().engine === 'podman') {
      return true;
    }
    const switchBtn = 'Switch to Podman';
    const choice = await vscode.window.showInformationMessage(message, switchBtn, bt('cancel'));
    if (choice === switchBtn) {
      await updateEngineSetting('podman');
      vscode.window.showInformationMessage(bt('engineSwitchedToast', { engine: 'Podman' }));
      await this.onStateMutated();
      return true;
    }
    return false;
  }

  private async pickComposeFile(uri?: vscode.Uri): Promise<string | undefined> {
    if (uri?.fsPath) {
      await this.fileDetector.registerFile(uri.fsPath);
      return uri.fsPath;
    }
    const files = await this.runLookup(bt('findingComposeFiles'), () => this.fileDetector.scan());
    if (!files) return undefined;
    if (files.length === 0) {
      const selectLabel = bt('selectComposeLabel');
      const cancelLabel = bt('cancel');
      const pick = await vscode.window.showWarningMessage(
        'No Compose file detected. Would you like to select a YAML file manually?',
        selectLabel,
        cancelLabel
      );
      if (pick === selectLabel) {
        const res = await vscode.window.showOpenDialog({
          canSelectFiles: true,
          canSelectFolders: false,
          canSelectMany: false,
          filters: { 'Compose YAML': ['yml', 'yaml'] },
        });
        if (res?.[0]) {
          await this.fileDetector.registerFile(res[0].fsPath);
          return res[0].fsPath;
        }
      }
      return undefined;
    }
    if (files.length === 1) {
      return files[0];
    }
    const chosen = await vscode.window.showQuickPick(
      files.map((f) => ({
        label: path.basename(f),
        description: f,
        file: f,
      })),
      { placeHolder: `Select a ${getEngineLabel()} Compose file` }
    );
    return chosen?.file;
  }

  private async registerAndOpenCompose(uri?: vscode.Uri): Promise<void> {
    let target = uri?.fsPath;
    if (!target) {
      const res = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: { 'Compose YAML': ['yml', 'yaml'] },
        openLabel: bt('selectComposeLabel'),
      });
      target = res?.[0]?.fsPath;
    }
    if (!target) {
      return;
    }
    await this.fileDetector.registerFile(target);
    await vscode.commands.executeCommand('dockerPodmanStudio.openPanel');
    await this.onStateMutated(target);
    vscode.window.showInformationMessage(
      `Compose file registered in Docker and Podman Studio: ${path.basename(target)}`
    );
  }

  private async handleComposeAction(
    action: 'up' | 'start' | 'stop' | 'down' | 'restart' | 'build',
    uri?: vscode.Uri
  ): Promise<void> {
    const file = await this.pickComposeFile(uri);
    if (!file) {
      return;
    }

    if (action === 'down' && getConfig().engine === 'podman' && getConfig().confirmDeletions) {
      const yes = bt('yes');
      const answer = await vscode.window.showWarningMessage(
        bt('confirmComposeDown'),
        { modal: true, detail: file },
        yes
      );
      if (answer !== yes) {
        return;
      }
    }

    const engineLabel = getEngineLabel();
    const operation = `${bt(
      action === 'up' || action === 'start' ? 'actionComposeUp'
        : action === 'stop' ? 'actionComposeStop'
          : action === 'down' ? 'actionComposeDown'
            : action === 'restart' ? 'actionComposeRestart' : 'actionComposeBuildUp',
      { engine: engineLabel }
    )} (${path.basename(file)})`;
    const res = await this.runCommand(operation, () =>
      action === 'up'
        ? this.podman.composeUp(file)
        : action === 'start'
          ? this.podman.composeStart(file)
          : action === 'stop'
            ? this.podman.composeStop(file)
            : action === 'down'
              ? this.podman.composeDown(file)
              : action === 'restart'
                ? this.podman.composeRestart(file)
                : this.podman.composeBuildUp(file)
    );
    if (!res) return;
    if (!res.success) {
      this.showCommandFailure(operation, res);
      return;
    }
    if (action === 'down' && getConfig().engine === 'docker') {
      this.statusProvider.stopPolling();
    } else {
      this.statusProvider.startPolling(file, getConfig().pollingInterval);
    }
    void vscode.window.showInformationMessage(bt('opCompleted', { op: operation }));
    await this.onStateMutated(file);
  }

  private async startMachine(): Promise<void> {
    if (!(await this.ensurePodmanMode(bt('machinesRequirePodmanError')))) {
      return;
    }
    const machine = getConfig().machineName;
    const operation = bt('actionMachineStart', { name: machine });
    const res = await this.runCommand(operation, async () => {
      const res = await this.podman.startMachine(machine);
      return !res.success && res.stderr.toLowerCase().includes('already running')
        ? { ...res, success: true }
        : res;
    });
    if (!res) return;
    if (!res.success) this.showCommandFailure(operation, res);
    else void vscode.window.showInformationMessage(bt('opCompleted', { op: operation }));
    await this.onStateMutated();
  }

  private async stopMachine(): Promise<void> {
    if (!(await this.ensurePodmanMode(bt('machinesRequirePodmanError')))) {
      return;
    }
    const machine = getConfig().machineName;
    const operation = bt('actionMachineStop', { name: machine });
    const res = await this.runCommand(operation, () => this.podman.stopMachine(machine));
    if (!res) return;
    if (!res.success) this.showCommandFailure(operation, res);
    else void vscode.window.showInformationMessage(bt('opCompleted', { op: operation }));
    await this.onStateMutated();
  }

  private async restartMachine(): Promise<void> {
    if (!(await this.ensurePodmanMode(bt('machinesRequirePodmanError')))) {
      return;
    }
    const machine = getConfig().machineName;
    const operation = bt('actionMachineRestart', { name: machine });
    const res = await this.runCommand(operation, () => this.podman.restartMachine(machine));
    if (!res) return;
    if (!res.success) this.showCommandFailure(operation, res);
    else void vscode.window.showInformationMessage(bt('opCompleted', { op: operation }));
    await this.onStateMutated();
  }

  private async createPodWizard(): Promise<void> {
    if (!(await this.ensurePodmanMode(bt('podsRequirePodmanError')))) {
      return;
    }
    const name = await vscode.window.showInputBox({
      prompt: 'Pod Name',
      placeHolder: 'e.g., backend-pod',
    });
    if (name === undefined) {
      return;
    }
    const portsInput = await vscode.window.showInputBox({
      prompt: 'Published ports on Pod (optional, comma-separated)',
      placeHolder: 'e.g., 8080:80, 5432:5432',
    });
    const hostname = await vscode.window.showInputBox({
      prompt: 'Pod hostname (optional)',
      placeHolder: 'e.g., app-pod-host',
    });
    const addHosts = await vscode.window.showInputBox({
      prompt: 'Additional --add-host entries (optional, semicolon-separated)',
      placeHolder: 'e.g., api.local:10.88.0.2',
    });
    const cpuShares = await vscode.window.showInputBox({
      prompt: 'CPU Shares (optional, default 1024)',
      placeHolder: '1024',
    });

    const operation = bt('actionPodCreate', { name: name || '' });
    const res = await this.runCommand(operation, () =>
      this.podman.createPod({
        name,
        hostname,
        ports: portsInput ? portsInput.split(',').map((s) => s.trim()) : undefined,
        additionalHosts: addHosts ? addHosts.split(';').map((s) => s.trim()) : undefined,
        cpuShares,
      }
    ));
    if (!res) return;
    if (!res.success) this.showCommandFailure(operation, res);
    else {
      void vscode.window.showInformationMessage(bt('opCompleted', { op: operation }));
      await this.onStateMutated();
    }
  }

  private async createContainerWizard(): Promise<void> {
    const engine = getConfig().engine;
    const engineLabel = getEngineLabel(engine);

    const mode = await vscode.window.showQuickPick(
      [
        {
          label: 'Simple',
          description:
            engine === 'podman'
              ? 'Image, name, optional Pod, and port mappings'
              : 'Image, name, and port mappings',
          id: 'simple',
        },
        {
          label: 'Advanced',
          description: 'Volumes, network, environment variables, CPU/Memory limits, and mounts',
          id: 'advanced',
        },
      ],
      { placeHolder: `Select ${engineLabel} container creation mode` }
    );
    if (!mode) {
      return;
    }

    const images = await this.runLookup(bt('loadingImages'), () => this.podman.listImages());
    if (!images) return;
    const imageChoices = [
      { label: '$(cloud-download) Enter image reference manually...', imageRef: '__custom__' },
      ...images
        .filter((i) => !i.dangling)
        .map((i) => ({
          label: `${i.repository}:${i.tag}`,
          description: `ID: ${i.id} • ${i.size}`,
          imageRef: `${i.repository}:${i.tag}`,
        })),
    ];

    const pickedImg = await vscode.window.showQuickPick(imageChoices, {
      placeHolder: `Select a local ${engineLabel} image or enter manually`,
    });
    if (!pickedImg) {
      return;
    }
    let image = pickedImg.imageRef;
    if (image === '__custom__') {
      const manual = await vscode.window.showInputBox({
        prompt: 'Enter OCI image reference (e.g., docker.io/library/nginx:alpine)',
        placeHolder: 'docker.io/library/nginx:alpine',
      });
      if (!manual?.trim()) {
        return;
      }
      image = manual.trim();
    }

    const name = await vscode.window.showInputBox({
      prompt: 'Container name (optional)',
      placeHolder: 'my-container',
    });

    let selectedPod: string | undefined;
    if (engine === 'podman') {
      const pods = await this.podman.listPods();
      if (pods.length > 0) {
        const podPick = await vscode.window.showQuickPick(
          [
            { label: 'No Pod (Standalone Container)', podName: '' },
            ...pods.map((p) => ({
              label: p.name,
              description: `${p.status} (${p.id})`,
              podName: p.name,
            })),
          ],
          { placeHolder: 'Attach container to an existing Pod? (optional)' }
        );
        selectedPod = podPick?.podName || undefined;
      }
    }

    const ports: string[] = [];
    if (!selectedPod) {
      const portInput = await vscode.window.showInputBox({
        prompt: 'Port mappings (optional, e.g., 8080:80)',
        placeHolder: '8080:80',
      });
      if (portInput?.trim()) {
        ports.push(...portInput.split(',').map((p) => p.trim()));
      }
    }

    const volumes: string[] = [];
    let network: string | undefined;
    const env: string[] = [];
    let cpus: string | undefined;
    let memory: string | undefined;
    const mounts: string[] = [];

    if (mode.id === 'advanced') {
      const volList = await this.podman.listVolumes();
      if (volList.length > 0) {
        const volPick = await vscode.window.showQuickPick(
          [
            { label: 'No volume', volName: '' },
            ...volList.map((v) => ({ label: v.name, description: v.mountpoint, volName: v.name })),
          ],
          { placeHolder: `Mount a ${engineLabel} volume? (optional)` }
        );
        if (volPick?.volName) {
          const targetPath = await vscode.window.showInputBox({
            prompt: `Container mount path for volume '${volPick.volName}'`,
            placeHolder: '/data',
          });
          if (targetPath?.trim()) {
            volumes.push(`${volPick.volName}:${targetPath.trim()}`);
          }
        }
      }

      if (!selectedPod) {
        const netList = await this.podman.listNetworks();
        if (netList.length > 0) {
          const defaultNetLabel = engine === 'podman' ? 'Default (podman)' : 'Default (bridge)';
          const netPick = await vscode.window.showQuickPick(
            [
              { label: defaultNetLabel, netName: '' },
              ...netList.map((n) => ({ label: n.name, description: n.driver, netName: n.name })),
            ],
            { placeHolder: `Select ${engineLabel} network (optional)` }
          );
          network = netPick?.netName || undefined;
        }
      }

      const envStr = await vscode.window.showInputBox({
        prompt: 'Environment variables (comma-separated, e.g., KEY1=val1,KEY2=val2)',
      });
      if (envStr?.trim()) {
        env.push(
          ...envStr
            .split(',')
            .map((e) => e.trim())
            .filter(Boolean)
        );
      }

      cpus = await vscode.window.showInputBox({
        prompt: 'CPU limit (e.g., 0.5 or 2, blank = unlimited)',
      });
      memory = await vscode.window.showInputBox({
        prompt: 'Memory limit (e.g., 512m or 2g, blank = unlimited)',
      });
      const mountsStr = await vscode.window.showInputBox({
        prompt: 'Advanced mounts (semicolon-separated, e.g., type=bind,src=/host,target=/app)',
      });
      if (mountsStr?.trim()) {
        mounts.push(
          ...mountsStr
            .split(';')
            .map((m) => m.trim())
            .filter(Boolean)
        );
      }
    }

    const operation = bt('actionContainerCreate', { name: name || image });
    const res = await this.runCommand(operation, () =>
      this.podman.createContainer({
        image,
        name,
        pod: selectedPod,
        ports,
        volumes,
        network,
        env,
        cpus,
        memory,
        mounts,
      }
    ));
    if (!res) return;
    if (!res.success) this.showCommandFailure(operation, res);
    else {
      void vscode.window.showInformationMessage(bt('opCompleted', { op: operation }));
      await this.onStateMutated();
    }
  }

  private async createVolumeWizard(): Promise<void> {
    const name = await vscode.window.showInputBox({
      prompt: `Enter a name for the new ${getEngineLabel()} Volume`,
      placeHolder: 'postgres-data',
    });
    if (!name?.trim()) {
      return;
    }
    const operation = bt('actionVolumeCreate', { name: name.trim() });
    const res = await this.runCommand(operation, () => this.podman.createVolume(name.trim()));
    if (!res) return;
    if (!res.success) this.showCommandFailure(operation, res);
    else {
      void vscode.window.showInformationMessage(bt('opCompleted', { op: operation }));
      await this.onStateMutated();
    }
  }

  private async createNetworkWizard(): Promise<void> {
    const name = await vscode.window.showInputBox({
      prompt: `Enter a name for the new ${getEngineLabel()} Network`,
      placeHolder: 'backend-net',
    });
    if (!name?.trim()) {
      return;
    }
    const operation = bt('actionNetworkCreate', { name: name.trim() });
    const res = await this.runCommand(operation, () => this.podman.createNetwork({ name: name.trim() }));
    if (!res) return;
    if (!res.success) this.showCommandFailure(operation, res);
    else {
      void vscode.window.showInformationMessage(bt('opCompleted', { op: operation }));
      await this.onStateMutated();
    }
  }

  private async buildImageWizard(uri?: vscode.Uri): Promise<void> {
    let dockerfilePath = uri?.fsPath;
    if (!dockerfilePath && vscode.window.activeTextEditor) {
      const active = vscode.window.activeTextEditor.document.uri.fsPath;
      const base = path.basename(active).toLowerCase();
      if (base.includes('dockerfile') || base.includes('containerfile')) {
        dockerfilePath = active;
      }
    }
    if (!dockerfilePath) {
      const picked = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        openLabel: bt('selectContainerfileLabel'),
      });
      dockerfilePath = picked?.[0]?.fsPath;
    }
    if (!dockerfilePath) {
      return;
    }

    const defaultPlaceholder =
      getConfig().engine === 'podman' ? 'localhost/my-app:latest' : 'my-app:latest';
    const tag = await vscode.window.showInputBox({
      prompt: 'Enter target image name:tag',
      placeHolder: defaultPlaceholder,
    });
    if (!tag?.trim()) {
      return;
    }

    const operation = bt('actionImageBuild', { name: tag.trim() });
    const res = await this.runCommand(operation, () => this.podman.buildImage(dockerfilePath!, tag.trim()));
    if (!res) return;
    if (!res.success) this.showCommandFailure(operation, res);
    else {
      void vscode.window.showInformationMessage(bt('opCompleted', { op: operation }));
      await this.onStateMutated();
    }
  }

  private async pushImageWizard(): Promise<void> {
    const images = await this.podman.listImages();
    const tagged = images.filter((i) => !i.dangling);
    if (tagged.length === 0) {
      vscode.window.showInformationMessage('No tagged local images available to push.');
      return;
    }
    const picked = await vscode.window.showQuickPick(
      tagged.map((i) => ({
        label: `${i.repository}:${i.tag}`,
        description: `${i.id} • ${i.size}`,
        sourceRef: `${i.repository}:${i.tag}`,
      })),
      { placeHolder: 'Select an image to push' }
    );
    if (!picked) {
      return;
    }

    const defaultReg = getConfig().pushDefaultRegistry.trim();
    const suggested = defaultReg
      ? `${defaultReg.replace(/\/$/, '')}/${path.basename(picked.sourceRef)}`
      : picked.sourceRef;

    const target = await vscode.window.showInputBox({
      prompt: 'Destination registry tag (e.g., docker.io/user/app:tag or quay.io/org/app:tag)',
      value: suggested,
    });
    if (!target?.trim()) {
      return;
    }

    const operation = bt('actionImagePush', { name: target.trim() });
    const res = await this.runCommand(operation, () => this.podman.pushImage(picked.sourceRef, target.trim()));
    if (!res) return;
    if (!res.success) this.showCommandFailure(operation, res);
    else void vscode.window.showInformationMessage(bt('opCompleted', { op: operation }));
  }

  private async runPrune(
    kind: 'pruneImages' | 'pruneAll' | 'pruneBuilder',
    label: string
  ): Promise<void> {
    if (getConfig().confirmDeletions) {
      const yesLabel = bt('yes');
      const ans = await vscode.window.showWarningMessage(
        `Are you sure you want to execute "${label}"?`,
        {
          modal: true,
          detail: kind === 'pruneBuilder' && getConfig().engine === 'podman'
            ? bt('podmanBuildCacheWarning')
            : undefined,
        },
        yesLabel
      );
      if (ans !== yesLabel) {
        return;
      }
    }
    const res = await this.runCommand(label, () =>
      kind === 'pruneImages'
        ? this.podman.pruneDanglingImages()
        : kind === 'pruneAll'
          ? this.podman.pruneAllUnusedImages()
          : this.podman.pruneBuilderCache()
    );
    if (!res) return;
    if (!res.success) this.showCommandFailure(label, res);
    else {
      void vscode.window.showInformationMessage(bt('opCompleted', { op: label }));
      await this.onStateMutated();
    }
  }

  private async openToolsMenu(): Promise<void> {
    const engine = getConfig().engine;
    const engineLabel = getEngineLabel(engine);
    const cmd = engine === 'podman' ? 'podman' : 'docker';

    const items: Array<{ label: string; description: string; command: string }> = [
      {
        label: '$(window) Open Docker and Podman Studio',
        description: `Full visual Studio GUI (Active: ${engineLabel})`,
        command: 'dockerPodmanStudio.openPanel',
      },
      {
        label: '$(arrow-swap) Switch Container Engine',
        description: `Switch between Docker and Podman (Current: ${engineLabel})`,
        command: 'dockerPodmanStudio.switchEngine',
      },
      {
        label: '$(add) Create Container',
        description: 'Simple or Advanced mode',
        command: 'dockerPodmanStudio.createContainer',
      },
      ...(engine === 'podman'
        ? [
            {
              label: '$(add) Create Pod',
              description: 'Create a new Podman Pod',
              command: 'dockerPodmanStudio.createPod',
            },
          ]
        : []),
      {
        label: '$(database) Create Volume',
        description: `Create a persistent ${engineLabel} volume`,
        command: 'dockerPodmanStudio.createVolume',
      },
      {
        label: '$(globe) Create Network',
        description: `Create a ${engineLabel} network`,
        command: 'dockerPodmanStudio.createNetwork',
      },
      {
        label: '$(tools) Build Image',
        description: 'Build OCI image from Dockerfile / Containerfile',
        command: 'dockerPodmanStudio.buildImage',
      },
      {
        label: '$(cloud-upload) Push Image',
        description: 'Push local image to an OCI registry',
        command: 'dockerPodmanStudio.pushImage',
      },
      ...(engine === 'podman'
        ? [
            {
              label: '$(vm-running) Start Podman Machine',
              description: 'podman machine start',
              command: 'dockerPodmanStudio.startMachine',
            },
            {
              label: '$(vm-outline) Stop Podman Machine',
              description: 'podman machine stop',
              command: 'dockerPodmanStudio.stopMachine',
            },
          ]
        : []),
      {
        label: '$(clear-all) Prune Dangling Images',
        description: `${cmd} image prune -f`,
        command: 'dockerPodmanStudio.pruneImages',
      },
      {
        label: '$(trash) Prune All Unused Images',
        description: `${cmd} image prune -a -f`,
        command: 'dockerPodmanStudio.pruneAllImages',
      },
      {
        label: '$(flame) Clear Builder Cache',
        description: engine === 'podman'
          ? `${cmd} image prune --build-cache -f (also removes dangling images)`
          : `${cmd} builder prune -a -f`,
        command: 'dockerPodmanStudio.pruneBuilderCache',
      },
      {
        label: '$(discard) Reset CLI Paths',
        description: 'Reset dockerPath, podmanPath, and composePath to defaults',
        command: 'dockerPodmanStudio.resetEnginePaths',
      },
    ];

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: `Select a Docker and Podman Studio tool (${engineLabel})`,
    });
    if (picked) {
      await vscode.commands.executeCommand(picked.command);
    }
  }

  public dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
