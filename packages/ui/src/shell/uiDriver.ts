/** Manejar la interfaz desde el modo prueba, sobre el DOM [R82.8]. Sin React: se prueba con jsdom. */

export interface UiItem {
  role: string;
  name: string;
  /** Desactivado, marcado, seleccionado, valor… */
  state: string[];
  /** Diálogo en el que está, si lo hay. */
  dialog?: string;
  el: HTMLElement;
}

const INTERACTIVE = 'button, a[href], input, textarea, select, [role], h1, h2, h3, h4, h5, h6, [contenteditable="true"]';
const ROLES_OF_INTEREST = new Set(['button', 'link', 'textbox', 'searchbox', 'checkbox', 'radio', 'switch', 'combobox', 'listbox', 'option', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'slider', 'spinbutton', 'heading', 'treeitem', 'dialog', 'alertdialog', 'alert']);
const MAX_ITEMS = 400;
const MAX_NAME = 120;

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const clip = (s: string) => (s.length > MAX_NAME ? `${s.slice(0, MAX_NAME - 1)}…` : s);

function implicitRole(el: HTMLElement): string | undefined {
  const tag = el.tagName.toLowerCase();
  if (tag === 'button') return 'button';
  if (tag === 'a') return el.hasAttribute('href') ? 'link' : undefined;
  if (/^h[1-6]$/.test(tag)) return 'heading';
  if (tag === 'select') return 'combobox';
  if (tag === 'textarea') return 'textbox';
  if (tag === 'dialog') return 'dialog';
  if (tag === 'input') {
    const type = (el.getAttribute('type') ?? 'text').toLowerCase();
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    if (type === 'range') return 'slider';
    if (type === 'number') return 'spinbutton';
    if (type === 'button' || type === 'submit' || type === 'reset') return 'button';
    if (type === 'hidden' || type === 'file') return undefined;
    return type === 'search' ? 'searchbox' : 'textbox';
  }
  if (el.getAttribute('contenteditable') === 'true') return 'textbox';
  return undefined;
}

export const roleOf = (el: HTMLElement): string | undefined => el.getAttribute('role')?.split(' ')[0] || implicitRole(el);

/** ¿Se ve? Oculto, `aria-hidden` o sin mostrar en él o en un antecesor no cuenta. */
function visible(el: HTMLElement): boolean {
  for (let n: HTMLElement | null = el; n; n = n.parentElement) {
    if (n.hidden || n.getAttribute('aria-hidden') === 'true' || n.hasAttribute('inert')) return false;
    const style = n.ownerDocument.defaultView?.getComputedStyle(n);
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
  }
  return true;
}

const byIds = (doc: Document, ids: string) => ids.split(/\s+/).map((id) => clean(doc.getElementById(id)?.textContent)).filter(Boolean).join(' ');

/** Nombre accesible, simplificado: aria-labelledby, aria-label, etiqueta, texto, placeholder, title. */
export function accessibleName(el: HTMLElement): string {
  const doc = el.ownerDocument;
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const n = byIds(doc, labelledBy);
    if (n) return clip(n);
  }
  const aria = clean(el.getAttribute('aria-label'));
  if (aria) return clip(aria);
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    const id = el.getAttribute('id');
    // Sin selector CSS: los ids de React llevan «:».
    const forLabel = id ? Array.from(doc.querySelectorAll('label[for]')).find((l) => l.getAttribute('for') === id) : undefined;
    const label = forLabel ?? el.closest('label');
    if (label) {
      // El texto de la etiqueta sin el del propio campo (un <select> dentro de su <label>).
      const copy = label.cloneNode(true) as HTMLElement;
      copy.querySelectorAll('input, textarea, select').forEach((x) => x.remove());
      const n = clean(copy.textContent);
      if (n) return clip(n);
    }
    const ph = clean(el.getAttribute('placeholder'));
    if (ph) return clip(ph);
  } else {
    const n = clean(el.textContent);
    if (n) return clip(n);
  }
  return clip(clean(el.getAttribute('title')));
}

function stateOf(el: HTMLElement, role: string): string[] {
  const out: string[] = [];
  if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') out.push('desactivado');
  if ((el as HTMLInputElement).checked || el.getAttribute('aria-checked') === 'true') out.push('marcado');
  if (el.getAttribute('aria-selected') === 'true') out.push('seleccionado');
  if (el.getAttribute('aria-pressed') === 'true') out.push('pulsado');
  if (el.getAttribute('aria-expanded') === 'true') out.push('desplegado');
  if (el.getAttribute('aria-current')) out.push('actual');
  if (role === 'textbox' || role === 'searchbox' || role === 'spinbutton' || role === 'combobox' || role === 'slider') {
    const v = (el as HTMLInputElement).value;
    if (typeof v === 'string' && v !== '') out.push(`valor «${clip(clean(v))}»`);
  }
  if (role === 'heading') out.push(`nivel ${el.getAttribute('aria-level') ?? el.tagName.slice(1)}`);
  return out;
}

function dialogOf(el: HTMLElement): string | undefined {
  const d = el.closest<HTMLElement>('[role="dialog"], [role="alertdialog"], dialog');
  return d && d !== el ? accessibleName(d) || '(sin nombre)' : undefined;
}

/** Elementos con los que se puede interactuar y títulos, en orden del documento [R82.8]. */
export function collect(root: ParentNode = document): UiItem[] {
  const out: UiItem[] = [];
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(INTERACTIVE))) {
    const role = roleOf(el);
    if (!role || !ROLES_OF_INTEREST.has(role) || !visible(el)) continue;
    const dialog = dialogOf(el);
    out.push({ role, name: accessibleName(el), state: stateOf(el, role), ...(dialog ? { dialog } : {}), el });
  }
  return out;
}

