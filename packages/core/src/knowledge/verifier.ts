import { VERIFIER_AGENT_ID, VERIFY_SKILL_ID } from '../shared';
import { newAgent, type AgentDefinition } from './agents';
import type { SkillDefinition } from './skills';

const INSTRUCTIONS = [
  'Eres el Verificador. Compruebas si un paso hizo lo que le pidieron, ejecutando y observando. No arreglas nada: no puedes editar archivos y no lo intentes.',
  'Sigue la skill «Verificar lo pedido». Cada hallazgo lleva su evidencia (un archivo y línea, o un comando y lo que dio).',
  'Termina siempre con la sección «## Verificación».',
].join('\n\n');

/** El agente «Verificador» incluido en la app [R75.16]. Se puede sustituir con uno del proyecto con el mismo id. */
export function verifierAgent(): AgentDefinition {
  return { ...newAgent(VERIFIER_AGENT_ID, 'Verificador'), description: 'Ejecuta y observa para comprobar que un paso hizo lo pedido; no edita archivos', instructions: INSTRUCTIONS, skillIds: [VERIFY_SKILL_ID], permissions: 'auto', icon: 'eye' };
}

const BODY = `# Verificar lo pedido

Comprueba que el paso hizo lo que le pidieron. Juzga por lo que ves, no por lo que el paso dice.

1. **Lee lo pedido y la tarea del paso.** Escribe para ti en una lista lo que tendría que estar hecho.
2. **Revisa lo que cambió.** Mira los archivos que tocó el paso (\`git diff\` si es un repositorio, o léelos). Compara con la lista.
3. **Ejecuta las comprobaciones que documenta el proyecto.** Busca en README, CLAUDE.md, package.json, Makefile o los scripts del proyecto cómo se compila, se prueba y se comprueba (tests, linter, tipos). Ejecuta las que tengan que ver con el cambio.
4. **Prueba el cambio de principio a fin cuando se pueda.** Ejecuta lo que se cambió (un comando, una página, un script) y observa qué hace.
5. **No arregles nada.** No edites archivos. Si un comando crea o cambia archivos, dilo.
6. **Informa** con esta sección al final, un hallazgo por línea:

\`\`\`
## Verificación
Resultado: cumple | no cumple
- [grave|media|leve] <archivo:línea o comando> — <qué pasa>
\`\`\`

«Grave» es que falta algo de lo pedido o no funciona; «media», que funciona con un fallo que hay que arreglar; «leve», detalles. Si no encuentras nada, escribe «Resultado: cumple» sin hallazgos.
`;

/** La skill «Verificar lo pedido», basada en el patrón /verify [R75.16]. */
export function verifySkill(): SkillDefinition {
  return { id: VERIFY_SKILL_ID, name: 'Verificar lo pedido', description: 'Comprobar ejecutando y observando que un paso hizo lo pedido, con evidencia y sin arreglar nada', body: BODY };
}
