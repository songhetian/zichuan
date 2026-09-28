import { getQrAsset } from "@/actions/qr.actions";
import { AssetQrCode } from "@/components/features/asset-qr-code";
import { getStatusLabel } from "@/lib/status-labels";

/**
 * 二维码手机瘦身页（扫码盘点）：`/qr?assetNo=xxx`
 * 移动端打开即得资产概要 + 二维码标签，用于扫码核对与盘点。无参数时让用户输入编号。
 */
export default async function QrPage({
  searchParams,
}: {
  searchParams: { assetNo?: string };
}) {
  const assetNo = searchParams.assetNo ?? "";

  let asset: {
    assetNo: string;
    name: string;
    status: string;
    employeeName: string;
    departmentName: string;
    location: string | null;
  } | null = null;
  let error = "";

  if (assetNo) {
    const result = await getQrAsset(assetNo);
    if (result.success) {
      asset = result.data;
    } else {
      error = result.error;
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-5 bg-background p-6 pt-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold tracking-tight">资产盘点</h1>
        <p className="text-sm text-muted-foreground">扫描资产二维码，快速核对资产信息</p>
      </header>

      <form action="/qr" method="get" className="flex items-center gap-2">
        <input
          type="text"
          name="assetNo"
          defaultValue={assetNo}
          placeholder="输入资产编号"
          className="w-full flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
        />
        <button
          type="submit"
          className="shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          查询
        </button>
      </form>

      {error && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {asset && (
        <section className="flex flex-col gap-4">
          <div className="rounded-xl border p-6">
            <AssetQrCode assetNo={asset.assetNo} size={180} />
          </div>

          <dl className="divide-y divide-border rounded-xl border text-sm">
            <Row label="编号" value={asset.assetNo} mono />
            <Row label="名称" value={asset.name} />
            <Row label="状态" value={getStatusLabel(asset.status)} />
            <Row label="使用人" value={asset.employeeName || "—"} />
            <Row label="部门" value={asset.departmentName || "—"} />
            <Row label="位置" value={asset.location || "—"} />
          </dl>
        </section>
      )}
    </main>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`text-foreground ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}