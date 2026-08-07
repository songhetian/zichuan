"use client";

import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";

interface ListSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

// 列表页通用搜索输入框：左侧搜索图标 + 文本输入 + 有内容时显示清除按钮。
// 与 DataTable 内置搜索框风格一致，便于各列表页统一复用。
export function ListSearchInput({ value, onChange, placeholder = "搜索..." }: ListSearchInputProps) {
  return (
    <div className="relative max-w-sm w-full">
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="pl-8 pr-8"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="清除搜索"
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-muted transition-colors"
        >
          <X className="h-4 w-4 text-muted-foreground" />
        </button>
      )}
    </div>
  );
}
