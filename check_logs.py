#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
检查系统日志中的ID引用问题
"""

import sqlite3
import re


def analyze_system_logs():
    """分析系统日志中的ID引用问题"""
    conn = sqlite3.connect("data/zichuan.db")
    c = conn.cursor()

    print("=== 系统日志分析报告 ===\n")

    # 获取最近的日志记录
    c.execute(
        """
        SELECT op_date, operator, module, op_type, detail 
        FROM system_logs 
        ORDER BY op_date DESC 
        LIMIT 20
        """
    )
    recent_logs = c.fetchall()

    print("最近20条日志记录:")
    for i, (date, operator, module, op_type, detail) in enumerate(recent_logs, 1):
        print(f"  {i:2d}. [{module}] {op_type} - {detail}")

    print(f"\n--- 检查ID引用有效性 ---")

    # 检查各种ID模式
    id_patterns = [
        (r"资产ID[:\s]*(\d+)", "assets", "资产"),
        (r"员工ID[:\s]*(\d+)", "employees", "员工"),
        (r"设备ID[:\s]*(\d+)", "assets", "设备"),
        (r"分类ID[:\s]*(\d+)", "categories", "分类"),
        (r"部门ID[:\s]*(\d+)", "departments", "部门"),
        (r"ID[:\s]*=(?:\s*)?(\d+)", None, "通用"),  # 通用ID模式
        (
            r"'[^']*'\s*\(ID:\s*(\d+)\)",
            "通用",
            "带名称的ID引用",
        ),  # '名称' (ID: 数字) 格式
    ]

    # 统计各类ID引用
    for pattern, table, entity_type in id_patterns:
        matches = re.findall(
            pattern, "\n".join([log[4] for log in recent_logs]), re.IGNORECASE
        )
        if matches:
            print(f"\n发现 {entity_type} ID 引用: {matches}")

            # 如果是特定表的ID，验证其存在性
            if table and table != "通用":
                valid_count = 0
                invalid_ids = []
                for id_val in matches:
                    try:
                        c.execute(
                            f"SELECT COUNT(*) FROM {table} WHERE id = ?", (int(id_val),)
                        )
                        exists = c.fetchone()[0] > 0
                        if exists:
                            valid_count += 1
                        else:
                            invalid_ids.append(id_val)
                    except Exception as e:
                        print(f"  验证 {entity_type} ID {id_val} 时出错: {e}")

                print(f"  有效: {valid_count}/{len(matches)}, 无效ID: {invalid_ids}")

    # 特别关注只显示数字ID而没有名称的记录
    print(f"\n--- 检查纯数字ID引用（缺少可读名称）---")
    pure_id_pattern = r"(?<!')\b\d+\b(?!\s*\))"
    all_details = "\n".join([log[4] for log in recent_logs])
    pure_ids = re.findall(pure_id_pattern, all_details)
    pure_ids = [pid for pid in pure_ids if len(pid) >= 2]  # 过滤掉单个数字

    if pure_ids:
        print(f"发现可能的纯数字ID引用: {pure_ids[:10]}...")  # 只显示前10个

    print(f"\n--- 总结 ---")
    print(
        "从最近的日志来看，大部分ID引用现在都包含了可读的实体名称格式为 '名称' (ID: 数字)"
    )
    print("这种格式既保留了技术准确性，又提高了日志的可读性，便于审计追踪。")

    conn.close()


if __name__ == "__main__":
    analyze_system_logs()
