import { describe, expect, it } from 'vitest';
import {
  newAgent,
  newSkill,
  parseFrontmatter,
  parseSkillMd,
  serializeSkillMd,
  validateAgent,
  validateSkill,
  withoutSkill,
} from '../src';

const fields = (p: { field: string }[]) => p.map((x) => x.field);

describe('skills [R24.1]', () => {
  it('[R24.1] valida nombre, descripción obligatoria, tamaño y id', () => {
    expect(validateSkill({ ...newSkill('a', 'A'), description: 'Cuándo usarla', body: 'x' })).toEqual([]);
    expect(fields(validateSkill({ id: '../x', name: ' ', description: '', body: 3 })).sort()).toEqual(['body', 'description', 'id', 'name']);
    expect(fields(validateSkill({ ...newSkill('a', 'A'), description: 'x'.repeat(301) }))).toEqual(['description']);
    expect(fields(validateSkill({ ...newSkill('a', 'A'), description: 'd', body: 'x'.repeat(50_001) }))).toEqual(['body']);
    expect(validateSkill(null)[0]!.field).toBe('skill');
  });
});

describe('SKILL.md [R24.2]', () => {
  const same = (s: { name: string; description: string; body: string }) => {
    const back = parseSkillMd('id', serializeSkillMd(s));
    expect(back).toMatchObject({ name: s.name.trim(), description: s.description.trim(), body: s.body.replace(/\s+$/, '') });
  };

  it('[R24.2] escribir y volver a leer no cambia el significado', () => {
    same({ name: 'Pixel art', description: 'Úsala para dibujar sprites', body: '# Título\n\nPasos:\n1. Uno' });
    same({ name: 'Con: dos puntos', description: 'Usa "comillas" y \'simples\' y # almohadilla', body: 'Texto' });
    same({ name: 'Multi', description: 'Línea uno\nlínea dos: con dos puntos', body: '---\nregla horizontal\n---\n\nfin' });
    same({ name: 'Vacía', description: 'd', body: '' });
  });

  it('[R24.2] la cabecera es la nativa de Claude Code', () => {
    expect(serializeSkillMd({ name: 'A', description: 'B', body: 'C' })).toBe('---\nname: "A"\ndescription: "B"\n---\n\nC\n');
  });

  it('[R24.2] lee cabeceras de otros editores: sin comillas, comillas simples, bloques, CRLF y BOM', () => {
    expect(parseFrontmatter('---\nname: x\ndescription: Hola mundo\n---\ncuerpo').data).toEqual({ name: 'x', description: 'Hola mundo' });
    expect(parseFrontmatter("---\nname: 'it''s'\n---\n").data['name']).toBe("it's");
    expect(parseFrontmatter('---\ndescription: >\n  uno\n  dos\n---\nb').data['description']).toBe('uno dos');
    expect(parseFrontmatter('---\ndescription: |\n  uno\n  dos\n---\nb').data['description']).toBe('uno\ndos');
    expect(parseFrontmatter('---\ndescription: uno\n  sigue\n---\nb').data['description']).toBe('uno sigue');
    expect(parseFrontmatter('---\ntools: [Read, "Grep"]\n---\n').data['tools']).toBe('Read, Grep');
    const crlf = parseFrontmatter('﻿---\r\nname: x\r\n---\r\n\r\ncuerpo\r\n');
    expect(crlf).toEqual({ data: { name: 'x' }, body: 'cuerpo\n' });
  });

  it('[R24.2] sin cabecera todo es contenido y el nombre cae al id', () => {
    expect(parseSkillMd('mi-skill', 'Solo texto')).toEqual({ id: 'mi-skill', name: 'mi-skill', description: '', body: 'Solo texto' });
  });
});

describe('skills de un agente [R24.4]', () => {
  it('[R24.4] un agente no puede usar skills que no existen ni repetidas', () => {
    const ok = { contextIds: new Set<string>(), skillIds: new Set(['a']) };
    expect(validateAgent({ ...newAgent('x', 'X'), skillIds: ['a'] }, ok)).toEqual([]);
    expect(fields(validateAgent({ ...newAgent('x', 'X'), skillIds: ['zz'] }, ok))).toEqual(['skillIds']);
    expect(fields(validateAgent({ ...newAgent('x', 'X'), skillIds: ['a', 'a'] }, ok))).toEqual(['skillIds']);
    const { skillIds: _omit, ...old } = newAgent('x', 'X');
    void _omit;
    expect(validateAgent(old, ok)).toEqual([]);
  });

  it('[R24.4] withoutSkill devuelve solo los agentes que cambian', () => {
    const a = { ...newAgent('a', 'A'), skillIds: ['s', 't'] };
    const b = newAgent('b', 'B');
    expect(withoutSkill([a, b], 's')).toEqual([{ ...a, skillIds: ['t'] }]);
  });
});
