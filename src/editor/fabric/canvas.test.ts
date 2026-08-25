import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TemplateDocument } from '@/core/templates';

interface FakeCanvasState {
  handlers: Map<string, () => void>;
  remove: ReturnType<typeof vi.fn>;
  insertAt: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}

const fabricState = vi.hoisted(() => ({
  instances: [] as unknown[],
  fromURL: vi.fn(),
}));

vi.mock('@fabricjs/browser', () => {
  class Canvas {
    objects: unknown[] = [];
    handlers = new Map<string, () => void>();
    remove = vi.fn((object: unknown) => {
      this.objects = this.objects.filter((item) => item !== object);
    });
    insertAt = vi.fn((index: number, object: unknown) => {
      this.objects.splice(index, 0, object);
    });
    dispose = vi.fn(async () => undefined);

    constructor() {
      fabricState.instances.push(this);
    }

    setDimensions() {}
    add(object: unknown) {
      this.objects.push(object);
    }
    requestRenderAll() {}
    getObjects() {
      return this.objects;
    }
    on(event: string, callback: () => void) {
      this.handlers.set(event, callback);
    }
  }

  class Rect {
    constructor(properties: Record<string, unknown>) {
      Object.assign(this, properties);
    }
  }

  return {
    Canvas,
    Rect,
    FabricImage: { fromURL: fabricState.fromURL },
  };
});

import { createEditorCanvas } from './canvas';

const EMPTY_DOCUMENT: TemplateDocument = {
  id: 'empty',
  name: '空画布',
  width: 100,
  height: 100,
  layers: [],
};

function fakeContainer(): HTMLElement {
  return { appendChild: vi.fn() } as unknown as HTMLElement;
}

beforeEach(() => {
  fabricState.instances.length = 0;
  fabricState.fromURL.mockReset();
  vi.stubGlobal('document', { createElement: vi.fn(() => ({})) });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Fabric disposed 控制器', () => {
  it('dispose 后不再发出文档变更', async () => {
    const onDocumentChange = vi.fn();
    const controller = await createEditorCanvas(
      fakeContainer(),
      EMPTY_DOCUMENT,
      () => '',
      onDocumentChange,
    );
    const canvas = fabricState.instances[0] as FakeCanvasState;

    canvas.handlers.get('object:modified')?.();
    expect(onDocumentChange).toHaveBeenCalledTimes(1);

    controller.dispose();
    canvas.handlers.get('object:modified')?.();
    canvas.handlers.get('text:changed')?.();

    expect(onDocumentChange).toHaveBeenCalledTimes(1);
    expect(canvas.dispose).toHaveBeenCalledTimes(1);
  });

  it('异步换图完成前 dispose，不得再修改画布或发出变更', async () => {
    const imageDocument: TemplateDocument = {
      ...EMPTY_DOCUMENT,
      id: 'image-doc',
      layers: [
        {
          type: 'image',
          id: 'slot-1',
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          fit: 'cover',
          slotIndex: 0,
          assetId: null,
        },
      ],
    };
    let resolveImage: ((image: unknown) => void) | undefined;
    fabricState.fromURL.mockReturnValue(
      new Promise((resolve) => {
        resolveImage = resolve;
      }),
    );
    const onDocumentChange = vi.fn();
    const controller = await createEditorCanvas(
      fakeContainer(),
      imageDocument,
      () => '',
      onDocumentChange,
    );
    const canvas = fabricState.instances[0] as FakeCanvasState;

    const replacement = controller.replaceSlotImage('slot-1', '/replacement.png', 'asset-2');
    controller.dispose();
    resolveImage?.({ width: 100, height: 100, set: vi.fn() });
    await replacement;

    expect(canvas.remove).not.toHaveBeenCalled();
    expect(canvas.insertAt).not.toHaveBeenCalled();
    expect(onDocumentChange).not.toHaveBeenCalled();
  });
});
