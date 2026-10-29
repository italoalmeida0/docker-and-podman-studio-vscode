import * as vscode from 'vscode';
import { getConfig, LanguageSetting, SupportedLocale } from './config';

export function resolveBackendLocale(setting?: LanguageSetting): SupportedLocale {
  const chosen = setting ?? getConfig().language;
  if (chosen && chosen !== 'auto') {
    return chosen;
  }
  const envLang = (vscode.env.language || 'en').toLowerCase();
  if (envLang.startsWith('pt')) {
    return 'pt-BR';
  }
  if (envLang.startsWith('es')) {
    return 'es';
  }
  if (envLang.startsWith('fr')) {
    return 'fr';
  }
  if (envLang.startsWith('de')) {
    return 'de';
  }
  if (envLang.startsWith('it')) {
    return 'it';
  }
  if (envLang.startsWith('ru')) {
    return 'ru';
  }
  if (envLang.startsWith('uk')) {
    return 'uk';
  }
  if (envLang.startsWith('pl')) {
    return 'pl';
  }
  if (envLang.startsWith('tr')) {
    return 'tr';
  }
  if (envLang.startsWith('nl')) {
    return 'nl';
  }
  if (envLang.startsWith('ja')) {
    return 'ja';
  }
  if (envLang.startsWith('ko')) {
    return 'ko';
  }
  if (envLang === 'zh-tw' || envLang === 'zh-hk' || envLang.includes('hant')) {
    return 'zh-TW';
  }
  if (envLang.startsWith('zh')) {
    return 'zh-CN';
  }
  if (envLang.startsWith('hi')) {
    return 'hi';
  }
  return 'en';
}

