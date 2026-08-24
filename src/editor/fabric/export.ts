/**
 * 画布导出（浏览器端，Fabric 同步 toDataURL → Blob）。
 */

export async function exportPNG(canvas: unknown, scale = 2): Promise<Blob> {
  const dataUrl = (canvas as { toDataURL(options: Record<string, unknown>): string }).toDataURL({
    format: 'png',
    multiplier: scale,
  });
  const res = await fetch(dataUrl);
  return res.blob();
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
