import os
import sys
import random
import datetime

# 将项目根目录添加到 sys.path
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from src.database.db_manager import DBManager

def seed_data():
    print("正在生成测试数据...")
    db = DBManager()
    conn = db.get_connection()
    c = conn.cursor()

    try:
        # 1. 部门
        departments = ['研发部', '产品部', '财务部', '行政部', '销售部']
        dept_ids = {}
        for name in departments:
            c.execute("INSERT OR IGNORE INTO departments (name) VALUES (?)", (name,))
            c.execute("SELECT id FROM departments WHERE name=?", (name,))
            dept_ids[name] = c.fetchone()[0]
        print(f"  - 已添加 {len(departments)} 个部门")

        # 2. 分类
        categories = ['笔记本电脑', '台式主机', '显示器', '打印机', '服务器']
        cat_ids = {}
        for name in categories:
            c.execute("INSERT OR IGNORE INTO categories (name) VALUES (?)", (name,))
            c.execute("SELECT id FROM categories WHERE name=?", (name,))
            cat_ids[name] = c.fetchone()[0]
        print(f"  - 已添加 {len(categories)} 个分类")

        # 3. 员工
        employees = [
            ('张三', '研发部', '13800138001'),
            ('李四', '研发部', '13800138002'),
            ('王五', '产品部', '13800138003'),
            ('赵六', '财务部', '13800138004'),
            ('孙七', '行政部', '13800138005')
        ]
        emp_ids = []
        
        # Manually generate emp_no to avoid transaction visibility issues with db.generate_emp_no()
        prefix = f"EMP{datetime.datetime.now().strftime('%Y%m%d')}"
        start_idx = 1
        
        for name, dept, phone in employees:
            emp_no = f"{prefix}{start_idx:04d}"
            start_idx += 1
            
            c.execute("INSERT OR IGNORE INTO employees (emp_no, name, dept_id, contact, status) VALUES (?, ?, ?, ?, '在职')", 
                      (emp_no, name, dept_ids[dept], phone))
            c.execute("SELECT id FROM employees WHERE name=?", (name,))
            res = c.fetchone()
            if res:
                emp_ids.append(res[0])
            else:
                print(f"  ! Warning: Failed to insert employee {name}")
        print(f"  - 已添加 {len(emp_ids)} 位员工")

        # 4. 配件型号与库存
        # (类型, 型号, 品牌, 分类ID, 初始库存)
        components = [
            ('内存', 'DDR4 16G 3200MHz', '金士顿', cat_ids['笔记本电脑'], 50),
            ('内存', 'DDR4 32G 3200MHz', '三星', cat_ids['笔记本电脑'], 20),
            ('硬盘', 'SSD 512G NVMe', '西部数据', cat_ids['笔记本电脑'], 30),
            ('硬盘', 'SSD 1T NVMe', '致态', cat_ids['笔记本电脑'], 15),
            ('显卡', 'RTX 4060 Ti', '七彩虹', cat_ids['台式主机'], 5),
            ('墨盒', 'H-12A', '惠普', cat_ids['打印机'], 100)
        ]
        
        for type_name, model, brand, cid, qty in components:
            try:
                c.execute("INSERT INTO component_models (type_name, model_name, brand, category_id) VALUES (?,?,?,?)", 
                          (type_name, model, brand, cid))
                mid = c.lastrowid
                c.execute("INSERT INTO component_stock (model_id, quantity) VALUES (?, ?)", (mid, qty))
                c.execute("INSERT INTO component_stock_logs (model_id, op_type, quantity, operator, remark) VALUES (?, '初始化入库', ?, 'System', '测试数据')", 
                          (mid, qty))
            except Exception as e:
                # 忽略重复插入错误
                pass
        print(f"  - 已添加 {len(components)} 种配件及其库存")

        # 5. 资产数据
        # 生成 20 台资产
        asset_templates = [
            ('MacBook Pro M3', '笔记本电脑', 'Apple', 'M3/16G/512G'),
            ('ThinkPad X1 Carbon', '笔记本电脑', 'Lenovo', 'i7/16G/1T'),
            ('Dell XPS 15', '笔记本电脑', 'Dell', 'i9/32G/1T'),
            ('Dell OptiPlex 7000', '台式主机', 'Dell', 'i5-12500/16G/512G'),
            ('HP LaserJet M1005', '打印机', 'HP', '黑白激光'),
            ('Dell U2723QE', '显示器', 'Dell', '4K IPS Type-C')
        ]

        conn.commit() # 提交前面的变更以防后面用到

        for i in range(1, 21):
            name_tpl, cat_name, brand, spec_suffix = random.choice(asset_templates)
            cid = cat_ids[cat_name]
            dept_id = random.choice(list(dept_ids.values()))
            
            # 随机状态
            status = random.choice(['在用', '在用', '在用', '闲置', '闲置', '维修'])
            user_id = None
            if status == '在用':
                user_id = random.choice(emp_ids)
            
            asset_no = f"ZC202601{i:04d}"
            purchase_date = (datetime.date.today() - datetime.timedelta(days=random.randint(0, 365))).strftime('%Y-%m-%d')
            
            c.execute("""
                INSERT OR IGNORE INTO assets 
                (asset_no, name, model, brand, spec, category_id, dept_id, user_id, status, purchase_date, remarks)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                asset_no, 
                f"{name_tpl} - {i}号", 
                spec_suffix, 
                brand, 
                spec_suffix, # 简单起见，规格摘要直接用型号后缀
                cid, 
                dept_id, 
                user_id, 
                status, 
                purchase_date, 
                "系统自动生成的测试资产"
            ))
        print(f"  - 已添加 20 条资产数据")

        conn.commit()
        print("测试数据生成完成！")

    except Exception as e:
        print(f"生成数据失败: {e}")
        conn.rollback()
    finally:
        conn.close()

if __name__ == "__main__":
    seed_data()
