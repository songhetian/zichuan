import sqlite3
import datetime
import random
from src.config import DB_PATH

def inject_test_data():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    print("开始清理并注入测试数据...")

    # 1. 确保基础部门和分类存在
    depts = [('技术部',), ('行政部',), ('财务部',), ('市场部',)]
    cursor.executemany("INSERT OR IGNORE INTO departments (name) VALUES (?)", depts)
    
    cats = [('电脑',), ('服务器',), ('显示器',), ('办公设备',)]
    cursor.executemany("INSERT OR IGNORE INTO categories (name) VALUES (?)", cats)

    # 2. 注入员工
    employees = [
        ('EMP001', '张三', 1, '13800138001', '在职'),
        ('EMP002', '李四', 2, '13800138002', '在职'),
        ('EMP003', '王五', 1, '13800138003', '在职'),
        ('EMP004', '赵六', 3, '13800138004', '在职'),
        ('EMP005', '孙七', 4, '13800138005', '在职')
    ]
    cursor.executemany("INSERT OR IGNORE INTO employees (emp_no, name, dept_id, contact, status) VALUES (?,?,?,?,?)", employees)

    # 3. 注入资产
    asset_list = []
    # 生成10台电脑
    for i in range(1, 11):
        status = random.choice(['闲置', '在用', '维修', '报废'])
        user_id = random.randint(1, 5) if status == '在用' else None
        asset_list.append((
            f"ZC-PC-{2024000 + i}", f"办公笔记本-{i}", f"ThinkPad T1{i}", 
            f"SN-TECH-{1000 + i}", 1, 1, user_id, "北京总部", status, "2023-01-10", "i7/16G/512G"
        ))
    
    # 生成5台显示器
    for i in range(1, 6):
        asset_list.append((
            f"ZC-MON-{2024000 + i}", f"4K显示器-{i}", "Dell U2723", 
            f"SN-MON-{2000 + i}", 3, 2, None, "会议室", "闲置", "2023-05-20", "27寸/4K"
        ))

    cursor.executemany('''
        INSERT OR IGNORE INTO assets (asset_no, name, model, sn, category_id, dept_id, user_id, location, status, purchase_date, spec)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ''', asset_list)

    # 4. 注入几条历史履历
    logs = [
        (1, '领用', 'admin', 1, '2024-01-10 09:00:00', '新入职领用'),
        (1, '归还', 'admin', 1, '2024-01-15 14:00:00', '设备检查'),
        (2, '领用', 'admin', 2, '2024-01-16 10:30:00', '项目需要')
    ]
    cursor.executemany('''
        INSERT INTO lifecycle_logs (asset_id, op_type, operator, target_user_id, op_date, remark)
        VALUES (?,?,?,?,?,?)
    ''', logs)

    conn.commit()
    conn.close()
    print("测试数据注入完成！您可以启动软件查看效果。")

if __name__ == "__main__":
    inject_test_data()
