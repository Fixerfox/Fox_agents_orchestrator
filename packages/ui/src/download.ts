/** Descarga un texto como archivo desde la interfaz (sin pasar por el sistema de archivos). */
export function downloadText(name: string, text: string, type = 'application/x-ndjson'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
