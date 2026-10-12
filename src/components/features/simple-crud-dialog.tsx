"use client";

import { useState, useEffect, type ComponentType } from "react";
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

export type FieldType = "text" | "password" | "select" | "searchSelect";

export interface FieldConfig {
  key: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  searchPlaceholder?: string;
  options?: { value: string; label: string; description?: string }[];
  optional?: boolean;
  hint?: string;
}

/** 字段渲染器入参：弹窗注入「当前值 + 变更回调」，渲染器无需感知表单状态存放位置 */
interface FieldRendererProps {
  id: string;
  field: FieldConfig;
  value: string;
  onChange: (value: string) => void;
}

type FieldRenderer = ComponentType<FieldRendererProps>;

/**
 * 字段类型 → 渲染器注册表。新增字段类型只需在此登记一项，
 * 无需改动弹窗的渲染逻辑（取代原先的类型联合 + 嵌套三元）。
 */
const FIELD_RENDERERS: Record<FieldType, FieldRenderer> = {
  text: ({ id, field, value, onChange }) => (
    <Input
      id={id}
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={field.placeholder}
    />
  ),
  password: ({ id, field, value, onChange }) => (
    <Input
      id={id}
      type="password"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={field.placeholder}
    />
  ),
  select: ({ id, field, value, onChange }) => (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id}>
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
  ),
  searchSelect: ({ id, field, value, onChange }) => (
    <SearchableSelect
      id={id}
      options={field.options ?? []}
      value={value}
      onValueChange={onChange}
      placeholder={field.placeholder}
      searchPlaceholder={field.searchPlaceholder}
      className="w-full"
    />
  ),
};

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
      {/* 共享弹窗无副标题：显式关闭 Radix 可访问描述告警（改用时补 DialogDescription 即可） */}
      <DialogContent className="max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {fields.map((field) => {
            const fieldId = `crud-field-${field.key}`
            const FieldRenderer = FIELD_RENDERERS[field.type]
            return (
            <div key={field.key} className="space-y-2">
              <Label htmlFor={fieldId}>{field.label}{field.optional ? "（可选）" : ""}</Label>
              <FieldRenderer
                id={fieldId}
                field={field}
                value={values[field.key] || ""}
                onChange={(v) => handleChange(field.key, v)}
              />
              {field.hint && <p className="text-xs text-muted-foreground">{field.hint}</p>}
            </div>
            )
          })}
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