import React, { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, FolderOpen, Trash2 } from 'lucide-react';
import { useI18n } from '../i18n';
import { useComposeExtras } from '../i18n/composeExtras';
import { ComposeProjectOptions } from '../store';
import { useVsCodeMessaging } from '../vscode';
import { ActionPillButton, Modal, SmallActionButton } from './Shared';

export const ComposeOptionsModal: React.FC<{
  file: string;
  rawYaml: string;
  revision: string | null;
  options: ComposeProjectOptions;
  busy: boolean;
  onClose: () => void;
}> = ({ file, rawYaml, revision, options, busy, onClose }) => {
  const { t, engine } = useI18n();
  const extra = useComposeExtras();
  const { postMessage, onMessage } = useVsCodeMessaging();
  const [initial] = useState(() => ({ file, rawYaml, revision, options, engine }));
  const [files, setFiles] = useState(() => options.files.slice(1));
  const [profiles, setProfiles] = useState(() => options.profiles.join(', '));
  const [envFile, setEnvFile] = useState(() => options.envFile || '');
  const [saving, setSaving] = useState(false);
  const pending = useRef<string | null>(null);

  useEffect(() => onMessage((message) => {
    if (message.command === 'compose:options:selected' && message.payload?.file === initial.file &&
        Array.isArray(message.payload?.paths)) {
      const selected: string[] = message.payload.paths.filter((item: unknown): item is string =>
        typeof item === 'string'
      );
      if (message.payload.kind === 'files') {
        setFiles((current) => [...new Set([...current, ...selected.filter((item) => item !== initial.file)])]);
      } else if (message.payload.kind === 'env' && selected[0]) {
        setEnvFile(selected[0]);
      }
    }
    if (message.requestId !== pending.current) return;
    if (message.command === 'compose:options:saved') {
      pending.current = null;
      setSaving(false);
      onClose();
    } else if (message.command === 'compose:options:failed') {
      pending.current = null;
      setSaving(false);
    }
  }), [initial.file, onClose, onMessage]);

  const selectedProfiles = profiles.split(/[\s,]+/).filter(Boolean);
  const invalidProfiles = selectedProfiles.some((profile) =>
    !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(profile)
  ) || new Set(selectedProfiles).size !== selectedProfiles.length;
  const changedExternally = initial.file !== file || initial.rawYaml !== rawYaml ||
    initial.revision !== revision || initial.engine !== engine ||
    JSON.stringify(initial.options) !== JSON.stringify(options);

  const moveFile = (index: number, direction: -1 | 1) => {
    setFiles((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const apply = () => {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    pending.current = requestId;
    setSaving(true);
    postMessage('compose:options:save', {
      file: initial.file,
      engine: initial.engine,
      rawYaml: initial.rawYaml,
      projectRevision: initial.revision,
      previousOptions: initial.options,
      options: {
        files: [initial.file, ...files],
        profiles: selectedProfiles,
        envFile: envFile.trim() || undefined,
      },
    }, requestId);
  };

  return (
    <Modal
      title={extra.projectOptions}
      subtitle={extra.projectOptionsSubtitle}
      maxWidth="max-w-3xl"
      feedback
      lockFields={saving}
      onClose={() => { if (!saving) onClose(); }}
      footer={(
        <>
          <ActionPillButton label={t.common.cancel} disabled={saving} onClick={onClose} />
          <ActionPillButton
            label={extra.projectApply}
            loading={saving}
            loadingLabel={extra.projectApplying}
            disabled={busy || invalidProfiles || changedExternally}
            variant="podman"
            onClick={apply}
          />
        </>
      )}
    >
      {changedExternally && <p role="alert" className="text-xs text-accent-orange">{extra.projectConfigChanged}</p>}
      <div className="space-y-2">
        <div className="text-xs font-medium text-text-primary">{extra.projectFiles}</div>
        <div className="rounded border border-panel-border bg-panel-bg px-3 py-2 text-xs">
          <span className="text-text-secondary">{extra.projectBaseFile}: </span>
          <span className="font-mono break-all">{initial.file}</span>
        </div>
        {files.map((item, index) => (
          <div key={`${item}-${index}`} className="flex flex-wrap items-center gap-2 rounded border border-panel-border bg-panel-bg px-3 py-2">
            <span className="min-w-0 flex-[1_1_10rem] text-xs font-mono break-all">{item}</span>
            <div className="flex min-w-0 max-w-full flex-wrap gap-2">
              <SmallActionButton label={extra.projectMoveUp} disabled={index === 0 || saving}
                icon={<ArrowUp className="w-3 h-3" />} onClick={() => moveFile(index, -1)} />
              <SmallActionButton label={extra.projectMoveDown} disabled={index === files.length - 1 || saving}
                icon={<ArrowDown className="w-3 h-3" />} onClick={() => moveFile(index, 1)} />
              <SmallActionButton label={extra.projectRemoveOverride} disabled={saving} danger
                icon={<Trash2 className="w-3 h-3" />} onClick={() => setFiles((current) => current.filter((_, i) => i !== index))} />
            </div>
          </div>
        ))}
        <SmallActionButton label={extra.projectAddOverride} disabled={saving}
          icon={<FolderOpen className="w-3 h-3" />}
          onClick={() => postMessage('compose:options:pick', { file: initial.file, kind: 'files' })} />
      </div>
      <div>
        <label htmlFor="compose-profiles" className="block text-xs font-medium text-text-primary mb-1">{extra.projectProfiles}</label>
        <input id="compose-profiles" value={profiles} onChange={(event) => setProfiles(event.target.value)}
          disabled={saving} className="input-field font-mono text-xs" placeholder="dev, jobs" />
        <p className="text-xs text-text-secondary mt-1">{invalidProfiles ? extra.projectInvalidProfiles : extra.projectProfilesHint}</p>
      </div>
      <div>
        <label htmlFor="compose-env-file" className="block text-xs font-medium text-text-primary mb-1">{extra.projectEnvFile}</label>
        <div className="flex flex-wrap gap-2">
          <input id="compose-env-file" value={envFile} onChange={(event) => setEnvFile(event.target.value)}
            disabled={saving} className="input-field min-w-0 flex-[1_1_10rem] font-mono text-xs" />
          <SmallActionButton label={extra.projectBrowse} disabled={saving}
            icon={<FolderOpen className="w-3 h-3" />}
            onClick={() => postMessage('compose:options:pick', { file: initial.file, kind: 'env' })} />
        </div>
        <p className="text-xs text-text-secondary mt-1">{extra.projectEnvHint}</p>
      </div>
    </Modal>
  );
};
