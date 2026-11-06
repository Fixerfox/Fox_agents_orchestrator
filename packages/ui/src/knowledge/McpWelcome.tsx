import { useState } from 'react';
import { BookOpen, Bug, Cloud, Code2, Compass, Database, Eye, FileCode2, FileText, FlaskConical, Folder, FolderOpen, GitBranch, Globe, Languages, Link2, MessageSquare, PackagePlus, Palette, PenLine, ScrollText, ShieldCheck, TestTube2 } from 'lucide-react';
import { t, type MessageKey } from '@orquestador/editor';
import { CreateWelcome, type WelcomeAction, type WelcomeIdea } from './CreateWelcome';

/** Servicios frecuentes: atajos que piden el alta al asistente, sin comandos guardados en la app [R38.6]. */
const SERVICES: { id: string; icon: WelcomeIdea['icon']; ask?: MessageKey }[] = [
  { id: 'github', icon: GitBranch },
  { id: 'notion', icon: FileText },
  { id: 'slack', icon: MessageSquare },
  { id: 'drive', icon: Cloud },
  { id: 'db', icon: Database, ask: 'mcp.svc.db.ask' },
  { id: 'browser', icon: Globe, ask: 'mcp.svc.browser.ask' },
  { id: 'files', icon: Folder, ask: 'mcp.svc.files.ask' },
];

/** Petición que recibe el asistente para dar de alta un servicio [R38.6]. */
export function mcpWelcomePrompt(service: string, scope: 'project' | 'app'): string {
  return t('mcp.welcome.prompt', { service, where: t(scope === 'app' ? 'mcp.welcome.where.app' : 'mcp.welcome.where.project') });
}

/**
 * Primera pantalla de «Nuevo servidor MCP»: el asistente por delante. Describirlo o elegir un servicio abre el
 * asistente al lado con la petición; «Configurar a mano» abre la ficha [R38.6].
 */
export function McpWelcome({ ready, onAsk, onManual }: { ready: boolean; onAsk: (text: string) => void; onManual: () => void }) {
  const [scope, setScope] = useState<'project' | 'app'>('project');
  return (
    <CreateWelcome
      title={t('mcp.welcome.title')}
      sub={t('mcp.welcome.sub')}
      ready={ready}
      inputLabel={t('mcp.welcome.input')}
      placeholder={t('mcp.welcome.ph')}
      prompt={(text) => mcpWelcomePrompt(text, scope)}
      ideasLabel={t('mcp.welcome.popular')}
      ideas={SERVICES.map(({ id, icon, ask }) => {
        const name = t(`mcp.svc.${id}` as MessageKey);
        return { id, icon, title: name, sub: t(`mcp.svc.${id}.sub` as MessageKey), prompt: mcpWelcomePrompt(ask ? t(ask) : name, scope) };
      })}
      actionsLabel={t('mcp.welcome.manual')}
      actions={[{ id: 'manual', title: t('mcp.welcome.manual'), sub: t('mcp.welcome.manual.sub'), onClick: onManual }]}
      extra={
        <div className="orq-mcpw__scope" role="radiogroup" aria-label={t('mcp.welcome.scope')}>
          <span>{t('mcp.welcome.scope')}</span>
          {(['project', 'app'] as const).map((k) => (
            <label key={k} className={`orq-pick${scope === k ? ' is-on' : ''}`}>
              <input type="radio" name="mcpw-scope" checked={scope === k} onChange={() => setScope(k)} />
              {t(k === 'project' ? 'mcp.scope.project' : 'mcp.scope.app')}
            </label>
          ))}
        </div>
      }
      onAsk={onAsk}
    />
  );
}

/** Ideas de skills: el asistente la redacta (y puede mirar el proyecto para adaptarla) [R38.19]. */
const SKILL_IDEAS: { id: string; icon: WelcomeIdea['icon'] }[] = [
  { id: 'review', icon: ShieldCheck },
  { id: 'tests', icon: TestTube2 },
  { id: 'docs', icon: ScrollText },
  { id: 'bugs', icon: Bug },
  { id: 'style', icon: FileCode2 },
  { id: 'text', icon: Languages },
];

/**
 * Primera pantalla de «Nueva skill»: describir lo que debe saber hacer (lo redacta el asistente), ideas frecuentes y,
 * a mano, escribirla, instalarla desde una carpeta o Zip o añadir Spec Kit [R38.19].
 */
