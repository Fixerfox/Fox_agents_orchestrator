import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Circle, ClipboardPaste, FolderClosed, Globe, KeyRound, Loader2, Plug, Plus, Sparkles, SquareTerminal, Trash2, Zap } from 'lucide-react';
import { MCP_LIMITS, SECRET_NAME, newMcpServer, parseMcpSnippet, slugify, type AgentDefinition, type McpServerDefinition } from '@orquestador/core';
import { t, type McpTestResult, type McpView, type ProjectApi } from '@orquestador/editor';
import { DeleteConfirm, EditorHead, UsedBy, saveKeys } from './editorParts';
import { DraftStore, useDraftState } from '../common';
import { Field, fieldErrors } from '../common';

type Draft = McpServerDefinition & { argsText: string };
const toDraft = (m: McpServerDefinition): Draft => ({ ...m, argsText: (m.args ?? []).join('\n') });
const fromDraft = (d: Draft, id: string): McpServerDefinition => {
  const { argsText, ...rest } = d;
  const args = argsText.split('\n').map((a) => a.trim()).filter((a) => a !== '');
  const base: McpServerDefinition = { ...rest, id, scope: d.scope ?? 'project' };
  delete base.args;
  delete base.command;
  delete base.url;
  return d.transport === 'stdio' ? { ...base, command: d.command ?? '', args } : { ...base, url: d.url ?? '' };
};

/**
 * Editor de un servidor MCP (pestaña «MCP» de Conocimiento): tipo, comando y argumentos o dirección, secretos que
 * se guardan cifrados y nunca vuelven, activado, de confianza, «Probar conexión» y «Lo usan» [R30.7].
 */