const enBackend = {
  copyError: 'Copy Error',
  copyCommand: 'Copy Command',
  errorCopied: 'Error message copied to clipboard.',
  commandCopied: 'Command copied to clipboard.',
  openStudioTooltip: 'Open Docker and Podman Studio ({engine})',
  engineActiveTooltip: 'Docker and Podman Studio ({engine} online) — Click to open',
  engineStoppedTooltip: 'Docker and Podman Studio ({engine} offline) — Click to open',
  opCompleted: '{op} completed successfully.',
  opFailed: 'Failed: {op}',
  engineFailedDefault: 'Failed to execute {engine} command.',
  launcherOpenBtn: 'Open Studio Panel',
  launcherSwitchEngineBtn: 'Switch Engine (Active: {engine})',
  launcherQuickToolsBtn: 'Quick Tools',
  launcherDescription:
    'Manage Docker & Podman Compose stacks, Containers, Pods, Images, Volumes, and Networks in the Studio panel.',
  engineSwitchedToast: 'Active container engine switched to {engine}.',
  podsRequirePodmanError:
    'Pods are a native Podman feature. Switch the active engine to Podman in Settings to manage Pods.',
  machinesRequirePodmanError:
    'Podman Machine commands apply when Podman is selected as the active engine.',
  yamlReadError: 'Failed to parse YAML ({file}): {err}',
  stopServiceBeforeEdit: 'Stop service "{service}" before modifying or removing its YAML.',
  stopAllBeforeRawSave: 'Stop all active services before saving raw YAML. Active: {services}.',
  invalidComposeExtension: 'Compose file name must end with .yml or .yaml.',
  fileNameOnlyError: 'Provide only the file name in the File Name field.',
  selectFolderOrWorkspaceError: 'Select an absolute directory or open a folder in VS Code.',
  fileAlreadyExists: 'File already exists: {path}',
  composeCreatedToast: 'Compose file created: {file}',
  yamlSavedToast: 'YAML saved successfully.',
  settingsSavedToast: 'Docker and Podman Studio settings saved.',
  settingsSavedLoginFailed: 'Settings saved, but {cmd} login failed: {err}',
  provideUsernameForLogin: 'Provide a registry username to test {cmd} login.',
  engineLoginSuccess: '{cmd} login to {host} succeeded!',
  quayOk: 'Quay.io responded successfully!',
  dockerHubOk: 'Docker Hub responded successfully!',
  provideRegistryUrl: 'Provide a Registry URL to test connection.',
  registryOk: 'Registry {host} responded successfully!',
  registryDisconnected: 'Credentials removed and {cmd} logout executed.',
  registryCredentialsRemoved: 'Stored registry credentials removed.',
  pathsResetToast: 'Docker, Podman, and Compose CLI paths reset to defaults.',
  selectContainerfileLabel: 'Select Dockerfile / Containerfile',
  selectComposeLabel: 'Select Compose YAML',
  selectComposeDirLabel: 'Select Compose Directory',
  timeoutExceeded: 'Execution timed out ({seconds}s).',
  unknownTopLevelKey: 'Unknown top-level key in Compose: "{key}"',
  unknownServiceKey: 'Unknown service key "{key}" in "{service}"',
  missingImageOrBuild: 'Service "{service}" must define either "image" or "build"',
  unusualPortFormat: 'Unusual port mapping "{port}" (expected "host:container")',
  emptyServiceYamlError: 'Provide the service YAML definition before saving.',
  invalidServiceYamlObject: 'Service YAML definition must be a valid mapping object.',
  confirmRemoveImage: 'Remove image "{name}"?',
  confirmRemoveNetwork: 'Remove network "{name}"?',
  confirmRemoveVolume: 'Remove volume "{name}" and its data?',
  confirmPruneDangling: 'Remove all dangling Podman images?',
  confirmPruneUnused: 'Remove all unused Podman images?',
  confirmPruneBuilder: 'Remove Podman build cache and dangling images?',
  confirmPruneVolumes: 'Remove all unused Podman volumes and their data?',
  confirmComposeDown: 'Remove the containers and networks of this Compose project?',
  confirmComposeServiceDown: 'Remove the containers of these Compose services: {services}?',
  confirmComposeVolumes: 'Named volumes and their data will also be removed.',
  confirmScaleDown: 'Remove {count} excess container(s) from Compose service "{service}"?',
  confirmScaleDataWarning:
    'Scaling can start dependencies or recreate containers. Removed container layers are lost; volumes are retained.',
  podmanBuildCacheWarning:
    'This also removes dangling images. Do not run it while a build is in progress.',
  podmanInUseWarning:
    'Resources in use will not be force-removed.',
  batchStart: 'Start',
  batchStop: 'Stop',
  batchRestart: 'Restart',
  batchOperation: '{action} {count} selected {resource}',
  batchContainers: 'containers',
  batchPods: 'pods',
  batchPartialFailure: '{completed} of {total} operations succeeded. Failed:',
  logStreamError: 'Failed to stream logs for {name}: {error}',
  yes: 'Yes',
  cancel: 'Cancel',
};

type BackendMessages = typeof enBackend;

