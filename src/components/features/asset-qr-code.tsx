"use client";

import { QRCodeSVG } from "qrcode.react";

/** 资产二维码标签：以资产编号编码二维码，并显式展示编号文本便于人工比对。 */
export function AssetQrCode({
  assetNo,
  size = 160,
  label = true,
}: {
  assetNo: string;
  size?: number;
  label?: boolean;
}) {
  return (
    <div data-testid="asset-qr" className="flex flex-col items-center gap-2">
      <QRCodeSVG value={assetNo} size={size} marginSize={0} />
      {label && (
        <span className="text-center font-mono text-xs tracking-wider text-muted-foreground">
          {assetNo}
        </span>
      )}
    </div>
  );
}