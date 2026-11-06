import type { ReactNode } from 'react';

/** Campo de formulario con etiqueta y error junto al campo [R22.6]. */
export function Field({ label, error, id, hint, children }: { label: string; error?: string | undefined; id: string; hint?: string; children: ReactNode }) {
  return (
    <div className={`orq-field${error ? ' has-error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && !error && <p className="orq-hint">{hint}</p>}
      {error && (
        <p className="orq-field__error" id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Convierte los problemas de validación del IPC en un mapa campo → mensaje. */
export function fieldErrors(error: { message: string; fields?: { field: string; message: string }[] }): Record<string, string> {
  if (!error.fields || error.fields.length === 0) return { _: error.message };
  const out: Record<string, string> = {};
  for (const f of error.fields) out[f.field] ??= f.message;
  return out;
}
