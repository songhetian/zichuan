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
import { useToast } from "@/hooks/use-toast";

export interface FieldConfig {
  key: string;
  label: string;
  type: "text" | "select";
  placeholder?: string;
  options?: { value: string; label: string }[];
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
  }, [open, initialValues]);

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
    const result = await onSubmit(values);
    setLoading(false);
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
              {field.type === "text" ? (
                <Input
                  value={values[field.key] || ""}
                  onChange={(e) => handleChange(field.key, e.target.value)}
                  placeholder={field.placeholder}
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