/** Lo que hay en pantalla, una línea por elemento [R82.8]. */
export function snapshot(root: ParentNode = document): string {
  const items = collect(root);
  const lines = items.slice(0, MAX_ITEMS).map((i) => `${i.dialog ? `[${i.dialog}] ` : ''}${i.role} «${i.name}»${i.state.length > 0 ? ` (${i.state.join(', ')})` : ''}`);
  if (items.length > MAX_ITEMS) lines.push(`(y ${items.length - MAX_ITEMS} más)`);
  return lines.length > 0 ? lines.join('\n') : '(pantalla sin elementos)';
}

/** Distancia de edición, para sugerir nombres parecidos. */
function distance(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]!;
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j]!;
      d[j] = Math.min(d[j]! + 1, d[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return d[b.length]!;
}

function notFound(what: string, name: string, items: UiItem[]): Error {
  const near = [...new Set(items.map((i) => `${i.role} «${i.name}»`))]
    .map((label) => ({ label, d: distance(name.toLowerCase(), (label.split('«')[1] ?? '').replace(/»$/, '').toLowerCase()) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 8)
    .map((x) => x.label);
  return new Error(`No encuentro ${what} «${name}».${near.length > 0 ? ` Parecidos: ${near.join(', ')}.` : ''}`);
}

/** Busca por nombre: primero exacto sin distinguir mayúsculas, después «contiene» [R82.8]. */
export function find(name: string, opts: { role?: string; index?: number; roles?: ReadonlySet<string> } = {}, root: ParentNode = document): HTMLElement {
  const all = collect(root);
  const pool = all.filter((i) => (opts.role ? i.role === opts.role : true) && (opts.roles ? opts.roles.has(i.role) : i.role !== 'heading'));
  const want = clean(name).toLowerCase();
  const exact = pool.filter((i) => i.name.toLowerCase() === want);
  const matches = exact.length > 0 ? exact : pool.filter((i) => i.name.toLowerCase().includes(want));
  const pick = matches[opts.index ?? 0];
  if (!pick) throw notFound(opts.role ?? 'el elemento', name, pool);
  return pick.el;
}

/** Pulsa un elemento [R82.8]. */
export function click(name: string, opts: { role?: string; index?: number } = {}, root: ParentNode = document): string {
  const el = find(name, opts, root);
  if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') throw new Error(`«${accessibleName(el)}» está desactivado.`);
  el.focus();
  el.click();
  return `Pulsado ${roleOf(el)} «${accessibleName(el)}».`;
}

const FIELD_ROLES: ReadonlySet<string> = new Set(['textbox', 'searchbox', 'spinbutton', 'combobox', 'slider']);

/** Cambia el valor como lo haría una persona, para que React se entere. */
function setValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function key(el: Element, k: string): void {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  el.dispatchEvent(new KeyboardEvent('keyup', { key: k, bubbles: true, cancelable: true }));
}

/** Escribe en un campo; en un selector, elige la opción por su texto o su valor [R82.8]. */
export function type(label: string, text: string, submit = false, root: ParentNode = document): string {
  const el = find(label, { roles: FIELD_ROLES }, root);
  el.focus();
  if (el instanceof HTMLSelectElement) {
    const want = text.trim().toLowerCase();
    const opt = Array.from(el.options).find((o) => clean(o.textContent).toLowerCase() === want || o.value.toLowerCase() === want);
    if (!opt) throw new Error(`«${accessibleName(el)}» no tiene la opción «${text}». Opciones: ${Array.from(el.options).map((o) => clean(o.textContent)).join(', ')}.`);
    el.value = opt.value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return `Elegido «${clean(opt.textContent)}» en «${accessibleName(el)}».`;
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) setValue(el, text);
  else {
    el.textContent = text;
    el.dispatchEvent(new InputEvent('input', { bubbles: true }));
  }
  if (submit) key(el, 'Enter');
  // Muchos campos guardan al perder el foco.
  else el.blur();
  return `Escrito en «${accessibleName(el)}».`;
}

/** Pulsa una tecla en el elemento con foco [R82.8]. */
export function press(k: string, doc: Document = document): string {
  const target = doc.activeElement ?? doc.body;
  key(target, k);
  return `Pulsada ${k} en ${target === doc.body ? 'la página' : `«${accessibleName(target as HTMLElement)}»`}.`;
}

/** Espera a que un texto aparezca o desaparezca [R82.8]. */
export async function waitFor(text: string, opts: { gone?: boolean; timeoutMs?: number; doc?: Document; sleep?: (ms: number) => Promise<void> } = {}): Promise<string> {
  const doc = opts.doc ?? document;
  const timeout = Math.min(Math.max(opts.timeoutMs ?? 5_000, 0), 60_000);
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const want = clean(text).toLowerCase();
  const present = () => clean(doc.body.textContent).toLowerCase().includes(want);
  for (let waited = 0; ; waited += 100) {
    if (present() !== (opts.gone === true)) return opts.gone ? `«${text}» ya no está.` : `«${text}» está en pantalla.`;
    if (waited >= timeout) throw new Error(opts.gone ? `«${text}» sigue en pantalla tras ${timeout} ms.` : `«${text}» no apareció en ${timeout} ms.`);
    await sleep(100);
  }
}
