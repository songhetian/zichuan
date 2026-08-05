/**
 * Excel 导出二进制处理工具
 *
 * 背景：Next.js server action 不能可靠地跨边界传输 Node Buffer / Uint8Array。
 * 本项目导入侧已把二进制转成 number[] 传输（见 asset-list-client 的 Array.from(new Uint8Array(...))）；
 * 但导出侧 exportAssetsToExcel 等曾直接返回 Node Buffer，到客户端会变成
 * { type: "Buffer", data: number[] } 这样的普通对象。若直接 new Blob([obj])，
 * 对象会被字符串化成 "[object Object]"，导致生成的 xlsx 文件内容损坏、打开后空白或显示 [object Object]。
 *
 * 这里把三种可能的形态统一转换为 Uint8Array，并封装下载流程。
 */

export function bufferToBytes(raw: unknown): Uint8Array {
  if (raw instanceof Uint8Array) {
    return raw;
  }
  if (raw instanceof ArrayBuffer) {
    return new Uint8Array(raw);
  }
  if (Array.isArray(raw)) {
    return new Uint8Array(raw);
  }
  if (
    raw &&
    typeof raw === "object" &&
    (raw as { type?: unknown }).type === "Buffer" &&
    Array.isArray((raw as { data?: unknown }).data)
  ) {
    return new Uint8Array((raw as { data: number[] }).data);
  }
  throw new Error("bufferToBytes: 无法识别的二进制格式");
}

/**
 * 将 server action 返回的二进制（number[] / Uint8Array / {type:'Buffer',data}）封装为
 * xlsx Blob 并触发浏览器下载。替代原先直接 new Blob([result.data.buffer]) 的错误写法。
 */
export function downloadExcelFile(fileName: string, raw: unknown): void {
  const bytes = bufferToBytes(raw);
  const blob = new Blob([bytes as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