export function McpForm({ api, drafts, draftKey, original, servers, agents, justSaved, onSaved, onDeleted, onAgentsChanged, busy = false, onAskClaude, onOpenTerminal }: {
  api: ProjectApi;
  drafts: DraftStore;
  draftKey: string;
  original: McpView | undefined;
  servers: McpView[];
  agents: AgentDefinition[];
  justSaved: boolean;
  onSaved: (id: string) => void;
  onDeleted: () => void;
  onAgentsChanged: () => void;
  busy?: boolean;
  /** Abre el asistente con una petición sobre este servidor [R30.10]. */
  onAskClaude?: (text: string) => void;
  /** Abre una terminal de Claude Code en la carpeta del proyecto [R30.10][R30.13]. */
  onOpenTerminal?: () => void;
}) {
  const isNew = original === undefined;
  const base = useMemo(() => {
    if (!original) return toDraft(newMcpServer('', ''));
    const { secretsSet: _s, ...def } = original;
    void _s;
    return toDraft(def);
  }, [original]);
  const [draft, setDraft] = useDraftState<Draft>(drafts, draftKey, base);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(justSaved);
  const [confirm, setConfirm] = useState<string>();
  const [test, setTest] = useState<McpTestResult | 'busy'>();
  const [secretName, setSecretName] = useState('');
  const [secretValue, setSecretValue] = useState<Record<string, string>>({});
  const [secretMsg, setSecretMsg] = useState<string>();
  const taken = useMemo(() => new Set(servers.map((m) => m.id)), [servers]);
  const id = isNew ? slugify(draft.name, taken, 'mcp') : draft.id;
  const dirty = JSON.stringify(draft) !== JSON.stringify(base);
  const set = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setSaved(false);
  };
  const secretsSet = original?.secretsSet ?? [];
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteMsg, setPasteMsg] = useState<{ text: string; bad?: boolean }>();
  const [askText, setAskText] = useState('');
  /** Rellena la ficha con lo pegado de un README; nunca copia valores secretos [R38.8]. */
  const applyPaste = () => {
    const r = parseMcpSnippet(pasteText);
    if (!r) return setPasteMsg({ text: t('mcp.paste.bad'), bad: true });
    set({
      transport: r.transport,
      ...(r.transport === 'stdio' ? { command: r.command ?? '', argsText: (r.args ?? []).join('\n') } : { url: r.url ?? '' }),
      ...(r.name && draft.name.trim() === '' ? { name: r.name } : {}),
      secretNames: [...new Set([...(draft.secretNames ?? []), ...r.secretNames])],
    });
    setPasteText('');
    setPasteOpen(false);
    setPasteMsg(undefined);
    setSecretMsg(r.droppedValues ? `${t('mcp.paste.done')} ${t('mcp.paste.dropped')}` : t('mcp.paste.done'));
  };
  const argList = draft.argsText.split('\n').map((a) => a.trim()).filter((a) => a !== '');
  const quote = (a: string) => (/[\s"']/.test(a) || a === '' ? JSON.stringify(a) : a);
  const preview = draft.transport === 'stdio' ? ((draft.command ?? '').trim() ? [draft.command!.trim(), ...argList].map(quote).join(' ') : '') : (draft.url ?? '').trim();
  const secretTotal = (draft.secretNames ?? []).length;
  const secretHave = (draft.secretNames ?? []).filter((n) => secretsSet.includes(n)).length;
  /** «Lista para usar»: lo que falta para que un agente pueda usarlo [R38.9]. */
  const readiness = [
    { key: 'name', label: t('mcp.ready.name'), ok: draft.name.trim() !== '' },
    { key: 'how', label: t('mcp.ready.how'), ok: preview !== '' },
    { key: 'secrets', label: secretTotal === 0 ? t('mcp.ready.secrets.none') : t('mcp.ready.secrets', { have: secretHave, total: secretTotal }), ok: secretHave === secretTotal },
    { key: 'saved', label: t('mcp.ready.saved'), ok: !isNew && !dirty },
    { key: 'tested', label: t('mcp.ready.tested'), ok: test !== undefined && test !== 'busy' && test.ok },
  ];

  const save = async () => {
    if (busy) return;
    const res = await api.saveMcp(fromDraft(draft, id));
    if (!res.ok) return setErrors(fieldErrors(res.error));
    setErrors({});
    drafts.discard(draftKey);
    setSaved(true);
    onSaved(id);
  };
  const askDelete = async () => {
    const r = await api.mcpUsage(draft.id);
    const names = r.ok ? r.value.map((u) => u.name) : [];
    setConfirm(names.length > 0 ? t('mcp.delete.used', { names: names.join(', ') }) : t('mcp.delete.unused'));
  };
  const addSecretName = () => {
    const n = secretName.trim();
    if (!SECRET_NAME.test(n)) return setErrors((e) => ({ ...e, secretNames: t('mcp.secret.badName') }));
    if ((draft.secretNames ?? []).includes(n)) return;
    set({ secretNames: [...(draft.secretNames ?? []), n] });
    setSecretName('');
    setErrors(({ secretNames: _x, ...rest }) => (void _x, rest));
  };
  const storeSecret = async (name: string) => {
    const value = secretValue[name] ?? '';
    if (value === '') return;
    const r = await api.setMcpSecret({ id: draft.id, name, value });
    setSecretValue((v) => ({ ...v, [name]: '' }));
    if (!r.ok) return setSecretMsg(r.error.message);
    setSecretMsg(t('mcp.secret.saved', { name }));
    onAgentsChanged();
  };
  const dropSecret = async (name: string) => {
    const r = await api.clearMcpSecret({ id: draft.id, name });
    if (!r.ok) return setSecretMsg(r.error.message);
    setSecretMsg(t('mcp.secret.cleared', { name }));
    onAgentsChanged();
  };
  const sendAsk = () => {
    if (!askText.trim() || !onAskClaude) return;
    onAskClaude(t('mcp.askbox.prompt', { name: draft.name, id: draft.id, text: askText.trim() }));
    setAskText('');
  };
  const runTest = async () => {
    setTest('busy');
    const r = await api.testMcp(draft.id);
    setTest(r.ok ? r.value : { ok: false, message: r.error.message, tools: [], ms: 0 });
  };

  return (
    <form
      className="orq-editor"
      noValidate
      onKeyDown={saveKeys(() => void save())}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <EditorHead
        badge={
          <span className="orq-lib__av orq-lib__av--big">
            <Plug size={16} strokeWidth={1.5} aria-hidden="true" />
          </span>
        }
        name={draft.name}
        sub={
          <>
            {t(draft.transport === 'stdio' ? 'mcp.transport.stdio' : 'mcp.transport.http')}
            {original?.scope === 'app' && (
              <span className="orq-tag orq-mcp__scope">
                <Globe size={11} strokeWidth={1.5} aria-hidden="true" /> {t('mcp.scope.badge')}
              </span>
            )}
          </>
        }
        dirty={dirty}
        saved={saved && !dirty}
        isNew={isNew}
        onDiscard={() => (setDraft(base), setErrors({}))}
        onDelete={() => void askDelete()}
        busy={busy}
      />
      {confirm !== undefined && (
        <DeleteConfirm
          title={t('mcp.delete', { name: draft.name })}
          detail={confirm}
          onCancel={() => setConfirm(undefined)}
          onConfirm={() => void api.deleteMcp(draft.id).then(() => (drafts.discard(draftKey), onDeleted()))}
        />
      )}
      <div className="orq-editor__body orq-mcpf">
        <div className="orq-editor__main">
          <section className="orq-mcpf__sec" aria-labelledby="mcp-sec-what">
            <h3 id="mcp-sec-what" className="orq-mcpf__h">
              <span className="orq-mcpf__n">1</span>
              {t('mcp.sec.what')}
            </h3>
            <div className="orq-mcpf__grid">
              <Field label={t('mcp.name')} id="mcp-name" error={errors['name']}>
                <input id="mcp-name" value={draft.name} maxLength={MCP_LIMITS.name} autoFocus={isNew} onChange={(e) => set({ name: e.target.value })} />
              </Field>
              <Field label={t('mcp.description')} id="mcp-desc" error={errors['description']}>
                <input id="mcp-desc" value={draft.description} maxLength={MCP_LIMITS.description} placeholder={t('mcp.description.hint')} onChange={(e) => set({ description: e.target.value })} />
              </Field>
            </div>
            <fieldset className="orq-mcpf__seg">
              <legend>{t('mcp.scope')}</legend>
              <div className="orq-segr">
                {(['project', 'app'] as const).map((k) => (
                  <label key={k} className={(draft.scope ?? 'project') === k ? 'is-on' : ''}>
                    <input type="radio" name={`mcp-scope-${draftKey}`} checked={(draft.scope ?? 'project') === k} onChange={() => set({ scope: k })} />
                    {k === 'app' ? <Globe size={13} strokeWidth={1.5} aria-hidden="true" /> : <FolderClosed size={13} strokeWidth={1.5} aria-hidden="true" />}
                    <span>{t(k === 'project' ? 'mcp.scope.project' : 'mcp.scope.app')}</span>
                  </label>
                ))}
              </div>
              <p className="orq-hint">{t(draft.scope === 'app' ? 'mcp.scope.hint.app' : 'mcp.scope.hint.project')}</p>
            </fieldset>
          </section>

          <section className="orq-mcpf__sec" aria-labelledby="mcp-sec-how">
            <div className="orq-mcpf__hrow">
              <h3 id="mcp-sec-how" className="orq-mcpf__h">
                <span className="orq-mcpf__n">2</span>
                {t('mcp.sec.how')}
              </h3>
              <button type="button" className="orq-btn orq-btn--small orq-btn--ghost" aria-expanded={pasteOpen} onClick={() => setPasteOpen((v) => !v)}>
                <ClipboardPaste size={14} strokeWidth={1.5} aria-hidden="true" />
                {t('mcp.paste')}
              </button>
            </div>
            {pasteOpen && (
              <div className="orq-mcpf__paste">
                <label htmlFor="mcp-paste" className="orq-sr">
                  {t('mcp.paste.label')}
                </label>
                <textarea id="mcp-paste" className="orq-mono" rows={4} value={pasteText} placeholder={t('mcp.paste.ph')} onChange={(e) => setPasteText(e.target.value)} />
                <div className="orq-mcpf__pasterow">
                  <button type="button" className="orq-btn orq-btn--small" disabled={pasteText.trim() === ''} onClick={applyPaste}>
                    {t('mcp.paste.apply')}
                  </button>
                  {pasteMsg && (
                    <p className={`orq-hint${pasteMsg.bad ? ' orq-field__error' : ''}`} role="status">
                      {pasteMsg.text}
                    </p>
                  )}
                </div>
              </div>
            )}
            <fieldset className="orq-mcpf__seg">
              <legend>{t('mcp.transport')}</legend>
              <div className="orq-segr">
                {(['stdio', 'http'] as const).map((k) => (
                  <label key={k} className={draft.transport === k ? 'is-on' : ''}>
                    <input type="radio" name={`mcp-kind-${draftKey}`} checked={draft.transport === k} onChange={() => set({ transport: k })} />
                    {k === 'stdio' ? <SquareTerminal size={13} strokeWidth={1.5} aria-hidden="true" /> : <Globe size={13} strokeWidth={1.5} aria-hidden="true" />}
                    <span>{t(k === 'stdio' ? 'mcp.transport.stdio' : 'mcp.transport.http')}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            {draft.transport === 'stdio' ? (
              <div className="orq-mcpf__cmd">
                <Field label={t('mcp.command')} id="mcp-cmd" error={errors['command']}>
                  <input id="mcp-cmd" className="orq-mono" value={draft.command ?? ''} placeholder="npx" onChange={(e) => set({ command: e.target.value })} />
                </Field>
                <Field label={t('mcp.args')} id="mcp-args" error={errors['args']}>
                  <textarea id="mcp-args" className="orq-mono" rows={3} value={draft.argsText} placeholder={'-y\n@modelcontextprotocol/server-filesystem\n.'} onChange={(e) => set({ argsText: e.target.value })} />
                </Field>
              </div>
            ) : (
              <Field label={t('mcp.url')} id="mcp-url" error={errors['url']}>
                <input id="mcp-url" className="orq-mono" value={draft.url ?? ''} placeholder="https://…" onChange={(e) => set({ url: e.target.value })} />
              </Field>
            )}
            {preview && (
              <div className="orq-mcpf__preview" aria-label={t('mcp.preview')}>
                <span>{t('mcp.preview')}</span>
                <code>{preview}</code>
              </div>
            )}
          </section>

          <section className="orq-mcpf__sec orq-mcp__secrets" aria-label={t(draft.transport === 'stdio' ? 'mcp.secrets.env' : 'mcp.secrets.headers')}>
            <h3 className="orq-mcpf__h">
              <span className="orq-mcpf__n">3</span>
              {t(draft.transport === 'stdio' ? 'mcp.secrets.env' : 'mcp.secrets.headers')}
            </h3>
            <p className="orq-hint">{t('mcp.secrets.hint')}</p>
            {(draft.secretNames ?? []).map((n) => {
              const has = secretsSet.includes(n);
              return (
                <div key={n} className={`orq-mcp__secret orq-mcpf__secret${has ? ' is-set' : ''}`}>
                  <KeyRound size={14} strokeWidth={1.5} aria-hidden="true" />
                  <code>{n}</code>
                  {has ? <span className="orq-tag is-new">{t('mcp.secret.stored')}</span> : <span className="orq-tag orq-mcpf__missing">{t('mcp.secret.missing')}</span>}
                  {!isNew && (
                    <>
                      <input
                        type="password"
                        autoComplete="off"
                        aria-label={t('mcp.secret.value', { name: n })}
                        placeholder={has ? t('mcp.secret.change') : t('mcp.secret.write')}
                        value={secretValue[n] ?? ''}
                        onChange={(e) => setSecretValue((v) => ({ ...v, [n]: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            e.stopPropagation();
                            void storeSecret(n);
                          }
                        }}
                      />
                      <button type="button" className="orq-btn orq-btn--small" disabled={(secretValue[n] ?? '') === '' || busy} onClick={() => void storeSecret(n)}>
                        {t('mcp.secret.store')}
                      </button>
                      {has && (
                        <button type="button" className="orq-btn orq-btn--small orq-btn--ghost" disabled={busy} onClick={() => void dropSecret(n)}>
                          {t('mcp.secret.clear')}
                        </button>
                      )}
                    </>
                  )}
                  <button
                    type="button"
                    className="orq-icon-btn orq-ib"
                    aria-label={t('mcp.secret.remove', { name: n })}
                    title={t('mcp.secret.remove', { name: n })}
                    onClick={() => set({ secretNames: (draft.secretNames ?? []).filter((x) => x !== n) })}
                  >
                    <Trash2 size={14} strokeWidth={1.5} aria-hidden="true" />
                  </button>
                </div>
              );
            })}
            <div className="orq-mcp__secret orq-mcpf__addsecret">
              <input
                className="orq-mono"
                aria-label={t('mcp.secret.newName')}
                placeholder={draft.transport === 'stdio' ? 'API_KEY' : 'Authorization'}
                value={secretName}
                onChange={(e) => setSecretName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    addSecretName();
                  }
                }}
              />
              <button type="button" className="orq-btn orq-btn--small" onClick={addSecretName}>
                <Plus size={14} strokeWidth={1.5} aria-hidden="true" />
                {t('mcp.secret.add')}
              </button>
            </div>
            {isNew && (draft.secretNames ?? []).length > 0 && <p className="orq-hint">{t('mcp.secret.saveFirst')}</p>}
            {errors['secretNames'] && (
              <p className="orq-field__error" role="alert">
                {errors['secretNames']}
              </p>
            )}
            {secretMsg && (
              <p className="orq-hint" role="status">
                {secretMsg}
              </p>
            )}
          </section>
        </div>
        <div className="orq-editor__side">
          <section className="orq-editor__side-sec orq-mcpf__ready" aria-label={t('mcp.ready')}>
            <h3>{t('mcp.ready')}</h3>
            <ul>
              {readiness.map((r) => (
                <li key={r.key} className={r.ok ? 'is-ok' : ''}>
                  {r.ok ? <CheckCircle2 size={15} strokeWidth={1.75} aria-hidden="true" /> : <Circle size={15} strokeWidth={1.5} aria-hidden="true" />}
                  <span>{r.label}</span>
                  <span className="orq-sr">{r.ok ? '✓' : '—'}</span>
                </li>
              ))}
            </ul>
            <button type="button" className="orq-btn orq-btn--small orq-mcpf__test" disabled={isNew || dirty || test === 'busy'} title={isNew || dirty ? t('mcp.test.saveFirst') : undefined} onClick={() => void runTest()}>
              {test === 'busy' ? <Loader2 size={14} className="orq-spin" aria-hidden="true" /> : <Zap size={14} strokeWidth={1.5} aria-hidden="true" />}
              {test === 'busy' ? t('mcp.test.busy') : t('mcp.test')}
            </button>
            {test && test !== 'busy' && (
              <div className={`orq-mcp__test ${test.ok ? 'is-ok' : 'is-bad'}`} role="status">
                <p>{test.message}</p>
                {test.tools.length > 0 && (
                  <div className="orq-insp__chips">
                    {test.tools.map((x) => (
                      <span key={x} className="orq-tag">
                        {x}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
          {(onAskClaude || onOpenTerminal) && (
            <section className="orq-editor__side-sec orq-mcpf__claude" aria-label={t('mcp.askbox')}>
              <h3>
                <Sparkles size={14} strokeWidth={1.5} aria-hidden="true" />
                {t('mcp.askbox')}
              </h3>
              {onAskClaude && (
                <>
                  {!isNew && (
                    // Un <div> y no un <form>: va dentro del formulario de la ficha y enviar no debe guardarla [R63.21].
                    <div className="orq-mcpf__askbox">
                      <input
                        aria-label={t('mcp.askbox')}
                        placeholder={t('mcp.askbox.ph')}
                        value={askText}
                        onChange={(e) => setAskText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter') return;
                          e.preventDefault();
                          e.stopPropagation();
                          sendAsk();
                        }}
                      />
                      <button type="button" className="orq-btn orq-btn--small" disabled={askText.trim() === '' || busy} onClick={sendAsk}>
                        {t('mcp.askbox.send')}
                      </button>
                    </div>
                  )}
                  <button
                    type="button"
                    className="orq-btn orq-btn--small orq-ai__btn"
                    disabled={busy}
                    onClick={() => onAskClaude(isNew ? t('as.prompt.mcpNew', { name: draft.name.trim() ? ` («${draft.name.trim()}»)` : '' }) : t('as.prompt.mcpConfig', { name: draft.name, id: draft.id }))}
                  >
                    <Sparkles size={14} strokeWidth={1.5} aria-hidden="true" />
                    {t('mcp.claude')}
                  </button>
                </>
              )}
              {onOpenTerminal && (
                <>
                  <button type="button" className="orq-btn orq-btn--small" onClick={onOpenTerminal}>
                    <SquareTerminal size={14} strokeWidth={1.5} aria-hidden="true" />
                    {t('mcp.terminal')}
                  </button>
                  <p className="orq-hint">{t('mcp.terminal.hint')}</p>
                </>
              )}
            </section>
          )}
          <section className="orq-editor__side-sec" aria-label={t('mcp.state')}>
            <h3>{t('mcp.state')}</h3>
            <label className="orq-switch">
              <span>{t('mcp.enabled')}</span>
              <input type="checkbox" role="switch" checked={draft.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
            </label>
            {!draft.enabled && <p className="orq-hint">{t('mcp.enabled.off')}</p>}
            <label className="orq-switch">
              <span>{t('mcp.trusted')}</span>
              <input type="checkbox" role="switch" checked={draft.trusted === true} onChange={(e) => set({ trusted: e.target.checked })} />
            </label>
            <p className="orq-hint">{t(draft.trusted ? 'mcp.trusted.on' : 'mcp.trusted.off')}</p>
            <p className="orq-mcpf__warn" role="note">
              <AlertTriangle size={13} strokeWidth={1.5} aria-hidden="true" /> {t('mcp.warning')}
            </p>
          </section>
          <UsedBy api={api} kind="mcp" id={draft.id} saved={!isNew} agents={agents} onChanged={onAgentsChanged} />
        </div>
      </div>
    </form>
  );
}
