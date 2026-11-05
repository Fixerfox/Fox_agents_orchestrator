import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { ChevronRight, Folder, FolderInput, FolderOpen, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { addFolder, buildFolderTree, moveToFolder, removeFolder, renameFolder, type FolderTreeNode, type KindFolders, type LibraryFolders, type LibraryKind } from '@orquestador/core';
import { t } from '@orquestador/editor';
import { ContextMenu, type MenuItem } from './ContextMenu';

export interface LibRow {
  id: string;
  name: string;
  description?: string;
  tag: ReactNode;
  meta: ReactNode;
  unsaved?: boolean;
}

const DRAG = 'application/x-orq-lib-item';
const SZ = { size: 15, strokeWidth: 1.5, 'aria-hidden': true } as const;

/**
 * Lista de la biblioteca con carpetas: se pliegan, se crean, se renombran y se quitan; los elementos se mueven
 * arrastrándolos o con «Mover a carpeta…» [R38.13][R38.14]. Con búsqueda, la lista se aplana y dice la carpeta.
 */
export function LibraryList({
  kind,
  rows,
  folders,
  query,
  selected,
  onSelect,
  onFolders,
  creating,
  onCreatingDone,
  label,
}: {
  kind: LibraryKind;
  rows: LibRow[];
  folders: KindFolders;
  query: string;
  selected: string | undefined;
  onSelect: (id: string) => void;
  onFolders: (change: (f: LibraryFolders) => LibraryFolders) => Promise<string | undefined>;
  creating: boolean;
  onCreatingDone: () => void;
  label: string;
}) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<string>();
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] }>();
  const [over, setOver] = useState<string>();
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState<string>();
  const searching = query.trim() !== '';
  const tree = buildFolderTree(rows, folders);

  const change = async (fn: (f: LibraryFolders) => LibraryFolders, ok?: string) => {
    const e = await onFolders(fn);
    setError(e);
    if (!e && ok) setStatus(ok);
    return e;
  };
  const move = (row: LibRow, folder: string) => void change((f) => moveToFolder(f, kind, row.id, folder), t('lib.folder.moved', { name: row.name, folder: folder || t('lib.folder.root') }));
  const moveMenu = (row: LibRow, x: number, y: number) =>
    setMenu({
      x,
      y,
      items: [
        { id: '__root', label: t('lib.folder.root'), icon: <FolderOpen size={16} />, disabled: (folders.items[row.id] ?? '') === '', group: t('lib.folder.moveTo', { name: row.name }), onSelect: () => move(row, '') },
        ...folders.folders.map((p) => ({ id: `f:${p}`, label: p.split('/').join(' › '), icon: <Folder size={16} />, disabled: folders.items[row.id] === p, group: t('lib.folder.moveTo', { name: row.name }), onSelect: () => move(row, p) })),
      ],
    });
  const folderMenu = (node: FolderTreeNode<LibRow>, x: number, y: number) =>
    setMenu({
      x,
      y,
      items: [
        { id: 'rename', label: t('lib.folder.rename'), icon: <Pencil size={16} />, onSelect: () => setRenaming(node.path) },
        { id: 'remove', label: t('lib.folder.remove'), icon: <Trash2 size={16} />, danger: true, onSelect: () => void change((f) => removeFolder(f, kind, node.path), t('lib.folder.remove.hint')) },
      ],
    });
  const dropProps = (path: string) => ({
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setOver(path);
    },
    onDragLeave: () => setOver((o) => (o === path ? undefined : o)),
    onDrop: (e: DragEvent) => {
      const id = e.dataTransfer.getData(DRAG);
      setOver(undefined);
      const row = rows.find((r) => r.id === id);
      if (!row) return;
      e.preventDefault();
      e.stopPropagation();
      if ((folders.items[row.id] ?? '') !== path) move(row, path);
    },
  });

  const item = (row: LibRow, depth: number, where?: string) => (
    <li key={row.id} className="orq-lib2__item" style={{ ['--depth' as string]: depth }}>
      <button
        type="button"
        className="orq-lib__row orq-lib2__row"
        aria-label={row.name}
        aria-current={selected === row.id}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG, row.id);
          e.dataTransfer.effectAllowed = 'move';
        }}
        onClick={() => onSelect(row.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          moveMenu(row, e.clientX, e.clientY);
        }}
      >
        {row.tag}
        <span className="orq-lib__name">
          <span>{row.name}</span>
          {row.description ? <span className="orq-lib2__desc">{row.description}</span> : null}
          <span className="orq-hint">
            {where ? <span className="orq-lib2__where">{where} · </span> : null}
            {row.meta}
          </span>
        </span>
        {row.unsaved && <span className="orq-dot" role="img" aria-label={t('draft.unsaved')} title={t('draft.unsaved')} />}
      </button>
      <button
        type="button"
        className="orq-ib orq-lib2__more"
        aria-label={t('lib.folder.moveTo', { name: row.name })}
        title={t('lib.folder.move')}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          moveMenu(row, r.left, r.bottom);
        }}
      >
        <FolderInput size={14} strokeWidth={1.5} aria-hidden="true" />
      </button>
    </li>
  );

  const folderNode = (node: FolderTreeNode<LibRow>, depth: number): ReactNode => {
    const open = !closed.has(node.path);
    return (
      <li key={`f:${node.path}`} className={`orq-lib2__folder${over === node.path ? ' is-over' : ''}`} {...dropProps(node.path)}>
        {renaming === node.path ? (
          <FolderInputRow
            initial={node.path}
            depth={depth}
            label={t('lib.folder.rename')}
            onDone={(v) => {
              setRenaming(undefined);
              if (v !== undefined && v !== node.path) void change((f) => renameFolder(f, kind, node.path, v));
            }}
          />
        ) : (
          <div className="orq-lib2__fhead" style={{ ['--depth' as string]: depth }}>
            <button
              type="button"
              className="orq-lib2__ftoggle"
              aria-expanded={open}
              aria-label={t('lib.folder.aria', { name: node.name, count: node.total })}
              onClick={() =>
                setClosed((c) => {
                  const n = new Set(c);
                  if (n.has(node.path)) n.delete(node.path);
                  else n.add(node.path);
                  return n;
                })
              }
              onContextMenu={(e) => {
                e.preventDefault();
                folderMenu(node, e.clientX, e.clientY);
              }}
            >
              <ChevronRight size={14} className="orq-lib2__chev" aria-hidden="true" />
              {open ? <FolderOpen {...SZ} /> : <Folder {...SZ} />}
              <span className="orq-lib2__fname">{node.name}</span>
              <em>{node.total}</em>
            </button>
            <button
              type="button"
              className="orq-ib orq-lib2__more"
              aria-label={`${t('lib.folder.rename')} / ${t('lib.folder.remove')}: ${node.name}`}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                folderMenu(node, r.left, r.bottom);
              }}
            >
              <MoreHorizontal size={14} aria-hidden="true" />
            </button>
          </div>
        )}
        {open && (
          <ul className="orq-lib2__tree">
            {node.folders.map((c) => folderNode(c, depth + 1))}
            {node.items.map((r) => item(r, depth + 1))}
            {node.total === 0 && (
              <li className="orq-lib2__fempty" style={{ ['--depth' as string]: depth + 1 }}>
                {t('lib.folder.empty')}
              </li>
            )}
          </ul>
        )}
      </li>
    );
  };

  const norm = (s: string) => s.toLocaleLowerCase('es').normalize('NFD').replace(/\p{M}/gu, '');
  const matches = searching ? rows.filter((r) => norm(`${r.name} ${r.description ?? ''} ${folders.items[r.id] ?? ''}`).includes(norm(query.trim()))) : [];

  return (
    <nav aria-label={label} className={`orq-lib2__nav${over === '' ? ' is-over' : ''}`} {...dropProps('')}>
      {creating && (
        <FolderInputRow
          initial=""
          depth={0}
          label={t('lib.folder.name')}
          onDone={(v) => {
            onCreatingDone();
            if (v) void change((f) => addFolder(f, kind, v));
          }}
        />
      )}
      <ul className="orq-lib__items orq-lib2__tree">
        {searching ? matches.map((r) => item(r, 0, folders.items[r.id]?.split('/').join(' › '))) : [...tree.folders.map((n) => folderNode(n, 0)), ...tree.items.map((r) => item(r, 0))]}
      </ul>
      {error && (
        <p className="orq-field__error" role="alert">
          {error}
        </p>
      )}
      {status && !error && (
        <p className="orq-sr" role="status">
          {status}
        </p>
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(undefined)} />}
    </nav>
  );
}

/** Campo en línea para nombrar una carpeta (Intro guarda, Esc cancela). */
function FolderInputRow({ initial, depth, label, onDone }: { initial: string; depth: number; label: string; onDone: (value: string | undefined) => void }) {
  const [v, setV] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (value: string | undefined) => {
    if (done.current) return;
    done.current = true;
    onDone(value);
  };
  return (
    <div className="orq-lib2__fhead orq-lib2__fedit" style={{ ['--depth' as string]: depth }}>
      <Folder {...SZ} />
      <input
        ref={ref}
        aria-label={label}
        value={v}
        maxLength={130}
        placeholder={t('lib.folder.name')}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => finish(v.trim() || undefined)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            e.preventDefault();
            finish(v.trim() || undefined);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            finish(undefined);
          }
        }}
      />
    </div>
  );
}
