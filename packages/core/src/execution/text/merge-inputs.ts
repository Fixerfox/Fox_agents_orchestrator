import type { Payload } from '../../shared';

/** Une lo que llega a un paso: una entrada tal cual; varias, cada una bajo «## nombre». */
export function mergeInputs(parts: { label: string; payload: Payload }[]): Payload {
  if (parts.length === 1) {
    const only = parts[0]!.payload;
    return { text: only.text, files: [...only.files] };
  }
  return {
    text: parts.map((p) => `## ${p.label}\n${p.payload.text}`).join('\n\n'),
    files: [...new Set(parts.flatMap((p) => p.payload.files))],
  };
}
