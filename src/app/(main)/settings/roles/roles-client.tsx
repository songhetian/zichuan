"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/features/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ChevronRight, ChevronDown, FolderOpen, FileText, MousePointerClick } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { getRoles, updateRolePermissions, setRoleDepartmentScope } from "@/actions/admin.actions";
import { PermModule, PermPage } from "@/lib/permissions";

type RoleRow = {
  id: number;
  key: string;
  name: string;
  isSystem: boolean;
  permissions: string[];
  departmentScope?: string;
  departmentIds?: number[];
};

type Department = { id: number; name: string };

type Props = {
  initialRoles: RoleRow[];
  modules: readonly PermModule[];
  departments: Department[];
};

/** 某页面涉及的全部 key（页面级 + 操作级） */
function pageKeys(p: PermPage, parentKey: string): string[] {
  const base = p.key ?? parentKey;
  return [base, ...(p.actions?.map((a) => a.key) ?? [])];
}
/** 某模块涉及的全部 key（模块级 + 全部页面/操作） */
function moduleKeys(m: PermModule): string[] {
  const ks = [m.parentKey];
  for (const p of m.pages) ks.push(...pageKeys(p, m.parentKey));
  return ks;
}
/** 勾选内容展开一组 key（并集、去重） */
function union(a: string[], b: string[]): string[] {
  return Array.from(new Set([...a, ...b]));
}
/** 从集合中移除一组 key */
function minus(a: string[], b: string[]): string[] {
  return a.filter((k) => !b.includes(k));
}

function Row({
  indent,
  label,
  ariaLabel,
  checked,
  onToggle,
  leaf = false,
}: {
  indent: number;
  label: React.ReactNode;
  ariaLabel: string;
  checked: boolean;
  onToggle: (on: boolean) => void;
  leaf?: boolean;
}) {
  return (
    <div
      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-secondary/50"
      style={{ paddingLeft: 8 + indent * 22 }}
      onClick={() => onToggle(!checked)}
    >
      <Checkbox aria-label={ariaLabel} checked={checked} onCheckedChange={(v) => onToggle(v === true)} />
      <span className={cn("text-sm", leaf ? "text-foreground" : "font-medium")}>{label}</span>
    </div>
  );
}

