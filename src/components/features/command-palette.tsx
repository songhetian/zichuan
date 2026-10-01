"use client";

import { useEffect, useState, useCallback, useRef } from "react";
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
import { Button } from "@/components/ui/button";
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

/** 结果分组展示顺序（与 globalSearch 返回的四类一致） */
const SEARCH_TYPES = ["asset", "employee", "template", "component"] as const;

/** 每类最多展示条数（globalSearch 的 limit 为「每类」上限） */
const PER_TYPE_LIMIT = 10;

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const router = useRouter();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqIdRef = useRef(0);

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

  // 卸载时清理未触发的防抖定时器
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // 搜索处理（防抖 250ms + 丢弃过期响应，避免慢请求覆盖新结果）
  const handleSearch = useCallback((value: string) => {
    setQuery(value);

    if (timerRef.current) clearTimeout(timerRef.current);

    if (!value.trim()) {
      reqIdRef.current += 1;
      setSearchResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    timerRef.current = setTimeout(async () => {
      const reqId = ++reqIdRef.current;
      try {
        const result = await globalSearch({ keyword: value, limit: PER_TYPE_LIMIT });
        if (reqId !== reqIdRef.current) return;
        setSearchResults(result.success ? result.data : []);
      } catch {
        if (reqId === reqIdRef.current) setSearchResults([]);
      } finally {
        if (reqId === reqIdRef.current) setSearching(false);
      }
    }, 250);
  }, []);

  // 导航处理
  const handleNavigate = (href: string) => {
    router.push(href);
    setOpen(false);
  };

  // 打开/关闭：关闭时重置，下次打开回到「快速导航」初始态
  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      if (timerRef.current) clearTimeout(timerRef.current);
      reqIdRef.current += 1;
      setQuery("");
      setSearchResults([]);
      setSearching(false);
    }
  };

  const hasQuery = query.trim().length > 0;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 gap-2 text-muted-foreground"
        onClick={() => setOpen(true)}
        aria-label="打开搜索"
      >
        <Search className="h-4 w-4" />
        <span className="hidden lg:inline">搜索...</span>
        <kbd className="hidden rounded border border-border bg-muted px-1 text-[10px] font-medium text-muted-foreground lg:inline">Ctrl K</kbd>
      </Button>
      <CommandDialog open={open} onOpenChange={handleOpenChange} shouldFilter={false}>
        <CommandInput
          value={query}
          placeholder="搜索设备、员工、模板、配件..."
          aria-label="搜索设备、员工、模板、配件"
          onValueChange={handleSearch}
        />
        <CommandList>
          {hasQuery ? (
            <>
              {searching && <CommandEmpty>搜索中...</CommandEmpty>}
              {!searching && searchResults.length === 0 && (
                <CommandEmpty>未找到结果</CommandEmpty>
              )}
              {!searching &&
                searchResults.length > 0 &&
                SEARCH_TYPES.map((type) => {
                  const group = searchResults.filter((r) => r.type === type);
                  if (group.length === 0) return null;
                  const Icon = typeIcons[type];
                  return (
                    <CommandGroup
                      key={type}
                      heading={`${typeLabels[type]}（${group.length}）`}
                    >
                      {group.map((result) => (
                        <CommandItem
                          key={`${result.type}-${result.id}`}
                          value={`${result.type}-${result.id}`}
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
                      ))}
                    </CommandGroup>
                  );
                })}
            </>
          ) : (
            <>
              <CommandGroup heading="快速导航">
                <CommandItem value="nav-dashboard" onSelect={() => handleNavigate("/dashboard")}>
                  <BarChart3 className="mr-2 h-4 w-4" />
                  仪表盘
                </CommandItem>
                <CommandItem value="nav-assets" onSelect={() => handleNavigate("/assets")}>
                  <Monitor className="mr-2 h-4 w-4" />
                  设备管理
                </CommandItem>
                <CommandItem value="nav-employees" onSelect={() => handleNavigate("/employees")}>
                  <Users className="mr-2 h-4 w-4" />
                  员工管理
                </CommandItem>
                <CommandItem value="nav-templates" onSelect={() => handleNavigate("/templates")}>
                  <LayoutGrid className="mr-2 h-4 w-4" />
                  设备模板
                </CommandItem>
                <CommandItem value="nav-models" onSelect={() => handleNavigate("/components/models")}>
                  <Cpu className="mr-2 h-4 w-4" />
                  配件型号
                </CommandItem>
                <CommandItem value="nav-stocktake" onSelect={() => handleNavigate("/stocktake")}>
                  <ClipboardCheck className="mr-2 h-4 w-4" />
                  库存盘点
                </CommandItem>
                <CommandItem value="nav-stats" onSelect={() => handleNavigate("/stats")}>
                  <BarChart3 className="mr-2 h-4 w-4" />
                  统计报表
                </CommandItem>
                <CommandItem value="nav-logs" onSelect={() => handleNavigate("/logs")}>
                  <FileText className="mr-2 h-4 w-4" />
                  系统日志
                </CommandItem>
                <CommandItem value="nav-settings" onSelect={() => handleNavigate("/settings")}>
                  <Settings className="mr-2 h-4 w-4" />
                  系统设置
                </CommandItem>
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup heading="快捷操作">
                <CommandItem value="act-create-asset" onSelect={() => handleNavigate("/assets?create=true")}>
                  <Plus className="mr-2 h-4 w-4" />
                  新建设备
                </CommandItem>
                <CommandItem value="act-create-employee" onSelect={() => handleNavigate("/employees?create=true")}>
                  <Plus className="mr-2 h-4 w-4" />
                  新建员工
                </CommandItem>
                <CommandItem value="act-create-template" onSelect={() => handleNavigate("/templates?create=true")}>
                  <Plus className="mr-2 h-4 w-4" />
                  新建模板
                </CommandItem>
                <CommandItem value="act-export-assets" onSelect={() => handleNavigate("/assets?export=true")}>
                  <Download className="mr-2 h-4 w-4" />
                  导出设备
                </CommandItem>
                <CommandItem value="act-import-assets" onSelect={() => handleNavigate("/assets?import=true")}>
                  <Upload className="mr-2 h-4 w-4" />
                  导入设备
                </CommandItem>
              </CommandGroup>
            </>
          )}
        </CommandList>
      </CommandDialog>
    </>
  );
}
