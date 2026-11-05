"use client";

import { useMemo, useRef, useState } from "react";
import { Camera, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  deleteAssetPhoto,
  uploadAssetPhoto,
} from "@/actions/asset-photo.actions";

interface PhotoItem {
  key: string;
  url: string;
}

interface AssetPhotosProps {
  assetId: number;
  /** 服务端返回的照片（签名 URL，过期后刷新页面即得新 URL） */
  photos: PhotoItem[];
  /** 设备分类名：无照片时用于挑选类型默认图 */
  categoryName: string;
}

const MAX_PHOTOS = 6;

/** 按分类挑默认占位图（照片为空时展示） */
function defaultImageFor(categoryName: string): string {
  if (categoryName.includes("笔记本")) return "/asset-defaults/laptop.svg";
  if (categoryName.includes("显示器")) return "/asset-defaults/monitor.svg";
  if (categoryName.includes("台式机")) return "/asset-defaults/desktop.svg";
  return "/asset-defaults/generic.svg";
}

/**
 * 资产现场照片墙（可选增强）：
 * - 无照片时展示分类默认图；上传/删除需「资产管理」权限（服务端校验）；
 * - 点击缩略图弹窗预览，预览内可删除；手机浏览器上传会直接调起相机/相册。
 */
export function AssetPhotos({ assetId, photos: initialPhotos, categoryName }: AssetPhotosProps) {
  const [photos, setPhotos] = useState<PhotoItem[]>(initialPhotos);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<PhotoItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const defaultImage = useMemo(() => defaultImageFor(categoryName), [categoryName]);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // 允许重复选择同一文件
    if (!file) return;

    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await uploadAssetPhoto(assetId, fd);
      if (!res.success) {
        toast({ variant: "destructive", title: "上传失败", description: res.error });
        return;
      }
      if (!res.data) return;
      setPhotos(res.data.photos);
      toast({ variant: "success", title: "照片已上传" });
    } catch {
      toast({ variant: "destructive", title: "上传失败", description: "网络异常，请稍后重试" });
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete() {
    if (!preview) return;
    setDeleting(true);
    try {
      const res = await deleteAssetPhoto(assetId, preview.key);
      if (!res.success) {
        toast({ variant: "destructive", title: "删除失败", description: res.error });
        return;
      }
      if (!res.data) return;
      setPhotos(res.data.photos);
      setPreview(null);
      toast({ variant: "success", title: "照片已删除" });
    } catch {
      toast({ variant: "destructive", title: "删除失败", description: "网络异常，请稍后重试" });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">
          可选。用于现场对照与交接留证（JPG / PNG / WebP，≤5MB，最多 {MAX_PHOTOS} 张）
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => inputRef.current?.click()}
          disabled={uploading || photos.length >= MAX_PHOTOS}
        >
          <Camera className="h-4 w-4" aria-hidden />
          {uploading ? "上传中…" : "上传照片"}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={handleFileChange}
          aria-label="选择设备照片"
        />
      </div>

      {photos.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border/80 py-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={defaultImage} alt="" className="h-28 opacity-70" aria-hidden />
          <p className="text-muted-foreground text-xs">暂无现场照片，显示默认图</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {photos.map((p, i) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPreview(p)}
              className="focus-visible:ring-ring overflow-hidden rounded-lg border border-border/80 transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2"
              aria-label={`查看第 ${i + 1} 张照片`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={`设备照片 ${i + 1}`} className="h-28 w-full object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      )}

      <Dialog open={preview !== null} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="sm:max-w-xl" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>现场照片</DialogTitle>
            <DialogDescription>可放大查看细节，也可删除后重新上传。</DialogDescription>
          </DialogHeader>
          {preview && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={preview.url}
              alt="设备现场照片"
              className="max-h-[60vh] w-full rounded-lg object-contain"
            />
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              <Trash2 className="h-4 w-4" aria-hidden />
              {deleting ? "删除中…" : "删除照片"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