export function SkillWelcome({ ready, onAsk, onWrite, onInstall, onSpecKit }: { ready: boolean; onAsk: (text: string) => void; onWrite: () => void; onInstall: () => void; onSpecKit?: (() => void) | undefined }) {
  const prompt = (what: string) => t('skill.welcome.prompt', { what });
  const actions: WelcomeAction[] = [
    { id: 'write', icon: PenLine, title: t('welcome.write'), sub: t('skill.welcome.write.sub'), onClick: onWrite },
    { id: 'install', icon: PackagePlus, title: t('install.open'), sub: t('skill.welcome.install.sub'), onClick: onInstall },
    ...(onSpecKit ? [{ id: 'speckit', icon: BookOpen, title: t('speckit.install'), sub: t('skill.welcome.speckit.sub'), onClick: onSpecKit }] : []),
  ];
  return (
    <CreateWelcome
      title={t('skill.welcome.title')}
      sub={t('skill.welcome.sub')}
      ready={ready}
      inputLabel={t('skill.welcome.input')}
      placeholder={t('skill.welcome.ph')}
      prompt={prompt}
      ideasLabel={t('welcome.ideas')}
      ideas={SKILL_IDEAS.map(({ id, icon }) => ({ id, icon, title: t(`skill.idea.${id}` as MessageKey), sub: t(`skill.idea.${id}.sub` as MessageKey), prompt: prompt(t(`skill.idea.${id}.ask` as MessageKey)) }))}
      actionsLabel={t('welcome.manual')}
      actions={actions}
      onAsk={onAsk}
    />
  );
}

/** Ideas de contextos: el asistente puede leer las carpetas del proyecto para resumirlas [R38.20]. */
const CONTEXT_IDEAS: { id: string; icon: WelcomeIdea['icon'] }[] = [
  { id: 'arch', icon: FolderOpen },
  { id: 'glossary', icon: BookOpen },
  { id: 'style', icon: PenLine },
  { id: 'rules', icon: ScrollText },
];

/**
 * Primera pantalla de «Nuevo contexto»: describir lo que deben saber los agentes (lo prepara el asistente, que puede
 * leer el proyecto), ideas frecuentes y, a mano, escribir un texto, elegir archivos o poner una dirección web [R38.20].
 */
export function ContextWelcome({ ready, onAsk, onWrite, onFiles, onUrl }: { ready: boolean; onAsk: (text: string) => void; onWrite: () => void; onFiles: () => void; onUrl: () => void }) {
  const prompt = (what: string) => t('ctx.welcome.prompt', { what });
  return (
    <CreateWelcome
      title={t('ctx.welcome.title')}
      sub={t('ctx.welcome.sub')}
      ready={ready}
      inputLabel={t('ctx.welcome.input')}
      placeholder={t('ctx.welcome.ph')}
      prompt={prompt}
      ideasLabel={t('welcome.ideas')}
      ideas={CONTEXT_IDEAS.map(({ id, icon }) => ({ id, icon, title: t(`ctx.idea.${id}` as MessageKey), sub: t(`ctx.idea.${id}.sub` as MessageKey), prompt: prompt(t(`ctx.idea.${id}.ask` as MessageKey)) }))}
      actionsLabel={t('ctx.add')}
      actions={[
        { id: 'write', icon: FileText, title: t('ctx.add.write'), sub: t('ctx.welcome.write.sub'), onClick: onWrite },
        { id: 'files', icon: Folder, title: t('ctx.add.files'), sub: t('ctx.welcome.files.sub'), onClick: onFiles },
        { id: 'url', icon: Link2, title: t('ctx.welcome.url'), sub: t('ctx.welcome.url.sub'), onClick: onUrl },
      ]}
      onAsk={onAsk}
    />
  );
}


/** Ideas de la bienvenida de agentes [R57.1]. */
const AGENT_IDEAS: { id: string; icon: WelcomeIdea['icon'] }[] = [
  { id: 'impl', icon: Code2 },
  { id: 'review', icon: Eye },
  { id: 'tests', icon: FlaskConical },
  { id: 'web', icon: Palette },
  { id: 'docs', icon: ScrollText },
  { id: 'research', icon: Compass },
];

/**
 * Bienvenida de «Nuevo agente» [R57.1]: describirlo o elegir una idea abre los pasos con esa descripción
 * (no el chat del asistente); «Escribir» abre los pasos en blanco.
 */
export function AgentWelcome({ ready, onStart, onWrite, onInstall, onSpecKit }: { ready: boolean; onStart: (text: string) => void; onWrite: () => void; onInstall: () => void; onSpecKit?: (() => void) | undefined }) {
  const actions: WelcomeAction[] = [
    { id: 'write', icon: PenLine, title: t('welcome.write'), sub: t('agent.welcome.write.sub'), onClick: onWrite },
    { id: 'install', icon: PackagePlus, title: t('install.open'), sub: t('agent.welcome.install.sub'), onClick: onInstall },
    ...(onSpecKit ? [{ id: 'speckit', icon: BookOpen, title: t('speckit.install'), sub: t('skill.welcome.speckit.sub'), onClick: onSpecKit }] : []),
  ];
  return (
    <CreateWelcome
      title={t('agent.welcome.title')}
      sub={t('agent.welcome.sub')}
      ready={ready}
      inputLabel={t('agent.welcome.input')}
      placeholder={t('agent.welcome.ph')}
      prompt={(text) => text}
      goLabel={t('agent.welcome.go')}
      ideasLabel={t('welcome.ideas')}
      ideas={AGENT_IDEAS.map(({ id, icon }) => ({ id, icon, title: t(`agent.idea.${id}` as MessageKey), sub: t(`agent.idea.${id}.sub` as MessageKey), prompt: t(`agent.idea.${id}.ask` as MessageKey) }))}
      actionsLabel={t('welcome.manual')}
      actions={actions}
      onAsk={onStart}
    />
  );
}
