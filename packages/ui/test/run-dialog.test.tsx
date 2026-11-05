// @vitest-environment jsdom
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RunDialog } from '../src/RunDialog';
import { createMemoryApi } from '../src/memoryApi';

const file = (name: string, bytes = 3, type = 'image/png') => {
  const f = new File([new Uint8Array(bytes)], name, { type });
  // jsdom no implementa arrayBuffer en File.
  Object.defineProperty(f, 'arrayBuffer', { value: async () => new Uint8Array(bytes).buffer });
  return f;
};

function open(o: Partial<Parameters<typeof RunDialog>[0]> = {}, api = createMemoryApi([], { attachPick: [{ name: 'briefing.pdf', size: 1_258_291 }], projectPick: [{ path: 'docs/estilo.md', size: 3000 }] })) {
  const onStart = vi.fn();
  const onClose = vi.fn();
  render(<RunDialog diagramName="Generador" engine="claude" runnable onEngine={vi.fn()} onStart={onStart} onClose={onClose} deliverable={{ items: [{ kind: 'links' }, { kind: 'summary' }] }} finals={['QA']} onSaveDeliverable={vi.fn()} api={api} {...o} />);
  return { onStart, onClose, api, d: within(screen.getByRole('dialog', { name: 'Ejecutar «Generador»' })) };
}

describe('SPEC-048 · diálogo «Ejecutar» como modal', () => {
  it('[R48.1] es un modal centrado con cabecera, pestañas, cuerpo con scroll y pie fijos; Esc, «Cerrar» y pulsar fuera lo cierran', async () => {
    const { d, onClose } = open();
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('orq-rundlg--modal');
    expect(dialog.parentElement!.className).not.toContain('orq-modal--top');
    expect(dialog.querySelector('header.orq-rundlg__head')).toBeTruthy();
    expect(dialog.querySelector('.orq-rundlg__body[role="tabpanel"]')).toBeTruthy();
    expect(dialog.querySelector('footer.orq-rundlg__foot button.orq-btn--primary')!.textContent).toMatch(/Ejecutar/);
    expect(d.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Ejecución', 'Entregable enlaces + resumen .md']);
    await userEvent.click(d.getByRole('button', { name: 'Cerrar' }));
    fireEvent.keyDown(dialog, { key: 'Escape' });
    fireEvent.pointerDown(dialog.parentElement!);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('[R48.2] «Ejecución» tiene la Entrada, el motor y el presupuesto; «Entregable», su panel y «Guardar en el diagrama»', async () => {
    const { d } = open();
    expect(d.getByLabelText('Entrada')).toBeTruthy();
    expect(d.getByLabelText('Presupuesto (tokens)')).toBeTruthy();
    expect(d.queryByRole('group', { name: 'Qué quieres al final' })).toBeNull();
    await userEvent.click(d.getByRole('tab', { name: /Entregable/ }));
    expect(d.getByRole('tab', { name: /Entregable/ }).getAttribute('aria-selected')).toBe('true');
    expect(d.getByRole('group', { name: 'Qué quieres al final' })).toBeTruthy();
    expect(d.getByRole('button', { name: 'Guardar en el diagrama' })).toBeTruthy();
    expect(d.queryByLabelText('Entrada')).toBeNull();
    // Lo cambiado en el entregable se ve en la pestaña.
    await userEvent.click(d.getByRole('checkbox', { name: /Resumen en Markdown/ }));
    expect(d.getByRole('tab', { name: /Entregable/ }).textContent).toBe('Entregable enlaces');
    // Lo escrito en la Entrada se conserva al volver.
    await userEvent.click(d.getByRole('tab', { name: 'Ejecución' }));
    await userEvent.type(d.getByLabelText('Entrada'), 'hola');
    await userEvent.click(d.getByRole('tab', { name: /Entregable/ }));
    await userEvent.click(d.getByRole('tab', { name: 'Ejecución' }));
    expect((d.getByLabelText('Entrada') as HTMLTextAreaElement).value).toBe('hola');
  });

  it('[R48.3] «Adjuntar», «Del proyecto…», arrastrar y pegar añaden fichas que se pueden quitar; se ejecuta solo con archivos', async () => {
    const { d, onStart } = open();
    const run = () => d.getByRole('button', { name: 'Ejecutar' }) as HTMLButtonElement;
    expect(run().disabled).toBe(true);
    await userEvent.click(d.getByRole('button', { name: 'Adjuntar' }));
    await userEvent.click(d.getByRole('button', { name: 'Del proyecto…' }));
    const zone = d.getByLabelText('Entrada').closest('.orq-rundlg__input')!;
    fireEvent.drop(zone, { dataTransfer: { files: [file('boceto.png')], types: ['Files'] } });
    fireEvent.paste(d.getByLabelText('Entrada'), { clipboardData: { files: [file('captura.png')] } });
    const list = within(await d.findByRole('list', { name: 'Archivos de la entrada' }));
    await waitFor(() => expect(list.getAllByRole('listitem')).toHaveLength(4));
    expect(list.getByText('briefing.pdf')).toBeTruthy();
    expect(list.getByText('1,2 MB')).toBeTruthy();
    expect(list.getByText('del proyecto · 3 KB')).toBeTruthy();
    expect(list.getByText('boceto.png')).toBeTruthy();
    await userEvent.click(list.getByRole('button', { name: 'Quitar «captura.png»' }));
    expect(list.getAllByRole('listitem')).toHaveLength(3);
    expect(d.getByText('3 archivo(s) en la entrada')).toBeTruthy();
    expect(run().disabled).toBe(false);
    await userEvent.click(run());
    expect(onStart).toHaveBeenCalledWith('', undefined, undefined, { attachments: ['att-1', 'att-2'], files: ['docs/estilo.md'] });
  });

  it('[R48.3] un archivo de más de 20 MB se rechaza con un aviso', async () => {
    const { d } = open();
    fireEvent.drop(d.getByLabelText('Entrada').closest('.orq-rundlg__input')!, { dataTransfer: { files: [file('video.mp4', 20 * 1024 * 1024 + 1)], types: ['Files'] } });
    expect((await d.findByRole('alert')).textContent).toBe('«video.mp4» supera los 20 MB.');
    expect(d.queryByRole('list', { name: 'Archivos de la entrada' })).toBeNull();
  });

  it('[R48.3] sin api no se ofrecen adjuntos y se ejecuta como antes', async () => {
    const onStart = vi.fn();
    render(<RunDialog diagramName="Generador" engine="simulated" runnable onEngine={vi.fn()} onStart={onStart} onClose={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Adjuntar' })).toBeNull();
    await userEvent.type(screen.getByLabelText('Entrada'), 'hola');
    await userEvent.click(screen.getByRole('button', { name: 'Ejecutar' }));
    expect(onStart).toHaveBeenCalledWith('hola', undefined);
  });
});