const dictionaries: Record<SupportedLocale, Partial<BackendMessages>> = {
  en: enBackend,
  'pt-BR': {
    copyError: 'Copiar Erro',
    copyCommand: 'Copiar Comando',
    errorCopied: 'Mensagem de erro copiada para a área de transferência.',
    commandCopied: 'Comando copiado para a área de transferência.',
    openStudioTooltip: 'Abrir Docker and Podman Studio ({engine})',
    engineActiveTooltip: 'Docker and Podman Studio ({engine} online) — Clique para abrir',
    engineStoppedTooltip: 'Docker and Podman Studio ({engine} offline) — Clique para abrir',
    opCompleted: '{op} concluído com sucesso.',
    opFailed: 'Falha em {op}',
    engineFailedDefault: 'Falha ao executar comando {engine}.',
    launcherOpenBtn: 'Abrir Painel Studio',
    launcherSwitchEngineBtn: 'Trocar Engine (Ativa: {engine})',
    launcherQuickToolsBtn: 'Ferramentas Rápidas',
    launcherDescription:
      'Gerencie stacks Docker & Podman Compose, Containers, Pods, Imagens, Volumes e Redes no painel principal.',
    engineSwitchedToast: 'Engine de containers alterada para {engine}.',
    podsRequirePodmanError:
      'Pods são um recurso nativo do Podman. Altere a engine ativa para Podman nas Configurações para gerenciar Pods.',
    machinesRequirePodmanError:
      'Os comandos de Podman Machine exigem que a engine ativa seja Podman.',
    yamlSavedToast: 'YAML salvo com sucesso.',
    settingsSavedToast: 'Configurações do Docker and Podman Studio salvas.',
    registryCredentialsRemoved: 'Credenciais do registro removidas do armazenamento.',
    pathsResetToast: 'Caminhos do Docker, Podman e Compose restaurados para o padrão.',
    confirmRemoveImage: 'Remover a imagem "{name}"?',
    confirmRemoveNetwork: 'Remover a rede "{name}"?',
    confirmRemoveVolume: 'Remover o volume "{name}" e seus dados?',
    confirmPruneDangling: 'Remover todas as imagens Podman sem referência?',
    confirmPruneUnused: 'Remover todas as imagens Podman não utilizadas?',
    confirmPruneBuilder: 'Remover o cache de build e as imagens Podman sem referência?',
    confirmPruneVolumes: 'Remover todos os volumes Podman não utilizados e seus dados?',
    confirmComposeDown: 'Remover os contêineres e as redes deste projeto Compose?',
    confirmComposeServiceDown: 'Remover os contêineres destes serviços Compose: {services}?',
    confirmComposeVolumes: 'Os volumes nomeados e seus dados também serão removidos.',
    confirmScaleDown: 'Remover {count} contêiner(es) excedente(s) do serviço Compose "{service}"?',
    confirmScaleDataWarning:
      'A escala pode iniciar dependências ou recriar contêineres. As camadas removidas serão perdidas; os volumes serão mantidos.',
    podmanBuildCacheWarning:
      'Isso também remove imagens sem referência. Não execute enquanto houver um build em andamento.',
    podmanInUseWarning: 'Recursos em uso não serão removidos à força.',
    batchStart: 'Iniciar',
    batchStop: 'Parar',
    batchRestart: 'Reiniciar',
    batchOperation: '{action} {count} {resource} selecionados',
    batchContainers: 'contêineres',
    batchPods: 'pods',
    batchPartialFailure: '{completed} de {total} operações concluídas. Falhas:',
    logStreamError: 'Falha ao acompanhar os logs de {name}: {error}',
    yes: 'Sim',
    cancel: 'Cancelar',
  },
  es: {
    copyError: 'Copiar Error',
    copyCommand: 'Copiar Comando',
    openStudioTooltip: 'Abrir Docker and Podman Studio ({engine})',
    engineActiveTooltip: 'Docker and Podman Studio ({engine} activo) — Clic para abrir',
    engineStoppedTooltip: 'Docker and Podman Studio ({engine} inactivo) — Clic para abrir',
    opCompleted: '{op} completado con éxito.',
    opFailed: 'Error en {op}',
    launcherOpenBtn: 'Abrir Panel Studio',
    launcherSwitchEngineBtn: 'Cambiar Motor (Activo: {engine})',
    launcherQuickToolsBtn: 'Herramientas Rápidas',
    engineSwitchedToast: 'Motor de contenedores cambiado a {engine}.',
    settingsSavedToast: 'Configuración de Docker and Podman Studio guardada.',
    pathsResetToast: 'Rutas CLI de Docker, Podman y Compose restablecidas.',
    yes: 'Sí',
    cancel: 'Cancelar',
  },
  fr: {
    copyError: "Copier l'erreur",
    copyCommand: 'Copier la commande',
    openStudioTooltip: 'Ouvrir Docker and Podman Studio ({engine})',
    engineActiveTooltip: 'Docker and Podman Studio ({engine} en ligne) — Cliquer pour ouvrir',
    engineStoppedTooltip: 'Docker and Podman Studio ({engine} hors ligne) — Cliquer pour ouvrir',
    opCompleted: '{op} terminé avec succès.',
    opFailed: 'Échec : {op}',
    launcherOpenBtn: 'Ouvrir le panneau Studio',
    launcherSwitchEngineBtn: 'Changer de moteur (Actif : {engine})',
    launcherQuickToolsBtn: 'Outils Rapides',
    engineSwitchedToast: 'Moteur de conteneurs basculé sur {engine}.',
    settingsSavedToast: 'Paramètres de Docker and Podman Studio enregistrés.',
    yes: 'Oui',
    cancel: 'Annuler',
  },
  de: {
    copyError: 'Fehler kopieren',
    copyCommand: 'Befehl kopieren',
    openStudioTooltip: 'Docker and Podman Studio öffnen ({engine})',
    engineActiveTooltip: 'Docker and Podman Studio ({engine} online) — Klicken zum Öffnen',
    engineStoppedTooltip: 'Docker and Podman Studio ({engine} offline) — Klicken zum Öffnen',
    opCompleted: '{op} erfolgreich abgeschlossen.',
    opFailed: 'Fehlgeschlagen: {op}',
    launcherOpenBtn: 'Studio-Panel öffnen',
    launcherSwitchEngineBtn: 'Engine wechseln (Aktiv: {engine})',
    launcherQuickToolsBtn: 'Schnellwerkzeuge',
    engineSwitchedToast: 'Aktive Container-Engine auf {engine} umgestellt.',
    settingsSavedToast: 'Docker and Podman Studio-Einstellungen gespeichert.',
    yes: 'Ja',
    cancel: 'Abbrechen',
  },
  it: {
    copyError: 'Copia Errore',
    copyCommand: 'Copia Comando',
    openStudioTooltip: 'Apri Docker and Podman Studio ({engine})',
    engineActiveTooltip: 'Docker and Podman Studio ({engine} online) — Clicca per aprire',
    engineStoppedTooltip: 'Docker and Podman Studio ({engine} offline) — Clicca per aprire',
    opCompleted: '{op} completato con successo.',
    opFailed: 'Errore: {op}',
    launcherOpenBtn: 'Apri Pannello Studio',
    launcherSwitchEngineBtn: 'Cambia Motore (Attivo: {engine})',
    launcherQuickToolsBtn: 'Strumenti Rapidi',
    engineSwitchedToast: 'Motore container attivo impostato su {engine}.',
    settingsSavedToast: 'Impostazioni di Docker and Podman Studio salvate.',
    yes: 'Sì',
    cancel: 'Annulla',
  },
  ru: {
    copyError: 'Копировать ошибку',
    copyCommand: 'Копировать команду',
    errorCopied: 'Сообщение об ошибке скопировано в буфер обмена.',
    commandCopied: 'Команда скопирована в буфер обмена.',
    openStudioTooltip: 'Открыть Docker and Podman Studio ({engine})',
    engineActiveTooltip: 'Docker and Podman Studio ({engine} запущен) — Нажмите, чтобы открыть',
    engineStoppedTooltip: 'Docker and Podman Studio ({engine} остановлен) — Нажмите, чтобы открыть',
    opCompleted: '{op} успешно выполнено.',
    opFailed: 'Ошибка: {op}',
    engineFailedDefault: 'Не удалось выполнить команду {engine}.',
    launcherOpenBtn: 'Открыть панель Studio',
    launcherSwitchEngineBtn: 'Сменить движок (Активен: {engine})',
    launcherQuickToolsBtn: 'Быстрые инструменты',
    launcherDescription:
      'Управляйте Docker и Podman Compose, контейнерами, подами, образами, томами и сетями на главной панели Studio.',
    engineSwitchedToast: 'Активный контейнерный движок переключен на {engine}.',
    yamlSavedToast: 'YAML успешно сохранен.',
    settingsSavedToast: 'Настройки Docker and Podman Studio сохранены.',
    pathsResetToast: 'Пути CLI Docker, Podman и Compose сброшены по умолчанию.',
    yes: 'Да',
    cancel: 'Отмена',
  },
  uk: {
    copyError: 'Копіювати помилку',
    copyCommand: 'Копіювати команду',
    openStudioTooltip: 'Відкрити Docker and Podman Studio ({engine})',
    engineActiveTooltip: 'Docker and Podman Studio ({engine} активний) — Натисніть, щоб відкрити',
    engineStoppedTooltip: 'Docker and Podman Studio ({engine} зупинено) — Натисніть, щоб відкрити',
    opCompleted: '{op} успішно виконано.',
    opFailed: 'Помилка: {op}',
    launcherOpenBtn: 'Відкрити панель Studio',
    launcherSwitchEngineBtn: 'Змінити рушій (Активний: {engine})',
    launcherQuickToolsBtn: 'Швидкі інструменти',
    engineSwitchedToast: 'Активний контейнерний рушій змінено на {engine}.',
    settingsSavedToast: 'Налаштування Docker and Podman Studio збережено.',
    yes: 'Так',
    cancel: 'Скасувати',
  },
  pl: {
    copyError: 'Kopiuj błąd',
    copyCommand: 'Kopiuj polecenie',
    openStudioTooltip: 'Otwórz Docker and Podman Studio ({engine})',
    engineActiveTooltip: 'Docker and Podman Studio ({engine} online) — Kliknij, aby otworzyć',
    engineStoppedTooltip: 'Docker and Podman Studio ({engine} offline) — Kliknij, aby otworzyć',
    opCompleted: '{op} zakończono pomyślnie.',
    opFailed: 'Błąd: {op}',
    launcherOpenBtn: 'Otwórz panel Studio',
    launcherSwitchEngineBtn: 'Przełącz silnik (Aktywny: {engine})',
    launcherQuickToolsBtn: 'Szybkie narzędzia',
    engineSwitchedToast: 'Aktywny silnik kontenerów przełączono na {engine}.',
    settingsSavedToast: 'Ustawienia Docker and Podman Studio zostały zapisane.',
    yes: 'Tak',
    cancel: 'Anuluj',
  },
  tr: {
    copyError: 'Hatayı Kopyala',
    copyCommand: 'Komutu Kopyala',
    openStudioTooltip: 'Docker and Podman Studio Panelini Aç ({engine})',
    engineActiveTooltip: 'Docker and Podman Studio ({engine} çevrimiçi) — Açmak için tıklayın',
    engineStoppedTooltip: 'Docker and Podman Studio ({engine} çevrimdışı) — Açmak için tıklayın',
    opCompleted: '{op} başarıyla tamamlandı.',
    opFailed: 'Başarısız: {op}',
    launcherOpenBtn: 'Studio Panelini Aç',
    launcherSwitchEngineBtn: 'Motoru Değiştir (Aktif: {engine})',
    launcherQuickToolsBtn: 'Hızlı Araçlar',
    engineSwitchedToast: 'Aktif konteyner motoru {engine} olarak değiştirildi.',
    settingsSavedToast: 'Docker and Podman Studio ayarları kaydedildi.',
    yes: 'Evet',
    cancel: 'İptal',
  },
  nl: {
    copyError: 'Fout kopiëren',
    copyCommand: 'Opdracht kopiëren',
    openStudioTooltip: 'Docker and Podman Studio openen ({engine})',
    engineActiveTooltip: 'Docker and Podman Studio ({engine} online) — Klik om te openen',
    engineStoppedTooltip: 'Docker and Podman Studio ({engine} offline) — Klik om te openen',
    opCompleted: '{op} succesvol voltooid.',
    opFailed: 'Mislukt: {op}',
    launcherOpenBtn: 'Studio-paneel openen',
    launcherSwitchEngineBtn: 'Engine wisselen (Actief: {engine})',
    launcherQuickToolsBtn: 'Snelle hulpmiddelen',
    engineSwitchedToast: 'Actieve container-engine gewijzigd naar {engine}.',
    settingsSavedToast: 'Instellingen van Docker and Podman Studio opgeslagen.',
    yes: 'Ja',
    cancel: 'Annuleren',
  },
  ja: {
    copyError: 'エラーをコピー',
    copyCommand: 'コマンドをコピー',
    openStudioTooltip: 'Docker and Podman Studio を開く ({engine})',
    engineActiveTooltip: 'Docker and Podman Studio ({engine} 稼働中) — クリックして開く',
    engineStoppedTooltip: 'Docker and Podman Studio ({engine} 停止中) — クリックして開く',
    opCompleted: '{op} が正常に完了しました。',
    opFailed: '失敗: {op}',
    launcherOpenBtn: 'Studio パネルを開く',
    launcherSwitchEngineBtn: 'エンジン切替 (現在: {engine})',
    launcherQuickToolsBtn: 'クイックツール',
    engineSwitchedToast: 'コンテナエンジンを {engine} に切り替えました。',
    settingsSavedToast: 'Docker and Podman Studio の設定を保存しました。',
    yes: 'はい',
    cancel: 'キャンセル',
  },
  ko: {
    copyError: '오류 복사',
    copyCommand: '명령어 복사',
    openStudioTooltip: 'Docker and Podman Studio 열기 ({engine})',
    engineActiveTooltip: 'Docker and Podman Studio ({engine} 실행 중) — 클릭하여 열기',
    engineStoppedTooltip: 'Docker and Podman Studio ({engine} 중지됨) — 클릭하여 열기',
    opCompleted: '{op} 작업이 완료되었습니다.',
    opFailed: '실패: {op}',
    launcherOpenBtn: 'Studio 패널 열기',
    launcherSwitchEngineBtn: '엔진 전환 (현재: {engine})',
    launcherQuickToolsBtn: '빠른 도구',
    engineSwitchedToast: '활성 컨테이너 엔진이 {engine}(으)로 전환되었습니다.',
    settingsSavedToast: 'Docker and Podman Studio 설정이 저장되었습니다.',
    yes: '예',
    cancel: '취소',
  },
  'zh-CN': {
    copyError: '复制错误',
    copyCommand: '复制命令',
    openStudioTooltip: '打开 Docker and Podman Studio ({engine})',
    engineActiveTooltip: 'Docker and Podman Studio ({engine} 运行中) — 点击打开',
    engineStoppedTooltip: 'Docker and Podman Studio ({engine} 已停止) — 点击打开',
    opCompleted: '{op} 已成功完成。',
    opFailed: '失败: {op}',
    launcherOpenBtn: '打开 Studio 面板',
    launcherSwitchEngineBtn: '切换引擎 (当前: {engine})',
    launcherQuickToolsBtn: '快捷工具',
    engineSwitchedToast: '当前容器引擎已切换为 {engine}。',
    settingsSavedToast: 'Docker and Podman Studio 设置已保存。',
    yes: '是',
    cancel: '取消',
  },
  'zh-TW': {
    copyError: '複製錯誤',
    copyCommand: '複製指令',
    openStudioTooltip: '開啟 Docker and Podman Studio ({engine})',
    engineActiveTooltip: 'Docker and Podman Studio ({engine} 執行中) — 點擊開啟',
    engineStoppedTooltip: 'Docker and Podman Studio ({engine} 已停止) — 點擊開啟',
    opCompleted: '{op} 已成功完成。',
    opFailed: '失敗: {op}',
    launcherOpenBtn: '開啟 Studio 面板',
    launcherSwitchEngineBtn: '切換引擎 (目前: {engine})',
    launcherQuickToolsBtn: '快速工具',
    engineSwitchedToast: '作用中容器引擎已切換為 {engine}。',
    settingsSavedToast: 'Docker and Podman Studio 設定已儲存。',
    yes: '是',
    cancel: '取消',
  },
  hi: {
    copyError: 'त्रुटि कॉपी करें',
    copyCommand: 'कमांड कॉपी करें',
    openStudioTooltip: 'Docker and Podman Studio खोलें ({engine})',
    engineActiveTooltip: 'Docker and Podman Studio ({engine} ऑनलाइन) — खोलने के लिए क्लिक करें',
    engineStoppedTooltip: 'Docker and Podman Studio ({engine} ऑफ़लाइन) — खोलने के लिए क्लिक करें',
    opCompleted: '{op} सफलतापूर्वक पूर्ण हुआ।',
    opFailed: 'विफल: {op}',
    launcherOpenBtn: 'Studio पैनल खोलें',
    launcherSwitchEngineBtn: 'इंजन बदलें (सक्रिय: {engine})',
    launcherQuickToolsBtn: 'त्वरित उपकरण',
    engineSwitchedToast: 'सक्रिय कंटेनर इंजन को {engine} पर स्विच किया गया।',
    settingsSavedToast: 'Docker and Podman Studio सेटिंग्स सहेजी गईं।',
    yes: 'हाँ',
    cancel: 'रद्द करें',
  },
};

export function bt<K extends keyof BackendMessages>(
  key: K,
  vars?: Record<string, string | number>
): string {
  const locale = resolveBackendLocale();
  const dict = dictionaries[locale] || enBackend;
  let template: string = (dict[key] as string | undefined) ?? enBackend[key];
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      template = template.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return template;
}
