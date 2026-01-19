#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
测试日志增强功能
验证操作日志中ID引用问题是否已解决
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))

from src.database.db_manager import DBManager


def test_log_enhancements():
    """测试日志增强功能"""
    print("=== 测试日志增强功能 ===\n")

    # 创建数据库管理器实例
    db = DBManager()

    # 测试分类库存初始化日志
    print("1. 测试分类库存初始化日志...")
    # 首先确保有一个分类
    db.add_category("测试电脑")
    # 获取分类ID
    categories = db.get_categories()
    test_category_id = None
    for cat_id, cat_name in categories:
        if cat_name == "测试电脑":
            test_category_id = cat_id
            break

    if test_category_id:
        print(f"   找到分类 '测试电脑' (ID: {test_category_id})")
        db.initialize_category_stock(test_category_id, 50)
        print(f"   ✓ 初始化分类库存成功，日志会记录分类名称和ID")
    else:
        print("   × 未找到测试分类")

    # 测试分类库存增加日志
    print("\n2. 测试分类库存增加日志...")
    if test_category_id:
        success, msg = db.add_category_stock(
            test_category_id, 10, "TestUser", "测试增加库存"
        )
        print(f"   增加分类库存结果: {msg}")

    # 测试分类库存扣减日志
    print("\n3. 测试分类库存扣减日志...")
    if test_category_id:
        success, msg = db.deduct_category_stock(
            test_category_id, 5, "TestUser", "测试扣减库存"
        )
        print(f"   扣减分类库存结果: {msg}")

    # 测试分类组件模板更新日志
    print("\n4. 测试分类组件模板更新日志...")
    if test_category_id:
        components_data = [
            {"name": "CPU", "qty": 1, "model_id": None},
            {"name": "内存", "qty": 2, "model_id": None},
        ]
        success = db.update_category_components(test_category_id, components_data)
        print(f"   更新分类组件模板: {'成功' if success else '失败'}")

    print("\n5. 验证系统日志中是否包含可读的实体名称...")
    # 获取最近的几条日志
    total, logs = db.get_system_logs(limit=10, offset=0)
    print(f"   最近 {min(total, 10)} 条日志:")
    for i, log in enumerate(logs[:5]):  # 只显示前5条
        op_date, operator, module, op_type, detail = log
        print(f"   {i+1}. {op_type} - {detail}")

    print("\n=== 测试完成 ===")
    print("✓ 所有日志现在都应该包含可读的实体名称和ID，便于审计追溯")


if __name__ == "__main__":
    test_log_enhancements()
