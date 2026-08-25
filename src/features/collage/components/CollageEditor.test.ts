import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorLayer, TemplateDocument } from '@/core/templates';
import type { EditorCanvasController } from '@/editor/fabric/canvas';

const reactState = vi.hoisted(() => ({
  refs: [] as Array<{ current: unknown }>,
  index: 0,
}));

const canvasState = vi.hoisted(() => ({
  createEditorCanvas: vi.fn(),
}));

vi.mock('react', () => ({
  forwardRef: (render: unknown) => render,
  useRef: (initialValue: unknown) => {
    const index = reactState.index++;
    const existing = reactState.refs[index];
    if (existing) return existing;
    const created = { current: initialValue };
    reactState.refs[index] = created;
    return created;
  },
  useImperativeHandle: (
    ref: { current: unknown },
    createHandle: () => unknown,
  ) => {
    ref.current = createHandle();
  },
  useEffect: () => undefined,
}));

vi.mock('@/editor/fabric/canvas', () => ({
  createEditorCanvas: canvasState.createEditorCanvas,
}));

vi.mock('@/editor/fabric/export', () => ({ downloadBlob: vi.fn() }));

import {
  CollageEditor,
  type CollageEditorHandle,
} from './CollageEditor';

interface EditorProps {
  workspaceId: string;
  onDocumentChange?(doc: TemplateDocument): void;
}

function document(id: string, x: number): TemplateDocument {
  return {
    id,
    name: id,
    width: 100,
    height: 100,
    layers: [
      { type: 'shape', id: `${id}-shape`, x, y: 0, width: 20, height: 20 },
    ],
  };
}

function controller(): EditorCanvasController {
  return {
    replaceSlotImage: vi.fn(async () => undefined),
    getDocument: vi.fn(() => []),
    exportPNG: vi.fn(async () => new Blob()),
    dispose: vi.fn(),
  };
}

function renderEditor(
  props: EditorProps,
  ref: { current: CollageEditorHandle | null },
): void {
  reactState.index = 0;
  const render = CollageEditor as unknown as (
    currentProps: EditorProps,
    currentRef: { current: CollageEditorHandle | null },
  ) => unknown;
  render(props, ref);
}

function attachHost(): void {
  reactState.refs[0].current = { innerHTML: '', style: {} };
}

beforeEach(() => {
  reactState.refs.length = 0;
  reactState.index = 0;
  canvasState.createEditorCanvas.mockReset();
});

describe('CollageEditor 异步回调归属', () => {
  it('旧布局回调不能覆盖当前方案', async () => {
    const callbacks: Array<(layers: EditorLayer[]) => void> = [];
    canvasState.createEditorCanvas.mockImplementation(
      async (...args: unknown[]) => {
        callbacks.push(args[3] as (layers: EditorLayer[]) => void);
        return controller();
      },
    );
    const onDocumentChange = vi.fn();
    const ref = { current: null as CollageEditorHandle | null };
    renderEditor({ workspaceId: 'workspace-a', onDocumentChange }, ref);
    attachHost();
    const oldDocument = document('old-layout', 1);
    const currentDocument = document('current-layout', 2);

    await ref.current?.createLayout(oldDocument);
    await ref.current?.createLayout(currentDocument);
    const staleLayers = document('stale-edit', 99).layers;
    callbacks[0](staleLayers);

    expect(onDocumentChange).not.toHaveBeenCalled();
    expect(reactState.refs[2].current).toEqual(currentDocument);

    const currentLayers = document('current-edit', 3).layers;
    callbacks[1](currentLayers);
    expect(onDocumentChange).toHaveBeenCalledWith({
      ...currentDocument,
      layers: currentLayers,
    });
  });

  it('旧 Workspace 回调不能写入另一个商品状态', async () => {
    const callbacks: Array<(layers: EditorLayer[]) => void> = [];
    canvasState.createEditorCanvas.mockImplementation(
      async (...args: unknown[]) => {
        callbacks.push(args[3] as (layers: EditorLayer[]) => void);
        return controller();
      },
    );
    const workspaceAChange = vi.fn();
    const workspaceBChange = vi.fn();
    const ref = { current: null as CollageEditorHandle | null };
    renderEditor(
      { workspaceId: 'workspace-a', onDocumentChange: workspaceAChange },
      ref,
    );
    attachHost();
    const workspaceADocument = document('workspace-a-layout', 1);
    await ref.current?.createLayout(workspaceADocument);

    renderEditor(
      { workspaceId: 'workspace-b', onDocumentChange: workspaceBChange },
      ref,
    );
    callbacks[0](document('workspace-a-late-edit', 99).layers);

    expect(workspaceAChange).not.toHaveBeenCalled();
    expect(workspaceBChange).not.toHaveBeenCalled();
    expect(reactState.refs[2].current).toEqual(workspaceADocument);
  });
});
