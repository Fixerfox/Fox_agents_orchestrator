import { useId } from 'react';
import { DEFAULT_PERMISSION, type PermissionLevel, type ProjectPermission } from '@orquestador/core';
import { t, type MessageKey } from '@orquestador/editor';

const LABEL: Record<PermissionLevel, MessageKey> = { readonly: 'perm.readonly', ask: 'perm.ask', auto: 'perm.auto', full: 'perm.full' };
const HINT: Record<PermissionLevel, MessageKey> = { readonly: 'perm.readonly.hint', ask: 'perm.ask.hint', auto: 'perm.auto.hint', full: 'perm.full.hint' };

export const permissionName = (level: PermissionLevel): string => t(LABEL[level]);

interface Props {
  legend: string;
  /** Sin valor: en un agente, «El del proyecto» [R47.10]. */
  value: PermissionLevel | undefined;
  onChange(value: PermissionLevel | undefined): void;
  /** Ficha del agente: añade «El del proyecto» y «Solo lectura» [R47.10]. */
  agent?: boolean;
  /** Nivel del proyecto, para «El del proyecto (Automático)». */
  project?: ProjectPermission;
  disabled?: boolean;
}

/** Niveles de permisos de los agentes: Preguntar, Automático y Sin preguntar nunca, más los de un agente [R47.8][R47.11]. */
export function PermissionPicker({ legend, value, onChange, agent = false, project = DEFAULT_PERMISSION, disabled = false }: Props) {
  const name = useId();
  const levels: (PermissionLevel | undefined)[] = agent ? [undefined, 'readonly', 'ask', 'auto', 'full'] : ['ask', 'auto', 'full'];
  const current = agent ? value : (value ?? DEFAULT_PERMISSION);
  return (
    <fieldset className="orq-perm" disabled={disabled}>
      <legend className="orq-perm__legend">{legend}</legend>
      {levels.map((level) => (
        <label key={level ?? 'project'} className={`orq-perm__opt${current === level ? ' is-on' : ''}`}>
          <input type="radio" name={name} checked={current === level} onChange={() => onChange(level)} />
          <span>
            <strong>{level ? t(LABEL[level]) : t('perm.project', { level: permissionName(project) })}</strong>
            <small className="orq-hint">{t(HINT[level ?? project])}</small>
          </span>
        </label>
      ))}
      {current === 'full' && <p className="orq-perm__warn" role="note">{t('perm.full.warn')}</p>}
    </fieldset>
  );
}
