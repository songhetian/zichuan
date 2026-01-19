#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
测试资产分配日志记录功能
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))

from src.database.db_manager import DBManager


def test_checkout_logging():
    """测试资产分配的日志记录功能"""
    db = DBManager()

    # 查找一个闲置资产和在职员工用于测试
    conn = db.get_connection()
    c = conn.cursor()

    # 获取一个闲置资产
    c.execute("SELECT id, name, asset_no FROM assets WHERE status='闲置' LIMIT 1")
    asset_result = c.fetchone()

    # 获取一个在职员工
    c.execute("SELECT id, name FROM employees WHERE status='在职' LIMIT 1")
    employee_result = c.fetchone()

    conn.close()

    if not asset_result or not employee_result:
        print("❌ 测试环境不满足条件：需要至少一个闲置资产和一个在职员工")
        return False

    asset_id, asset_name, asset_no = asset_result
    employee_id, employee_name = employee_result

    print(f"🔧 测试环境准备完成:")
    print(f"   资产: {asset_name} ({asset_no}), ID: {asset_id}")
    print(f"   员工: {employee_name}, ID: {employee_id}")
    print()

    # 执行资产分配
    print("🚀 执行资产分配操作...")
    success, message = db.checkout_asset(
        asset_id, employee_id, "TestUser", "测试分配备注"
    )

    if success:
        print(f"✅ 资产分配成功: {message}")

        # 验证日志记录
        print("\n📋 验证系统日志记录...")
        conn = db.get_connection()
        c = conn.cursor()

        # 查询最近的分配日志
        c.execute(
            """
            SELECT op_date, operator, module, op_type, detail 
            FROM system_logs 
            WHERE module='资产管理' AND op_type='分配领用'
            ORDER BY op_date DESC 
            LIMIT 1
        """
        )
        log_result = c.fetchone()

        if log_result:
            log_time, log_operator, log_module, log_type, log_detail = log_result
            print(f"✅ 找到分配日志记录:")
            print(f"   时间: {log_time}")
            print(f"   操作员: {log_operator}")
            print(f"   模块: {log_module}")
            print(f"   操作类型: {log_type}")
            print(f"   详情: {log_detail}")

            # 验证日志内容是否正确
            expected_content = (
                f"资产 {asset_name}({asset_no}) 分配给员工: {employee_name}"
            )
            if expected_content in log_detail:
                print("✅ 日志内容验证通过")
                result = True
            else:
                print(f"❌ 日志内容不匹配")
                print(f"   期望包含: {expected_content}")
                print(f"   实际内容: {log_detail}")
                result = False
        else:
            print("❌ 未找到分配日志记录")
            result = False

        conn.close()

        # 恢复资产状态（测试完成后）
        print("\n🔄 恢复测试数据...")
        conn = db.get_connection()
        c = conn.cursor()
        c.execute(
            "UPDATE assets SET status='闲置', user_id=NULL WHERE id=?", (asset_id,)
        )
        conn.commit()
        conn.close()
        print("✅ 测试数据已恢复")

    else:
        print(f"❌ 资产分配失败: {message}")
        result = False

    return result


if __name__ == "__main__":
    print("=" * 50)
    print("🧪 资产分配日志记录功能测试")
    print("=" * 50)

    try:
        success = test_checkout_logging()
        if success:
            print("\n🎉 测试通过！资产分配日志记录功能正常工作。")
            exit(0)
        else:
            print("\n💥 测试失败！资产分配日志记录存在问题。")
            exit(1)
    except Exception as e:
        print(f"\n💥 测试过程中发生异常: {e}")
        import traceback

        traceback.print_exc()
        exit(1)
