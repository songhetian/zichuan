"use client"

import { useState, useCallback } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { AlertTriangle, Info } from "lucide-react"

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmText?: string
  cancelText?: string
  variant?: "default" | "destructive"
  /** 是否显示加载状态；不传则由组件内部管理 */
  loading?: boolean
  /** 确认回调，支持同步或异步函数 */
  onConfirm: () => void | Promise<void>
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText = "确认",
  cancelText = "取消",
  variant = "default",
  loading: loadingProp,
  onConfirm,
}: ConfirmDialogProps) {
  const [internalLoading, setInternalLoading] = useState(false)
  const isLoading = loadingProp ?? internalLoading

  const handleConfirm = useCallback(async () => {
    if (isLoading) return

    try {
      setInternalLoading(true)
      await onConfirm()
    } finally {
      setInternalLoading(false)
    }
  }, [isLoading, onConfirm])

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!isLoading) onOpenChange(value) }}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center gap-3">
            {variant === "destructive" ? (
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10">
                <AlertTriangle className="h-5 w-5 text-destructive" />
              </div>
            ) : (
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <Info className="h-5 w-5 text-primary" />
              </div>
            )}
            <div>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription className="mt-1">{description}</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
            {cancelText}
          </Button>
          <Button variant={variant} onClick={handleConfirm} disabled={isLoading}>
            {isLoading ? "处理中..." : confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