export function RolesClient({ initialRoles, modules, departments }: Props) {
  const [roles, setRoles] = useState(initialRoles);
  const [editing, setEditing] = useState<RoleRow | null>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const [scope, setScope] = useState<"ALL" | "SPEC">("ALL");
  const [scopeDeptIds, setScopeDeptIds] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [openModules, setOpenModules] = useState<Set<string>>(() => new Set(modules.map((m) => m.parentKey)));
  const { toast } = useToast();

  const summary = useMemo(() => {
    const pageNames: string[] = [];
    let actionCount = 0;
    for (const m of modules) {
      for (const p of m.pages) {
        const pk = p.key ?? m.parentKey;
        if (checked.includes(pk)) pageNames.push(p.label);
        actionCount += (p.actions ?? []).filter((a) => checked.includes(a.key)).length;
      }
    }
    return { pageNames, actionCount };
  }, [modules, checked]);

  // 全部可选权限 key（全局全选/清空用）
  const allKeys = useMemo(() => {
    const ks: string[] = [];
    for (const m of modules) ks.push(...moduleKeys(m));
    return Array.from(new Set(ks));
  }, [modules]);

  const allChecked = useMemo(
    () => allKeys.length > 0 && allKeys.every((k) => checked.includes(k)),
    [allKeys, checked]
  );
  const anyChecked = useMemo(
    () => allKeys.some((k) => checked.includes(k)),
    [allKeys, checked]
  );

  /** 某模块下属权限是否已全选 */
  const moduleAll = (m: PermModule) =>
    moduleKeys(m).every((k) => checked.includes(k));

  const refresh = async () => {
    const result = await getRoles();
    if (result.success) setRoles(result.data);
  };

  const openEdit = (role: RoleRow) => {
    setEditing(role);
    setChecked(role.permissions);
    setScope(role.departmentScope === "SPEC" ? "SPEC" : "ALL");
    setScopeDeptIds(role.departmentIds ?? []);
    setOpenModules(new Set(modules.map((m) => m.parentKey)));
  };

  const closeEdit = () => {
    if (saving) return;
    setEditing(null);
  };

  const toggleModule = (m: PermModule, on: boolean) => {
    setChecked((prev) => (on ? union(prev, moduleKeys(m)) : minus(prev, moduleKeys(m))));
  };
  /** 全局全选/清空（所有模块的权限） */
  const toggleAll = (on: boolean) => {
    setChecked(on ? allKeys : []);
  };
  const togglePage = (m: PermModule, p: PermPage, on: boolean) => {
    const pk = p.key ?? m.parentKey;
    setChecked((prev) => {
      if (on) return union(prev, [m.parentKey, ...pageKeys(p, m.parentKey)]);
      // 取消页面：移除该页面及操作；但页面级 key 与模块级相同（无独立页面点时）则移除模块级
      const toRemove = pageKeys(p, m.parentKey);
      return pk === m.parentKey ? minus(prev, toRemove) : minus(prev, toRemove);
    });
  };
  const toggleAction = (m: PermModule, p: PermPage, key: string, on: boolean) => {
    setChecked((prev) => {
      if (on) {
        const needs = [m.parentKey, p.key ?? m.parentKey, key];
        return union(prev, needs);
      }
      return minus(prev, [key]);
    });
  };

  const toggleModuleOpen = (key: string) => {
    setOpenModules((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleSave = async () => {
    if (!editing) return;
    setSaving(true);
    const [permRes, scopeRes] = await Promise.all([
      updateRolePermissions(editing.id, checked),
      setRoleDepartmentScope(editing.id, {
        scope,
        departmentIds: scope === "SPEC" ? scopeDeptIds : [],
      }),
    ]);
    setSaving(false);
    const failed = [permRes.success ? null : permRes.error, scopeRes.success ? null : scopeRes.error]
      .filter(Boolean)
      .join("；");
    if (!failed) {
      toast({ title: "保存成功" });
      await refresh();
      setEditing(null);
    } else {
      toast({ title: "保存失败", description: failed, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader title="角色权限" description="按 模块 → 页面 → 操作 配置权限，父级勾选自动带出其下所有子级，保存后立即生效" />

      <Card>
        <CardHeader>
          <CardTitle>角色列表</CardTitle>
        </CardHeader>
        <CardContent>
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead>角色</TableHead>
                <TableHead>权限</TableHead>
                <TableHead className="w-[120px]">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {roles.map((role) => {
                const pages = modules.flatMap((m) =>
                  m.pages.filter((p) => role.permissions.includes(p.key ?? m.parentKey))
                );
                const actionCount = modules.reduce((acc, m) => {
                  for (const p of m.pages) {
                    acc += (p.actions ?? []).filter((a) => role.permissions.includes(a.key)).length;
                  }
                  return acc;
                }, 0);
                return (
                  <TableRow key={role.id}>
                    <TableCell>
                      <div>
                        <span className="font-medium">{role.name}</span>
                        {role.isSystem && (
                          <Badge variant="outline" className="ml-2">系统</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {pages.length === 0 && actionCount === 0 ? (
                          <span className="text-muted-foreground">无权限</span>
                        ) : (
                          <>
                            {pages.slice(0, 6).map((p) => (
                              <Badge key={p.key ?? ""} variant="secondary">{p.label}</Badge>
                            ))}
                            {pages.length > 6 && <Badge variant="outline">+{pages.length - 6}</Badge>}
                            {actionCount > 0 && (
                              <span className="text-xs text-muted-foreground">
                                {actionCount} 项操作
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="w-[120px]">
                      <Button type="button" variant="ghost" size="sm" title="编辑权限" onClick={() => openEdit(role)}>
                        编辑权限
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={editing !== null} onOpenChange={(v) => { if (!v) closeEdit(); }}>
        <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>编辑权限：{editing?.name}</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-between border-b pb-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="perm-all"
                aria-label="全选所有权限"
                checked={allChecked ? true : anyChecked ? "indeterminate" : false}
                onCheckedChange={() => toggleAll(!allChecked)}
              />
              <label htmlFor="perm-all" className="cursor-pointer text-sm font-medium">
                全选所有权限
              </label>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className={cn(anyChecked ? "text-foreground" : "")}>
                已选 {checked.length} / {allKeys.length}
              </span>
              {anyChecked && (
                <Button type="button" variant="ghost" size="sm" className="h-6 px-2" onClick={() => toggleAll(false)}>
                  清空
                </Button>
              )}
            </div>
          </div>
          <div className="flex-1 space-y-1 overflow-y-auto pr-1 pt-2">
            {modules.map((m) => {
              const open = openModules.has(m.parentKey);
              if (m.pages.length === 0) {
                // 无页面细分的纯数据范围点：单独一项
                return (
                  <Row
                    key={m.parentKey}
                    indent={0}
                    label={m.parentLabel}
                    ariaLabel={m.parentLabel}
                    checked={checked.includes(m.parentKey)}
                    onToggle={(on) => toggleModule(m, on)}
                  />
                );
              }
              return (
                <div key={m.module} className="rounded-md border p-2">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className="rounded p-0.5 text-muted-foreground hover:bg-secondary"
                      onClick={() => toggleModuleOpen(m.parentKey)}
                    >
                      {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                    <Row
                      indent={0}
                      label={m.parentLabel}
                      ariaLabel={m.parentLabel}
                      checked={checked.includes(m.parentKey)}
                      onToggle={(on) => toggleModule(m, on)}
                    />
                    <button
                      type="button"
                      className={cn(
                        "ml-auto shrink-0 rounded px-1.5 py-0.5 text-xs font-medium transition-colors",
                        moduleAll(m)
                          ? "text-primary hover:text-primary/70"
                          : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                      )}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleModule(m, !moduleAll(m));
                      }}
                    >
                      {moduleAll(m) ? "取消全选" : "全选"}
                    </button>
                  </div>
                  {open && (
                    <div className="mt-1 space-y-1 border-l pl-4">
                      {m.pages.map((p) => {
                        const pk = p.key ?? m.parentKey;
                        const actions = p.actions ?? [];
                        return (
                          <div key={p.label} className="rounded-md border-l-2 border-muted pl-2">
                            <div className="flex items-center gap-1">
                              <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
                              <Row
                                indent={0}
                                label={p.label}
                                ariaLabel={p.label}
                                checked={checked.includes(pk)}
                                onToggle={(on) => togglePage(m, p, on)}
                              />
                            </div>
                            {actions.length > 0 && (
                              <div className="grid grid-cols-2 gap-0.5 py-1">
                                {actions.map((a) => (
                                  <Row
                                    key={a.key}
                                    indent={0}
                                    label={
                                      <span className="inline-flex items-center gap-1">
                                        <MousePointerClick className="h-3 w-3 text-muted-foreground" />
                                        {a.label}
                                      </span>
                                    }
                                    ariaLabel={a.label}
                                    checked={checked.includes(a.key)}
                                    onToggle={(on) => toggleAction(m, p, a.key, on)}
                                    leaf
                                  />
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mb-2 rounded-md border border-primary/20 bg-primary/5 p-2.5">
            <div className="text-sm font-medium">数据范围</div>
            <div className="mt-1.5 flex items-center gap-4 text-sm">
              <label className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="radio"
                  name="dept-scope"
                  value="ALL"
                  aria-label="数据范围-全部"
                  checked={scope === "ALL"}
                  onChange={() => {
                    setScope("ALL");
                    setScopeDeptIds([]);
                  }}
                />
                全部
              </label>
              <label className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="radio"
                  name="dept-scope"
                  value="SPEC"
                  aria-label="数据范围-指定部门"
                  checked={scope === "SPEC"}
                  onChange={() => setScope("SPEC")}
                />
                指定部门
              </label>
            </div>
            {scope === "SPEC" && (
              <div className="mt-2 grid grid-cols-2 gap-1">
                {departments.length === 0 ? (
                  <span className="text-xs text-muted-foreground">暂无部门，请先在部门管理中创建</span>
                ) : (
                  departments.map((d) => {
                    const on = scopeDeptIds.includes(d.id);
                    return (
                      <label key={d.id} className="flex cursor-pointer items-center gap-1.5 text-sm">
                        <Checkbox
                          aria-label={`范围部门-${d.name}`}
                          checked={on}
                          onCheckedChange={() =>
                            setScopeDeptIds((prev) =>
                              on ? prev.filter((x) => x !== d.id) : [...prev, d.id]
                            )
                          }
                        />
                        {d.name}
                      </label>
                    );
                  })
                )}
              </div>
            )}
          </div>
          <div className="flex items-center justify-between border-t pt-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <FileText className="h-3.5 w-3.5" />
              {summary.pageNames.length} 个页面 · {summary.actionCount} 项操作权限
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeEdit} disabled={saving}>
                取消
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "保存中..." : "保存"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}