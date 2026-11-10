import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';

// En Windows la carpeta temporal puede venir con nombre corto 8.3 (C:\Users\RUNNER~1\…), y al resolverla da el largo:
// los tests que comparan rutas fallarían solo por eso. Se usa ya resuelta.
if (process.platform === 'win32') {
  try {
    const real = realpathSync.native(tmpdir());
    process.env.TEMP = real;
    process.env.TMP = real;
  } catch {
    // sin carpeta temporal accesible, se deja como está
  }
}
