/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SimpleCrudDialog, type FieldConfig } from "@/components/features/simple-crud-dialog";

const nameField: FieldConfig = { key: "name", label: "名称", type: "text", placeholder: "请输入名称" };

afterEach(() => {
  cleanup();
});

describe("SimpleCrudDialog 输入框", () => {
  it("新建弹窗中连续输入文字不被重置", async () => {
    const user = userEvent.setup();
    render(
      <SimpleCrudDialog
        open
        onOpenChange={vi.fn()}
        mode="create"
        title="新建"
        fields={[nameField]}
        onSubmit={vi.fn()}
      />
    );

    const input = screen.getByPlaceholderText("请输入名称");
    await user.type(input, "技术部");

    expect(input).toHaveValue("技术部");
  });

  it("编辑弹窗回显初始值，且修改后不被重置", async () => {
    const user = userEvent.setup();
    render(
      <SimpleCrudDialog
        open
        onOpenChange={vi.fn()}
        mode="edit"
        title="编辑"
        fields={[nameField]}
        initialValues={{ name: "技术部" }}
        onSubmit={vi.fn()}
      />
    );

    const input = screen.getByPlaceholderText("请输入名称");
    expect(input).toHaveValue("技术部");

    await user.clear(input);
    await user.type(input, "研发部");
    expect(input).toHaveValue("研发部");
  });
});
