import React from 'react';
import { VisualServiceDraft, VisualServiceField } from '../../../src/shared/composeVisualEdit';
import { useI18n } from '../i18n';
import { useComposeExtras } from '../i18n/composeExtras';

export const VisualServiceEditor: React.FC<{
  draft: VisualServiceDraft;
  disabled: boolean;
  onChange: (draft: VisualServiceDraft) => void;
}> = ({ draft, disabled, onChange }) => {
  const { t } = useI18n();
  const extra = useComposeExtras();
  const fields: Array<{ key: VisualServiceField; label: string; multiline?: boolean; hint?: string }> = [
    { key: 'image', label: t.compose.ociImageLabel },
    { key: 'buildContext', label: extra.visualBuildContext, hint: extra.visualBuildHint },
    { key: 'buildDockerfile', label: extra.visualDockerfile },
    { key: 'restart', label: t.compose.detailRestartPolicy },
    { key: 'command', label: t.compose.detailCommand },
    { key: 'ports', label: t.compose.portsLabel, multiline: true },
    { key: 'volumes', label: t.compose.volumesMountsLabel, multiline: true },
    { key: 'environment', label: t.compose.envVarsLabel, multiline: true },
    { key: 'dependsOn', label: t.compose.dependsOnLabel, multiline: true },
  ];
  return (
    <div className="space-y-3">
      <p className="text-xs text-text-secondary">{extra.visualServiceHint}</p>
      <div className="grid grid-cols-2 gap-3">
        {fields.map(({ key, label, multiline, hint }) => {
          const props = {
            id: `visual-service-${key}`,
            value: draft.values[key],
            disabled: disabled || !draft.supported[key],
            onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
              onChange({ ...draft, values: { ...draft.values, [key]: event.target.value } }),
            className: `input-field font-mono text-xs ${multiline ? 'min-h-24' : ''}`,
          };
          return (
            <div key={key} className={multiline ? 'col-span-1' : ''}>
              <label htmlFor={props.id} className="block text-xs text-text-secondary mb-1">{label}</label>
              {multiline ? <textarea {...props} /> : <input type="text" {...props} />}
              {!draft.supported[key] && <p className="text-xs text-accent-orange mt-1">{extra.visualAdvancedField}</p>}
              {draft.supported[key] && hint && <p className="text-xs text-text-secondary mt-1">{hint}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
};
