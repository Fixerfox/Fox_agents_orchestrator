/** Recorta un texto largo guardando el principio y el final: lo importante de una entrega suele ir al final [R63.2]. */
export function clipMiddle(text: string, max: number): string {
  if (text.length <= max) return text;
  const marker = (n: number) => `\n[… ${n} caracteres omitidos …]\n`;
  const room = Math.max(0, max - marker(text.length).length);
  const head = Math.floor(room * 0.4);
  const tail = room - head;
  return `${text.slice(0, head)}${marker(text.length - head - tail)}${tail > 0 ? text.slice(text.length - tail) : ''}`;
}

/** Neutraliza cualquier cierre de `tag` (`</datos>`, `</ DATOS >`…) para que un texto no salga de su bloque [R63.10]. */
export function neutralizeTag(text: string, tag: string): string {
  return text.replace(new RegExp(`<\\s*/\\s*${tag}\\s*>`, 'gi'), `</${tag}\u200b>`);
}
