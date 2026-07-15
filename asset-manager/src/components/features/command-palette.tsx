"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Monitor,
  Users,
  LayoutGrid,
  Cpu,
  ClipboardCheck,
  BarChart3,
  Settings,
  FileText,
  Plus,
  Download,
  Upload,
  Search,
} from "lucide-react";
import { globalSearch } from "@/actions/search.actions";

interface SearchResult {
  id: number;
  type: "asset" | "employee" | "template" | "component";
  title: string;
  subtitle: string;
  href: string;
}

const typeLabels: Record<string, string> = {
  asset: "设备",
  employee: "员工",
  template: "模板",
  component: "配件",
};

const typeIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  asset: Monitor,
  employee: Users,
  template: LayoutGrid,
  component: Cpu,
};

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const router = useRouter();

  // 监听 Ctrl+K 快捷键
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };

    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  // 搜索处理
  const handleSearch = useCallback(async (value: string) => {
    if (!value.trim()) {
      setSearchResults([]);
      return;
    }

    setSearching(true);
    try {
      const result = await globalSearch({ keyword: value, limit: 5 });
      if (result.success) {
        setSearchResults(result.data);
      } else {
        setSearchResults([]);
      }
    } catch (error) {
      console.error("搜索失败:", error);
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  // 导航处理
  const handleNavigate = (href: string) => {
    router.push(href);
    setOpen(false);
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        placeholder="搜索设备、员工、模板..."
        onValueChange={handleSearch}
      />
      <CommandList>
        {searching && (
          <CommandEmpty>搜索中...</CommandEmpty>
        )}
        {!searching && searchResults.length === 0 && (
          <CommandEmpty>未找到结果</CommandEmpty>
        )}
        {!searching && searchResults.length > 0 && (
          <CommandGroup heading="搜索结果">
            {searchResults.map((result) => {
              const Icon = typeIcons[result.type] || Search;
              return (
                <CommandItem
                  key={`${result.type}-${result.id}`}
                  onSelect={() => handleNavigate(result.href)}
                  className="flex items-center gap-2"
                >
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <div className="flex-1">
                    <div className="font-medium">{result.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {result.subtitle}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {typeLabels[result.type]}
                  </div>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}
        <CommandSeparator />
        <CommandGroup heading="快速导航">
          <CommandItem onSelect={() => handleNavigate("/dashboard")}>
            <BarChart3 className="mr-2 h-4 w-4" />
            仪表盘
          </CommandItem>
          <CommandItem onSelect={() => handleNavigate("/assets")}>
            <Monitor className="mr-2 h-4 w-4" />
            设备管理
          </CommandItem>
          <CommandItem onSelect={() => handleNavigate("/employees")}>
            <Users className="mr-2 h-4 w-4" />
            员工管理
          </CommandItem>
          <CommandItem onSelect={() => handleNavigate("/templates")}>
            <LayoutGrid className="mr-2 h-4 w-4" />
            设备模板
          </CommandItem>
          <CommandItem onSelect={() => handleNavigate("/components/models")}>
            <Cpu className="mr-2 h-4 w-4" />
            配件型号
          </CommandItem>
          <CommandItem onSelect={() => handleNavigate("/stocktake")}>
            <ClipboardCheck className="mr-2 h-4 w-4" />
            库存盘点
          </CommandItem>
          <CommandItem onSelect={() => handleNavigate("/stats")}>
            <BarChart3 className="mr-2 h-4 w-4" />
            统计报表
          </CommandItem>
          <CommandItem onSelect={() => handleNavigate("/logs")}>
            <FileText className="mr-2 h-4 w-4" />
            系统日志
          </CommandItem>
          <CommandItem onSelect={() => handleNavigate("/settings")}>
            <Settings className="mr-2 h-4 w-4" />
            系统设置
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="快捷操作">
          <CommandItem onSelect={() => handleNavigate("/assets?create=true")}>
            <Plus className="mr-2 h-4 w-4" />
            新建设备
          </CommandItem>
          <CommandItem onSelect={() => handleNavigate("/employees?create=true")}>
            <Plus className="mr-2 h-4 w-4" />
            新建员工
          </CommandItem>
          <CommandItem onSelect={() => handleNavigate("/templates?create=true")}>
            <Plus className="mr-2 h-4 w-4" />
            新建模板
          </CommandItem>
          <CommandItem onSelect={() => handleNavigate("/assets?export=true")}>
            <Download className="mr-2 h-4 w-4" />
            导出设备
          </CommandItem>
          <CommandItem onSelect={() => handleNavigate("/assets?import=true")}>
            <Upload className="mr-2 h-4 w-4" />
            导入设备
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
