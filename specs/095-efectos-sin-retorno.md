# SPEC-095 · Los efectos de React no devuelven nada por accidente

**Estado:** Implementada · **Hito:** M17d · **Paquetes:** `ui` · **Rama:** `fix/efectos-react`

## Propósito
Al cerrar la pestaña del Supervisor de una ejecución, la pantalla falló con «u is not a function» (10/11/2026). La causa estaba en un efecto de una línea:

```ts
useEffect(() => focused.current?.scrollIntoView?.({ block: 'nearest' }), [focus]);
```

En Electron 45 (Chromium reciente), `scrollIntoView()` **devuelve una promesa**. El efecto la devolvía sin querer, React la guardaba como función de limpieza y, al desmontar el panel, intentaba llamarla. En los tests no se veía porque en jsdom `scrollIntoView` devuelve `undefined`.

Pasa lo mismo con cualquier efecto cuyo cuerpo es una expresión: hoy devuelve `undefined`, pero basta con que la función llamada empiece a devolver algo para que la pantalla se caiga al cerrarse.

## Requisitos
- **R95.1** [M17d] Ningún `useEffect` ni `useLayoutEffect` de la interfaz tiene como cuerpo una expresión que pueda devolver un valor. El cuerpo es un bloque `{ … }`, una función de limpieza (`() => () => …`) o `void …`.
- **R95.2** [M17d] Un test recorre `packages/ui/src` y falla si encuentra un efecto que no cumple R95.1, diciendo el archivo y la línea.
- **R95.3** [M17d] El panel del Supervisor se monta y se desmonta sin error con un `scrollIntoView` que devuelve una promesa, como en Chromium.
