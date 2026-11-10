import { promises as fs } from 'node:fs';
import path from 'node:path';
import { StoreError } from './errors';
import { isRelativeInside } from '@orquestador/core';

/** Lo que no debe ir a git de `.orquestador`: es de cada equipo y puede llevar datos de las ejecuciones [R90.7]. */
export const PROJECT_GITIGNORE = ['# Datos de cada equipo: ejecuciones, copias, adjuntos y casos del Supervisor', 'runs/', 'copias/', 'attachments/', 'supervisor/', 'approved-checks.json'];

/** Crea `.orquestador/.gitignore` si no existe; nunca pisa el del usuario ni impide abrir [R90.7]. */
export async function ensureProjectGitignore(orqDir: string): Promise<void> {
  try {
    await fs.writeFile(path.join(orqDir, '.gitignore'), `${PROJECT_GITIGNORE.join('\n')}\n`, { flag: 'wx' });
  } catch {
    /* ya existe o no se puede escribir */
  }
}

/** Falla si la ruta real de `file` (enlaces resueltos, aunque aún no exista) sale de `base` [R90.14]. */
export async function assertRealInside(base: string, file: string, message: string): Promise<void> {
  const realBase = await fs.realpath(base).catch(() => path.resolve(base));
  let probe = path.resolve(file);
  let tail = '';
  for (;;) {
    let real: string;
    try {
      real = path.join(await fs.realpath(probe), tail);
    } catch {
      const up = path.dirname(probe);
      if (up === probe) return;
      tail = path.join(path.basename(probe), tail);
      probe = up;
      continue;
    }
    const rel = path.relative(realBase, real);
    if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new StoreError('outside-root', message);
    return;
  }
}

/** Ruta de un archivo de una skill: relativa, que no sea SKILL.md y que no salga de su carpeta por un enlace [R24.10][R90.14]. */
export async function skillFilePath(skillDir: string, rel: string): Promise<string> {
  if (!isRelativeInside(rel) || rel === 'SKILL.md') throw new StoreError('outside-root', 'Ruta de archivo no válida en la skill');
  const file = path.join(skillDir, ...rel.split(/[\\/]/));
  await assertRealInside(skillDir, file, 'Ese archivo apunta fuera de la carpeta de la skill');
  return file;
}
