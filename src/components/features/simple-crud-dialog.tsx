"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useToast } from "@/hooks/use-toast";

export interface FieldConfig {
  key: string;
  label: string;
  type: "text" | "password" | "select" | "searchSelect";
  placeholder?: string;
  searchPlaceholder?: string;
  options?: { value: string; label: string; description?: string }[];
  optional?: boolean;
  hint?: string;
}

interface SimpleCrudDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  title: string;
  fields: FieldConfig[];
  initialValues?: Record<string, string>;
  onSubmit: (values: Record<string, string>) => Promise<{ success: boolean; error?: string }>;
}

export function SimpleCrudDialog({
  open,
  onOpenChange,
  mode,
  title,
  fields,
  initialValues = {},
  onSubmit,
}: SimpleCrudDialogProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      setValues({ ...initialValues });
    }
    // 注意：initialValues 每次渲染都是新对象引用，绝不能放进依赖数组，
    // 否则打字 → setState → 重渲染 → effect 重跑 → setValues 新对象 → 无限循环，输入被重置。
    // 只在弹窗打开时初始化一次即可。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleOpenChange = (v: boolean) => {
    if (!v) {
      setValues({});
    }
    onOpenChange(v);
  };

  const handleChange = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const isValid = () => {
    return fields.every((f) => f.optional || (values[f.key] && values[f.key].trim()));
  };

  const handleSubmit = async () => {
    if (!isValid()) return;
    setLoading(true);
    try {
      const result = await onSubmit(values);
      if (result.success) {
        toast({ title: mode === "create" ? "创建成功" : "更新成功" });
        handleOpenChange(false);
        setValues({});
      } else {
        toast({
          title: mode === "create" ? "创建失败" : "更新失败",
          description: result.error,
          variant: "destructive",
        });
      }
    } catch {
      toast({ title: "操作失败", description: "操作异常，请稍后重试", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {fields.map((field) => (
            <div key={field.key} className="space-y-2">
              <Label>{field.label}{field.optional ? "（可选）" : ""}</Label>
              {field.type === "select" || field.type === "searchSelect" ? (
                field.type === "searchSelect" ? (
                  <SearchableSelect
                    options={field.options ?? []}
                    value={values[field.key] || ""}
                    onValueChange={(v) => handleChange(field.key, v)}
                    placeholder={field.placeholder}
                    searchPlaceholder={field.searchPlaceholder}
                    className="w-full"
                  />
                ) : (
                  <Select value={values[field.key] || ""} onValueChange={(v) => handleChange(field.key, v)}>
                    <SelectTrigger>
                      <SelectValue placeholder={field.placeholder} />
                    </SelectTrigger>
                    <SelectContent>
                      {field.options?.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )
              ) : (
                <Input
                  type={field.type === "password" ? "password" : "text"}
                  value={values[field.key] || ""}
                  onChange={(e) => handleChange(field.key, e.target.value)}
                  placeholder={field.placeholder}
                />
              )}
              {field.hint && <p className="text-xs text-muted-foreground">{field.hint}</p>}
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>取消</Button>
          <Button onClick={handleSubmit} disabled={loading || !isValid()}>
            {loading ? (mode === "create" ? "创建中..." : "更新中...") : "确认"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}