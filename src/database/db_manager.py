import sqlite3
import os
import logging
import datetime
import pandas as pd
from src.config import DB_PATH


class DBManager:
    def __init__(self, db_path=None):
        self.db_path = db_path or DB_PATH
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        self.init_db()

    def get_connection(self):
        conn = sqlite3.connect(self.db_path, timeout=5000)
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA cache_size = -4000;")
        conn.execute("PRAGMA synchronous = NORMAL;")
        return conn

    def init_db(self):
        conn = self.get_connection()
        c = conn.cursor()
        c.execute(
            "CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE)"
        )
        c.execute(
            "CREATE TABLE IF NOT EXISTS departments (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE)"
        )
        c.execute(
            """CREATE TABLE IF NOT EXISTS employees (id INTEGER PRIMARY KEY AUTOINCREMENT, emp_no TEXT UNIQUE, name TEXT NOT NULL, dept_id INTEGER, contact TEXT, status TEXT DEFAULT '在职', FOREIGN KEY (dept_id) REFERENCES departments (id))"""
        )
        c.execute(
            """CREATE TABLE IF NOT EXISTS assets (id INTEGER PRIMARY KEY AUTOINCREMENT, asset_no TEXT UNIQUE, name TEXT NOT NULL, model TEXT, brand TEXT, spec TEXT, category_id INTEGER, dept_id INTEGER, user_id INTEGER, location TEXT, status TEXT DEFAULT '闲置', purchase_date DATE, remarks TEXT, FOREIGN KEY (category_id) REFERENCES categories (id), FOREIGN KEY (dept_id) REFERENCES departments (id), FOREIGN KEY (user_id) REFERENCES employees (id))"""
        )
        c.execute(
            """CREATE TABLE IF NOT EXISTS category_components (id INTEGER PRIMARY KEY AUTOINCREMENT, category_id INTEGER, component_name TEXT, default_quantity INTEGER DEFAULT 1, FOREIGN KEY (category_id) REFERENCES categories (id))"""
        )
        try:
            c.execute(
                "ALTER TABLE category_components ADD COLUMN parent_id INTEGER REFERENCES category_components(id)"
            )
        except:
            pass
        try:
            c.execute(
                "ALTER TABLE category_components ADD COLUMN model_id INTEGER REFERENCES component_models(id)"
            )
        except:
            pass
        c.execute(
            """CREATE TABLE IF NOT EXISTS asset_components (id INTEGER PRIMARY KEY AUTOINCREMENT, asset_id INTEGER, comp_name TEXT, comp_spec TEXT, FOREIGN KEY (asset_id) REFERENCES assets (id))"""
        )
        try:
            c.execute(
                "ALTER TABLE asset_components ADD COLUMN parent_id INTEGER REFERENCES asset_components(id)"
            )
        except:
            pass
        try:
            c.execute(
                "ALTER TABLE asset_components ADD COLUMN quantity INTEGER DEFAULT 1"
            )
        except:
            pass
        try:
            c.execute(
                "ALTER TABLE asset_components ADD COLUMN model_id INTEGER REFERENCES component_models(id)"
            )
        except:
            pass
        c.execute(
            """CREATE TABLE IF NOT EXISTS lifecycle_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, asset_id INTEGER, op_type TEXT, operator TEXT, target_user_id INTEGER, op_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP, remark TEXT)"""
        )
        c.execute(
            """CREATE TABLE IF NOT EXISTS maintenance_records (id INTEGER PRIMARY KEY AUTOINCREMENT, asset_id INTEGER, type TEXT, content TEXT, date DATE)"""
        )
        c.execute(
            """CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT, role TEXT)"""
        )
        c.execute(
            """CREATE TABLE IF NOT EXISTS system_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, op_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP, operator TEXT, module TEXT, op_type TEXT, detail TEXT)"""
        )
        c.execute(
            """CREATE TABLE IF NOT EXISTS component_models (id INTEGER PRIMARY KEY AUTOINCREMENT, type_name TEXT, model_name TEXT NOT NULL, brand TEXT, UNIQUE(type_name, model_name))"""
        )
        try:
            c.execute(
                "ALTER TABLE component_models ADD COLUMN category_id INTEGER REFERENCES categories(id)"
            )
        except:
            pass
        c.execute(
            """CREATE TABLE IF NOT EXISTS component_stock (id INTEGER PRIMARY KEY AUTOINCREMENT, model_id INTEGER, quantity INTEGER DEFAULT 0, last_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (model_id) REFERENCES component_models (id))"""
        )
        c.execute(
            """CREATE TABLE IF NOT EXISTS component_stock_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, model_id INTEGER, op_type TEXT, quantity INTEGER, operator TEXT, op_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP, remark TEXT, FOREIGN KEY (model_id) REFERENCES component_models (id))"""
        )
        # 对账相关表
        c.execute(
            """CREATE TABLE IF NOT EXISTS stocktake_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, start_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP, status TEXT DEFAULT '已完成')"""
        )
        c.execute(
            """CREATE TABLE IF NOT EXISTS stocktake_details (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER, asset_no TEXT, name TEXT, category TEXT, status TEXT, user_name TEXT, FOREIGN KEY (session_id) REFERENCES stocktake_sessions (id))"""
        )
        try:
            c.execute(
                "ALTER TABLE category_components ADD COLUMN default_quantity INTEGER DEFAULT 1"
            )
        except:
            pass

        # 添加分类库存表
        c.execute(
            """CREATE TABLE IF NOT EXISTS category_stock (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            category_id INTEGER NOT NULL,
            quantity INTEGER DEFAULT 0,
            last_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (category_id) REFERENCES categories (id)
        )"""
        )

        # 补全索引以提升查询效率
        c.execute(
            "CREATE INDEX IF NOT EXISTS idx_cc_cat ON category_components(category_id)"
        )
        c.execute(
            "CREATE INDEX IF NOT EXISTS idx_cc_mod ON category_components(model_id)"
        )
        c.execute(
            "CREATE INDEX IF NOT EXISTS idx_cm_cat ON component_models(category_id)"
        )
        c.execute("CREATE INDEX IF NOT EXISTS idx_cs_mid ON component_stock(model_id)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_ac_aid ON asset_components(asset_id)")

        # 性能优化：建立关键字段索引
        c.execute("CREATE INDEX IF NOT EXISTS idx_assets_no ON assets(asset_no)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_assets_cat ON assets(category_id)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_assets_dept ON assets(dept_id)")
        c.execute(
            "CREATE INDEX IF NOT EXISTS idx_comp_models_cat ON component_models(category_id)"
        )
        c.execute(
            "CREATE INDEX IF NOT EXISTS idx_comp_stock_mid ON component_stock(model_id)"
        )
        c.execute(
            "CREATE INDEX IF NOT EXISTS idx_asset_comp_aid ON asset_components(asset_id)"
        )

        self._insert_initial_data(c)
        conn.commit()
        conn.close()

    def auto_complete_stocktake(self, name):
        conn = self.get_connection()
        c = conn.cursor()
        try:
            # 1. 创建任务
            c.execute("INSERT INTO stocktake_sessions (name) VALUES (?)", (name,))
            sid = c.lastrowid

            # 2. 抓取所有资产快照 (资产号, 名称, 分类, 状态, 使用人)
            c.execute(
                """
                SELECT a.asset_no, a.name, c.name, a.status, e.name 
                FROM assets a 
                LEFT JOIN categories c ON a.category_id = c.id 
                LEFT JOIN employees e ON a.user_id = e.id
            """
            )
            assets = c.fetchall()

            # 3. 批量写入明细 (优化性能，防止卡死)
            batch_data = [(sid, a[0], a[1], a[2], a[3], a[4]) for a in assets]
            c.executemany(
                "INSERT INTO stocktake_details (session_id, asset_no, name, category, status, user_name) VALUES (?,?,?,?,?,?)",
                batch_data,
            )

            self.log_action(
                "Admin",
                "库存对账",
                "生成报告",
                f"完成了自动盘点对账报告: {name} (共计 {len(assets)} 项)",
                cursor=c,
            )
            conn.commit()
            return True
        except Exception as e:
            logging.error(f"Stocktake failed: {e}")
            conn.rollback()
            return False
        finally:
            conn.close()

    def get_stocktake_details(self, sid):
        conn = self.get_connection()
        c = conn.cursor()
        c.execute(
            "SELECT asset_no, name, category, status, user_name FROM stocktake_details WHERE session_id = ?",
            (sid,),
        )
        r = c.fetchall()
        conn.close()
        return r

    def get_category_template_for_asset(self, asset_id):
        """根据资产所在的分类，获取该分类的配件预设模板"""
        conn = self.get_connection()
        c = conn.cursor()
        c.execute(
            """
            SELECT cc.component_name, cc.default_quantity, cc.model_id, m.model_name, IFNULL(s.quantity, 0)
            FROM assets a
            JOIN category_components cc ON a.category_id = cc.category_id
            LEFT JOIN component_models m ON cc.model_id = m.id
            LEFT JOIN component_stock s ON m.id = s.model_id
            WHERE a.id = ?
        """,
            (asset_id,),
        )
        r = c.fetchall()
        conn.close()
        return r

    def _insert_initial_data(self, c):
        c.execute(
            "INSERT OR IGNORE INTO users (username, password, role) VALUES (?, ?, ?)",
            ("admin", "admin123", "super"),
        )
        for cat in ["电脑", "服务器", "打印机"]:
            c.execute("INSERT OR IGNORE INTO categories (name) VALUES (?)", (cat,))
        for dept in ["行政部", "技术部", "财务部"]:
            c.execute("INSERT OR IGNORE INTO departments (name) VALUES (?)", (dept,))

    def log_action(self, op, mod, typ, det, cursor=None):
        if cursor:
            cursor.execute(
                "INSERT INTO system_logs (operator, module, op_type, detail) VALUES (?,?,?,?)",
                (op, mod, typ, det),
            )
        else:
            conn = self.get_connection()
            c = conn.cursor()
            c.execute(
                "INSERT INTO system_logs (operator, module, op_type, detail) VALUES (?,?,?,?)",
                (op, mod, typ, det),
            )
            conn.commit()
            conn.close()

    def _get_paged_data(self, base_sql, params, limit, offset, order_by_clause=""):
        conn = self.get_connection()
        c = conn.cursor()
        from_index = base_sql.upper().find("FROM")
        c.execute(f"SELECT COUNT(*) {base_sql[from_index:]}", params)
        total = c.fetchone()[0]
        c.execute(
            f"{base_sql} {order_by_clause} LIMIT ? OFFSET ?",
            list(params) + [limit, offset],
        )
        rows = c.fetchall()
        conn.close()
        return total, rows

    def validate_user(self, u, p):
        conn = self.get_connection()
        c = conn.cursor()
        c.execute("SELECT * FROM users WHERE username=? AND password=?", (u, p))
        r = c.fetchone()
        conn.close()
        return r is not None

    # --- 核心：带库存扣减的批量更新 ---
    def update_asset_components_batch(self, aid, components_list, op, change_type):
        """
        components_list: list of (comp_type, model_name, qty, model_id)
        """
        conn = self.get_connection()
        c = conn.cursor()
        try:
            c.execute("SELECT name, asset_no FROM assets WHERE id=?", (aid,))
            aname, ano = c.fetchone()
            for t_name, m_name, qty, mid in components_list:
                # 1. 记录旧规格
                c.execute(
                    "SELECT comp_spec FROM asset_components WHERE asset_id=? AND comp_name=?",
                    (aid, t_name),
                )
                old_res = c.fetchone()
                old_spec = old_res[0] if old_res else "未配置"
                new_spec = f"{m_name}"  # 简写

                if new_spec != old_spec:
                    # 2. 更新资产配件表
                    if old_res:
                        c.execute(
                            "UPDATE asset_components SET comp_spec=? WHERE asset_id=? AND comp_name=?",
                            (new_spec, aid, t_name),
                        )
                    else:
                        c.execute(
                            "INSERT INTO asset_components (asset_id, comp_name, comp_spec) VALUES (?,?,?)",
                            (aid, t_name, new_spec),
                        )

                    # 3. 扣减库存 (如果是升级/维修)
                    if mid and change_type in ["配置升级", "维修替换"]:
                        c.execute(
                            "UPDATE component_stock SET quantity = quantity - ? WHERE model_id = ?",
                            (qty, mid),
                        )
                        c.execute(
                            "INSERT INTO component_stock_logs (model_id, op_type, quantity, operator, remark) VALUES (?, '设备领用', ?, ?, ?)",
                            (mid, -qty, op, f"用于资产: {aname}({ano})"),
                        )

                    # 4. 记录维护审计
                    c.execute(
                        "INSERT INTO maintenance_records (asset_id, type, content, date) VALUES (?, ?, ?, DATE('now'))",
                        (aid, change_type, f"{t_name}: {old_spec} -> {new_spec}"),
                    )

            # 更新摘要
            c.execute(
                "SELECT comp_name, comp_spec FROM asset_components WHERE asset_id=?",
                (aid,),
            )
            rows = c.fetchall()
            full_list = [
                f"{x[0]}: {x[1]}"
                for x in rows
                if x[1] and str(x[1]).strip() and x[1] != "待配置"
            ]
            if len(full_list) > 3:
                summary = " / ".join(full_list[:3]) + f" ... (共{len(full_list)}项)"
            else:
                summary = " / ".join(full_list)
            c.execute("UPDATE assets SET spec=? WHERE id=?", (summary, aid))
            conn.commit()
            return True
        except Exception as e:
            logging.error(f"Batch Error: {e}")
            conn.rollback()
            return False
        finally:
            conn.close()

    def get_dashboard_stats(self):
        conn = self.get_connection()
        c = conn.cursor()
        r = {}
        c.execute("SELECT COUNT(*) FROM assets")
        r["total_count"] = c.fetchone()[0]
        c.execute("SELECT COUNT(*) FROM assets WHERE status='在用'")
        r["in_use_count"] = c.fetchone()[0]
        c.execute("SELECT COUNT(*) FROM assets WHERE status='闲置'")
        r["idle_count"] = c.fetchone()[0]
        c.execute("SELECT COUNT(*) FROM assets WHERE status='维修'")
        r["maintenance_count"] = c.fetchone()[0]
        conn.close()
        return r

    def get_dashboard_extended_stats(self):
        """获取增强版仪表盘统计数据"""
        conn = self.get_connection()
        c = conn.cursor()
        stats = {}

        # 1. 基础计数
        c.execute("SELECT COUNT(*) FROM assets")
        stats["total"] = c.fetchone()[0]
        c.execute("SELECT COUNT(*) FROM assets WHERE status='在用'")
        stats["in_use"] = c.fetchone()[0]

        # 2. 本月统计
        current_month = datetime.datetime.now().strftime("%Y-%m")
        # 本月入库 (基于 purchase_date)
        c.execute(
            "SELECT COUNT(*) FROM assets WHERE strftime('%Y-%m', purchase_date) = ?",
            (current_month,),
        )
        stats["new_this_month"] = c.fetchone()[0]
        # 本月领用 (基于 lifecycle_logs)
        c.execute(
            "SELECT COUNT(*) FROM lifecycle_logs WHERE op_type='领用' AND strftime('%Y-%m', op_date) = ?",
            (current_month,),
        )
        stats["assigned_this_month"] = c.fetchone()[0]

        # 3. 分类分布及其状态明细
        c.execute(
            """
            SELECT c.name, 
                   COUNT(a.id) as total,
                   COUNT(CASE WHEN a.status='闲置' THEN 1 END) as idle,
                   COUNT(CASE WHEN a.status='在用' THEN 1 END) as in_use,
                   COUNT(CASE WHEN a.status='维修' THEN 1 END) as repair,
                   COUNT(CASE WHEN a.status='报废' THEN 1 END) as scrap
            FROM categories c 
            LEFT JOIN assets a ON c.id = a.category_id 
            GROUP BY c.name 
            ORDER BY COUNT(a.id) DESC
        """
        )
        stats["cat_dist"] = c.fetchall()

        conn.close()
        return stats

    def get_recent_activity(self, limit=10):
        conn = self.get_connection()
        c = conn.cursor()
        c.execute(
            """SELECT l.op_date, l.op_type, a.name, e.name FROM lifecycle_logs l JOIN assets a ON l.asset_id = a.id 
                     LEFT JOIN employees e ON l.target_user_id = e.id ORDER BY l.op_date DESC LIMIT ?""",
            (limit,),
        )
        r = c.fetchall()
        conn.close()
        return r

    def get_all_assets(
        self,
        kw="",
        did=None,
        cid=None,
        status=None,
        limit=20,
        offset=0,
        order_col="id",
        order_dir="DESC",
    ):
        mapping = {
            "id": "a.id",
            "asset_no": "a.asset_no",
            "name": "a.name",
            "status": "a.status",
        }
        sql = f"""SELECT a.id, a.asset_no, a.name, a.model, c.name, d.name, a.status, e.name, a.spec, a.purchase_date, a.category_id 
                 FROM assets a LEFT JOIN categories c ON a.category_id = c.id
                 LEFT JOIN departments d ON a.dept_id = d.id LEFT JOIN employees e ON a.user_id = e.id WHERE 1=1"""
        ps = []
        if kw:
            sql += " AND (a.name LIKE ? OR a.asset_no LIKE ? OR a.spec LIKE ?)"
            p = f"%{kw}%"
            ps.extend([p, p, p])
        if did:
            sql += " AND a.dept_id = ?"
            ps.append(did)
        if cid:
            sql += " AND a.category_id = ?"
            ps.append(cid)
        if status and status != "全部":
            sql += " AND a.status = ?"
            ps.append(status)
        order_clause = f"ORDER BY {mapping.get(order_col, 'a.id')} {order_dir}"
        return self._get_paged_data(sql, ps, limit, offset, order_clause)

    def get_all_employees(
        self,
        kw="",
        did=None,
        status=None,
        limit=20,
        offset=0,
        order_col="id",
        order_dir="DESC",
    ):
        mapping = {"id": "e.id", "name": "e.name", "status": "e.status"}
        sql = "SELECT e.id, e.emp_no, e.name, d.name, e.contact, e.status FROM employees e LEFT JOIN departments d ON e.dept_id = d.id WHERE 1=1"
        ps = []
        if kw:
            sql += " AND e.name LIKE ?"
            ps.append(f"%{kw}%")
        if did:
            sql += " AND e.dept_id = ?"
            ps.append(did)
        if status and status != "全部":
            sql += " AND e.status = ?"
            ps.append(status)
        order_clause = f"ORDER BY {mapping.get(order_col, 'e.id')} {order_dir}"
        if limit is None:
            conn = self.get_connection()
            c = conn.cursor()
            c.execute(f"{sql} {order_clause}", ps)
            r = c.fetchall()
            conn.close()
            return r
        return self._get_paged_data(sql, ps, limit, offset, order_clause)

    def get_all_component_models(
        self, type_name=None, category_id=None, kw="", limit=20, offset=0
    ):
        conn = self.get_connection()
        c = conn.cursor()
        sql_base = """
            FROM component_models m 
            LEFT JOIN component_stock s ON m.id = s.model_id
            LEFT JOIN categories c ON m.category_id = c.id
            WHERE 1=1
        """
        ps = []
        if type_name and type_name != "全部类型":
            sql_base += " AND m.type_name = ?"
            ps.append(type_name)
        if category_id:
            sql_base += " AND m.category_id = ?"
            ps.append(category_id)
        if kw:
            sql_base += (
                " AND (m.model_name LIKE ? OR m.brand LIKE ? OR m.type_name LIKE ?)"
            )
            p = f"%{kw}%"
            ps.extend([p, p, p])

        # 1. 获取总数
        c.execute(f"SELECT COUNT(*) {sql_base}", ps)
        total = c.fetchone()[0]

        # 2. 获取分页数据
        sql = f"""
            SELECT m.id, m.type_name, m.model_name, m.brand, IFNULL(s.quantity, 0), 
                   COALESCE(c.name, '未分类') as category_name 
            {sql_base}
            ORDER BY m.id DESC
            LIMIT ? OFFSET ?
        """
        c.execute(sql, ps + [limit, offset])
        rows = c.fetchall()
        conn.close()
        return total, rows

    def add_component_model(self, t, m, b, cid):
        conn = self.get_connection()
        c = conn.cursor()
        try:
            c.execute(
                "INSERT INTO component_models (type_name, model_name, brand, category_id) VALUES (?,?,?,?)",
                (t, m, b, cid),
            )
            mid = c.lastrowid
            c.execute(
                "INSERT INTO component_stock (model_id, quantity) VALUES (?, 0)", (mid,)
            )
            self.log_action(
                "Admin", "配件管理", "新增型号", f"新增型号: {m} ({t})", cursor=c
            )
            conn.commit()
            return True
        except:
            return False
        finally:
            conn.close()

    def add_component_stock(self, mid, qty, op, rem):
        conn = self.get_connection()
        c = conn.cursor()
        try:
            c.execute(
                "UPDATE component_stock SET quantity = quantity + ? WHERE model_id = ?",
                (qty, mid),
            )
            c.execute(
                "INSERT INTO component_stock_logs (model_id, op_type, quantity, operator, remark) VALUES (?, '采购入库', ?, ?, ?)",
                (mid, qty, op, rem),
            )
            conn.commit()
            return True
        except:
            return False
        finally:
            conn.close()

    def get_component_stock_logs(self, keyword=""):
        conn = self.get_connection()
        c = conn.cursor()
        sql = "SELECT l.op_date, m.type_name, m.model_name, l.op_type, l.quantity, l.operator, l.remark FROM component_stock_logs l JOIN component_models m ON l.model_id = m.id ORDER BY l.op_date DESC"
        c.execute(sql)
        r = c.fetchall()
        conn.close()
        return r

    def get_model_stock(self, mid):
        conn = self.get_connection()
        c = conn.cursor()
        c.execute("SELECT quantity FROM component_stock WHERE model_id = ?", (mid,))
        r = c.fetchone()
        conn.close()
        return r[0] if r else 0

    def get_departments(self):
        conn = self.get_connection()
        c = conn.cursor()
        c.execute("SELECT id, name FROM departments")
        r = c.fetchall()
        conn.close()
        return r

    def get_categories(self):
        conn = self.get_connection()
        c = conn.cursor()
        c.execute("SELECT id, name FROM categories")
        r = c.fetchall()
        conn.close()
        return r

    def get_all_admins(self):
        conn = self.get_connection()
        c = conn.cursor()
        c.execute("SELECT id, username, role FROM users")
        r = c.fetchall()
        conn.close()
        return r

    def get_all_admins_paged(self, limit, offset):
        return self._get_paged_data(
            "SELECT id, username, role FROM users", [], limit, offset, "ORDER BY id ASC"
        )

    def get_departments_paged(self, limit, offset):
        return self._get_paged_data(
            "SELECT id, name FROM departments", [], limit, offset, "ORDER BY id ASC"
        )

    def get_categories_paged(self, limit, offset):
        return self._get_paged_data(
            "SELECT id, name FROM categories", [], limit, offset, "ORDER BY id ASC"
        )

    def add_asset(self, d, op):
        conn = self.get_connection()
        c = conn.cursor()
        try:
            if not d.get("asset_no"):
                d["asset_no"] = f"ZC{datetime.datetime.now().strftime('%y%m%d%H%M%S')}"
            ks = ", ".join(d.keys())
            vs = ", ".join(["?"] * len(d))
            c.execute(f"INSERT INTO assets ({ks}) VALUES ({vs})", tuple(d.values()))
            new_id = c.lastrowid
            conn.commit()
            return new_id
        except Exception as e:
            logging.error(f"Add asset failed: {e}")
            conn.rollback()
            return None
        finally:
            conn.close()

    def populate_asset_components_from_category(self, asset_id, category_id):
        conn = self.get_connection()
        c = conn.cursor()
        try:
            # 1. 获取该分类下的所有配件模板项（包含 model_id 和型号名称）
            c.execute(
                """
                SELECT cc.id, cc.parent_id, cc.component_name, cc.default_quantity, cc.model_id, m.model_name
                FROM category_components cc
                LEFT JOIN component_models m ON cc.model_id = m.id
                WHERE cc.category_id = ?
            """,
                (category_id,),
            )
            templates = c.fetchall()

            if not templates:
                return True

            # 2. 按照父节点优先的顺序排序
            id_map = {}
            remaining = list(templates)
            while remaining:
                processed_in_this_round = 0
                for i in range(len(remaining) - 1, -1, -1):
                    t_id, t_pid, t_name, t_qty, t_mid, t_mname = remaining[i]

                    if t_pid is None or t_pid in id_map:
                        new_pid = id_map.get(t_pid)
                        spec = t_mname if t_mname else "未配置"
                        c.execute(
                            "INSERT INTO asset_components (asset_id, parent_id, comp_name, comp_spec, quantity, model_id) VALUES (?, ?, ?, ?, ?, ?)",
                            (asset_id, new_pid, t_name, spec, t_qty, t_mid),
                        )
                        id_map[t_id] = c.lastrowid
                        remaining.pop(i)
                        processed_in_this_round += 1

            # 3. 更新资产规格摘要 (简表显示)
            c.execute(
                "SELECT comp_name, comp_spec FROM asset_components WHERE asset_id=?",
                (asset_id,),
            )
            rows = c.fetchall()
            full_list = [
                f"{x[0]}: {x[1]}"
                for x in rows
                if x[1] and str(x[1]).strip() and x[1] != "待配置"
            ]
            if len(full_list) > 3:
                summary = " / ".join(full_list[:3]) + f" ... (共{len(full_list)}项)"
            else:
                summary = " / ".join(full_list)
            c.execute("UPDATE assets SET spec=? WHERE id=?", (summary, asset_id))

            conn.commit()
            return True
        except Exception as e:
            logging.error(f"Recursive populate asset components failed: {e}")
            conn.rollback()
            return False
        finally:
            conn.close()

    def update_asset(self, aid, d, op):
        conn = self.get_connection()
        c = conn.cursor()
        try:
            sets = ", ".join([f"{k}=?" for k in d.keys()])
            c.execute(
                f"UPDATE assets SET {sets} WHERE id=?", tuple(d.values()) + (aid,)
            )
            conn.commit()
            return True
        except:
            return False
        finally:
            conn.close()

    def change_asset_status(self, aid, ns, op, rem):
        conn = self.get_connection()
        c = conn.cursor()
        try:
            c.execute("SELECT name, asset_no, status FROM assets WHERE id=?", (aid,))
            aname, ano, old_st = c.fetchone()

            # 只要变为“闲置”、“维修”或“报废”，都自动断开使用人
            if ns in ["闲置", "维修", "报废"]:
                c.execute(
                    "UPDATE assets SET status=?, user_id=NULL WHERE id=?", (ns, aid)
                )
            else:
                c.execute("UPDATE assets SET status=? WHERE id=?", (ns, aid))

            self.log_action(
                op,
                "资产管理",
                "状态变更",
                f"将资产 {aname}({ano}) 状态变更为: {ns}, 备注: {rem}",
                cursor=c,
            )
            conn.commit()
            return True
        except Exception as e:
            logging.error(f"Status change failed: {e}")
            conn.rollback()
            return False
        finally:
            conn.close()

    def recycle_asset_components(self, aid, component_ids, op):
        """
        手动回收报废资产中的指定配件
        component_ids: 要回收的 asset_components 表的 ID 列表
        """
        conn = self.get_connection()
        c = conn.cursor()
        try:
            c.execute("SELECT name, asset_no FROM assets WHERE id=?", (aid,))
            aname, ano = c.fetchone()

            for acid in component_ids:
                c.execute(
                    "SELECT comp_name, model_id, quantity FROM asset_components WHERE id=?",
                    (acid,),
                )
                res = c.fetchone()
                if not res or not res[1]:
                    continue
                cname, mid, qty = res

                # 增加库存
                c.execute(
                    "UPDATE component_stock SET quantity = quantity + ? WHERE model_id = ?",
                    (qty, mid),
                )
                c.execute(
                    "INSERT INTO component_stock_logs (model_id, op_type, quantity, operator, remark) VALUES (?, '设备退库', ?, ?, ?)",
                    (mid, qty, op, f"报废资产配件回收: {aname}({ano})"),
                )

                # 从资产中移除该配件记录
                c.execute("DELETE FROM asset_components WHERE id=?", (acid,))

            # 更新资产摘要
            c.execute(
                "SELECT comp_name, comp_spec FROM asset_components WHERE asset_id=?",
                (aid,),
            )
            rows = c.fetchall()
            full_list = [f"{x[0]}: {x[1]}" for x in rows if x[1] and str(x[1]).strip()]
            summary = " / ".join(full_list[:3]) + (
                f" ... (共{len(full_list)}项)" if len(full_list) > 3 else ""
            )
            c.execute("UPDATE assets SET spec=? WHERE id=?", (summary, aid))

            self.log_action(
                op,
                "资产管理",
                "配件回收",
                f"回收了资产 {aname}({ano}) 的部分硬件配件",
                cursor=c,
            )
            conn.commit()
            return True
        except Exception as e:
            logging.error(f"Recycle failed: {e}")
            conn.rollback()
            return False
        finally:
            conn.close()

    def destroy_asset_completely(self, aid, op):
        """彻底销毁资产记录及其剩余配件"""
        conn = self.get_connection()
        c = conn.cursor()
        try:
            c.execute("SELECT name, asset_no FROM assets WHERE id=?", (aid,))
            aname, ano = c.fetchone()
            c.execute("DELETE FROM asset_components WHERE asset_id=?", (aid,))
            c.execute("DELETE FROM assets WHERE id=?", (aid,))
            c.execute(
                "INSERT INTO lifecycle_logs (asset_id, op_type, operator, remark) VALUES (?, '销毁', ?, '资产已彻底销毁并从库中移除')",
                (aid, op),
            )
            self.log_action(
                op,
                "资产管理",
                "资产销毁",
                f"彻底销毁了资产记录: {aname}({ano})",
                cursor=c,
            )
            conn.commit()
            return True
        except Exception as e:
            logging.error(f"Destroy failed: {e}")
            conn.rollback()
            return False
        finally:
            conn.close()

    def checkout_asset(self, aid, eid, op, rem):
        conn = self.get_connection()
        c = conn.cursor()
        try:
            # 1. 安全获取资产和员工名称用于日志
            c.execute("SELECT name, asset_no FROM assets WHERE id=?", (aid,))
            a_res = c.fetchone()
            c.execute("SELECT name FROM employees WHERE id=?", (eid,))
            e_res = c.fetchone()

            if not a_res or not e_res:
                return False, "操作失败：找不到对应的资产或员工信息。"

            aname, ano = a_res
            ename = e_res[0]

            # 2. 更新资产状态（配件库存已在配置时扣除，此处不再重复扣除）
            c.execute(
                "UPDATE assets SET status='在用', user_id=? WHERE id=?", (eid, aid)
            )
            c.execute(
                "INSERT INTO lifecycle_logs (asset_id, op_type, operator, target_user_id, remark) VALUES (?,'领用',?,?,?)",
                (aid, op, eid, rem),
            )

            # 先记录日志（不使用游标，独立提交）
            self.log_action(
                op,
                "资产管理",
                "分配领用",
                f"资产 {aname}({ano}) 分配给员工: {ename}",
                # 注意：这里不传递cursor参数，让log_action自己管理连接
            )
            conn.commit()
            return True, "成功"
        except Exception as e:
            logging.error(f"Checkout error: {e}")
            conn.rollback()
            return False, f"操作失败: {str(e)}"
        finally:
            conn.close()

    def return_asset(self, aid, op, rem):
        conn = self.get_connection()
        c = conn.cursor()
        try:
            # 1. 获取资产信息
            c.execute(
                "SELECT a.name, a.asset_no, a.user_id, e.name FROM assets a LEFT JOIN employees e ON a.user_id=e.id WHERE a.id=?",
                (aid,),
            )
            aname, ano, uid, ename = c.fetchone()

            # 2. 更新资产状态（配件保留在资产内，不自动退回仓库库存）
            c.execute(
                "UPDATE assets SET status='闲置', user_id=NULL WHERE id=?", (aid,)
            )
            c.execute(
                "INSERT INTO lifecycle_logs (asset_id, op_type, operator, target_user_id, remark) VALUES (?,'归还',?,?,?)",
                (aid, op, uid, rem),
            )

            self.log_action(
                op,
                "资产管理",
                "归还入库",
                f"资产 {aname}({ano}) 已归还为闲置状态。",
                cursor=c,
            )
            conn.commit()
            return True
        except Exception as e:
            logging.error(f"Return asset failed: {e}")
            conn.rollback()
            return False
        finally:
            conn.close()

    def get_system_logs(self, user="", module="", keyword="", limit=20, offset=0):
        sql = "SELECT op_date, operator, module, op_type, detail FROM system_logs WHERE 1=1"
        ps = []
        if user:
            sql += " AND operator LIKE ?"
            ps.append(f"%{user}%")
        if module and module != "全部":
            sql += " AND module=?"
            ps.append(module)
        if keyword:
            sql += " AND detail LIKE ?"
            ps.append(f"%{keyword}%")
        return self._get_paged_data(sql, ps, limit, offset, "ORDER BY op_date DESC")

    def get_config_history(self, keyword="", limit=20, offset=0):
        sql = "SELECT date, '资产', '变更', type, content FROM maintenance_records m JOIN assets a ON m.asset_id = a.id WHERE 1=1"
        ps = []
        if keyword:
            sql += " AND (a.asset_no LIKE ? OR a.name LIKE ?)"
            p = f"%{keyword}%"
            ps.extend([p, p])
        return self._get_paged_data(sql, ps, limit, offset, "ORDER BY date DESC")

    def get_asset_resume(self, aid):
        conn = self.get_connection()
        c = conn.cursor()
        c.execute(
            "SELECT op_date, op_type, operator, remark FROM lifecycle_logs WHERE asset_id=? ORDER BY op_date DESC",
            (aid,),
        )
        r = c.fetchall()
        conn.close()
        return r

    def get_assets_by_status(self, status):
        conn = self.get_connection()
        c = conn.cursor()
        c.execute(
            "SELECT id, name, asset_no, spec FROM assets WHERE status=?", (status,)
        )
        r = c.fetchall()
        conn.close()
        return r

    def get_assets_for_export(self):
        conn = self.get_connection()
        sql = "SELECT * FROM assets"
        df = pd.read_sql_query(sql, conn)
        conn.close()
        return df

    def add_admin(self, u, p):
        conn = self.get_connection()
        c = conn.cursor()
        c.execute(
            "INSERT INTO users (username, password, role) VALUES (?, ?, 'admin')",
            (u, p),
        )
        conn.commit()
        conn.close()
        return True

    def delete_admin(self, uid):
        conn = self.get_connection()
        c = conn.cursor()
        c.execute("DELETE FROM users WHERE id=?", (uid,))
        conn.commit()
        conn.close()
        return True

    def update_admin_password(self, uid, pwd):
        conn = self.get_connection()
        c = conn.cursor()
        c.execute("UPDATE users SET password=? WHERE id=?", (pwd, uid))
        conn.commit()
        conn.close()
        return True

    def update_admin(self, uid, u, r):
        conn = self.get_connection()
        c = conn.cursor()
        c.execute("UPDATE users SET username=?, role=? WHERE id=?", (u, r, uid))
        conn.commit()
        conn.close()
        return True

    def add_department(self, n):
        conn = self.get_connection()
        c = conn.cursor()
        c.execute("INSERT OR IGNORE INTO departments (name) VALUES (?)", (n,))
        conn.commit()
        conn.close()
        return True

    def delete_department(self, did):
        conn = self.get_connection()
        c = conn.cursor()
        c.execute("SELECT id FROM employees WHERE dept_id=?", (did,))
        if c.fetchone():
            conn.close()
            return False
        c.execute("DELETE FROM departments WHERE id=?", (did,))
        conn.commit()
        conn.close()
        return True

    def add_category(self, n):
        conn = self.get_connection()
        c = conn.cursor()
        c.execute("INSERT OR IGNORE INTO categories (name) VALUES (?)", (n,))
        conn.commit()
        conn.close()
        return True

    def delete_category(self, cid):
        conn = self.get_connection()
        c = conn.cursor()
        c.execute("SELECT id FROM assets WHERE category_id=?", (cid,))
        if c.fetchone():
            conn.close()
            return False
        c.execute("DELETE FROM categories WHERE id=?", (cid,))
        conn.commit()
        conn.close()
        return True

    def get_category_components(self, cid=None):
        conn = self.get_connection()
        c = conn.cursor()
        sql = """
            SELECT cc.id, cc.parent_id, cc.component_name, cc.default_quantity, cc.model_id, 
                   m.model_name, IFNULL(s.quantity, 0), cat.name as cat_name
            FROM category_components cc
            LEFT JOIN component_models m ON cc.model_id = m.id
            LEFT JOIN component_stock s ON m.id = s.model_id
            LEFT JOIN categories cat ON cc.category_id = cat.id
        """
        if cid:
            sql += " WHERE cc.category_id = ?"
            c.execute(sql, (cid,))
        else:
            c.execute(sql)
        r = c.fetchall()
        conn.close()
        return r

    def update_component_model(self, mid, t, m, b, cid):
        conn = self.get_connection()
        c = conn.cursor()
        try:
            c.execute(
                "UPDATE component_models SET type_name=?, model_name=?, brand=?, category_id=? WHERE id=?",
                (t, m, b, cid, mid),
            )
            conn.commit()
            return True
        except:
            return False
        finally:
            conn.close()

    def update_category_components(self, cid, components_data):
        conn = self.get_connection()
        c = conn.cursor()
        try:
            # 1. 彻底清除旧模板数据
            c.execute("DELETE FROM category_components WHERE category_id = ?", (cid,))
            # 2. 扁平化保存
            for item in components_data:
                c.execute(
                    "INSERT INTO category_components (category_id, component_name, default_quantity, model_id) VALUES (?, ?, ?, ?)",
                    (cid, item["name"], int(item["qty"]), item.get("model_id")),
                )
            # 获取分类名称
            c.execute("SELECT name FROM categories WHERE id = ?", (cid,))
            category_result = c.fetchone()
            category_name = (
                category_result[0] if category_result else f"未知分类(#{cid})"
            )

            self.log_action(
                "Admin",
                "分类设置",
                "模板修改",
                f"更新了分类 '{category_name}' (ID: {cid}) 的配件模板",
                cursor=c,
            )
            conn.commit()
            return True
        except Exception as e:
            logging.error(f"Failed to sync flat category components: {e}")
            conn.rollback()
            return False
        finally:
            conn.close()

    def get_models_by_category_and_type(self, category_id, type_name):
        conn = self.get_connection()
        c = conn.cursor()
        # 允许选择该分类下的型号，或者未绑定分类的通用型号
        c.execute(
            "SELECT id, model_name, brand FROM component_models WHERE (category_id = ? OR category_id IS NULL) AND type_name = ?",
            (category_id, type_name),
        )
        r = c.fetchall()
        conn.close()
        return r

    def get_all_component_types(self):
        conn = self.get_connection()
        c = conn.cursor()
        c.execute("SELECT DISTINCT type_name FROM component_models ORDER BY type_name")
        rows = c.fetchall()
        conn.close()
        return [row[0] for row in rows]

    def get_component_types_by_category(self, category_id):
        conn = self.get_connection()
        c = conn.cursor()
        # 严格模式：仅获取该分类下的配件类型，不进行全量兜底
        # 同时也包含那些没有绑定任何分类（通用）的配件类型
        c.execute(
            "SELECT DISTINCT type_name FROM component_models WHERE category_id = ? OR category_id IS NULL ORDER BY type_name",
            (category_id,),
        )
        rows = c.fetchall()
        conn.close()
        return [row[0] for row in rows]

    def delete_asset_component_recursive(self, component_id):
        conn = self.get_connection()
        c = conn.cursor()
        try:
            c.execute(
                """
                WITH RECURSIVE component_tree(id) AS (
                    SELECT ?
                    UNION ALL
                    SELECT ac.id FROM asset_components ac JOIN component_tree ct ON ac.parent_id = ct.id
                )
                DELETE FROM asset_components WHERE id IN (SELECT id FROM component_tree);
            """,
                (component_id,),
            )
            conn.commit()
            return True
        except Exception as e:
            logging.error(f"Failed to delete component recursively: {e}")
            conn.rollback()
            return False
        finally:
            conn.close()

    def sync_asset_components(self, asset_id, components_list):
        conn = self.get_connection()
        c = conn.cursor()
        try:
            # 0. 先获取资产信息
            c.execute(
                "SELECT name, asset_no, status FROM assets WHERE id = ?", (asset_id,)
            )
            a_res = c.fetchone()
            if not a_res:
                return False, "找不到资产"
            aname, ano, astatus = a_res

            # 获取变更前的详情用于生成详细日志
            c.execute(
                "SELECT model_id, quantity, comp_name, comp_spec FROM asset_components WHERE asset_id=?",
                (asset_id,),
            )
            old_rows = c.fetchall()
            old_details = {row[2]: (row[3], row[1]) for row in old_rows}

            # 1. 核心改进：精确库存平衡
            old_map = {}
            for row in old_rows:
                if row[0]:
                    old_map[row[0]] = old_map.get(row[0], 0) + row[1]

            new_map = {}
            for comp in components_list:
                mid = comp.get("model_id")
                if mid:
                    new_map[mid] = new_map.get(mid, 0) + int(comp.get("qty") or 1)

            for mid, new_qty in new_map.items():
                old_qty = old_map.get(mid, 0)
                if new_qty > old_qty:
                    needed = new_qty - old_qty
                    c.execute(
                        "SELECT quantity FROM component_stock WHERE model_id = ?",
                        (mid,),
                    )
                    res = c.fetchone()
                    current_stock = res[0] if res else 0
                    if current_stock < needed:
                        c.execute(
                            "SELECT model_name FROM component_models WHERE id = ?",
                            (mid,),
                        )
                        mname = c.fetchone()[0]
                        return False, f"库存不足：配件 [{mname}] 缺口 {needed} 个。"

            # b. 执行平衡操作
            for mid, qty in old_map.items():
                c.execute(
                    "UPDATE component_stock SET quantity = quantity + ? WHERE model_id = ?",
                    (qty, mid),
                )
                c.execute(
                    "INSERT INTO component_stock_logs (model_id, op_type, quantity, operator, remark) VALUES (?, '设备退库', ?, 'Admin', ?)",
                    (mid, qty, f"配置变更-旧件回收: {aname}({ano})"),
                )

            for mid, qty in new_map.items():
                c.execute(
                    "UPDATE component_stock SET quantity = quantity - ? WHERE model_id = ?",
                    (qty, mid),
                )
                c.execute(
                    "INSERT INTO component_stock_logs (model_id, op_type, quantity, operator, remark) VALUES (?, '设备领用', ?, 'Admin', ?)",
                    (mid, -qty, f"配置变更-新件领用: {aname}({ano})"),
                )

            # 2. 删除旧记录并重新插入
            c.execute("DELETE FROM asset_components WHERE asset_id = ?", (asset_id,))

            seen_types = set()
            new_details = {}
            for comp in components_list:
                cname = comp["name"]
                if cname in seen_types:
                    continue
                seen_types.add(cname)

                qty = int(comp.get("qty") or 1)
                c.execute(
                    "INSERT INTO asset_components (asset_id, comp_name, comp_spec, quantity, model_id) VALUES (?, ?, ?, ?, ?)",
                    (asset_id, cname, comp["spec"], qty, comp.get("model_id")),
                )
                new_details[cname] = (comp["spec"], qty)

            # 构建详细变更日志
            changes = []
            for name, (old_s, old_q) in old_details.items():
                if name not in new_details:
                    changes.append(f"移除[{name}]")
                else:
                    new_s, new_q = new_details[name]
                    if str(old_s) != str(new_s) or int(old_q) != int(new_q):
                        changes.append(
                            f"变更[{name}]: {old_s}(x{old_q}) -> {new_s}(x{new_q})"
                        )
            for name, (new_s, new_q) in new_details.items():
                if name not in old_details:
                    changes.append(f"新增[{name}]: {new_s}(x{new_q})")

            detail_log = " | ".join(changes) if changes else "无实质规格变化"

            # 3. 更新资产规格摘要
            c.execute(
                "SELECT comp_name, comp_spec FROM asset_components WHERE asset_id=?",
                (asset_id,),
            )
            rows = c.fetchall()
            full_list = [
                f"{x[0]}: {x[1]}"
                for x in rows
                if x[1] and str(x[1]).strip() and x[1] != "待配置"
            ]
            summary = " / ".join(full_list[:3]) + (
                f" ... (共{len(full_list)}项)" if len(full_list) > 3 else ""
            )
            c.execute("UPDATE assets SET spec=? WHERE id=?", (summary, asset_id))

            # 核心修复：同时写入资产履历表
            if changes:
                c.execute(
                    "INSERT INTO lifecycle_logs (asset_id, op_type, operator, remark) VALUES (?, '配置变更', ?, ?)",
                    (asset_id, "Admin", detail_log),
                )

            self.log_action(
                "Admin",
                "资产管理",
                "配置变更",
                f"资产 [{aname}({ano})] 变更详情: {detail_log}",
                cursor=c,
            )
            conn.commit()
            return True, "成功"
        except Exception as e:
            if conn:
                conn.rollback()
            logging.error(f"Sync asset components failed: {e}")
            return False, str(e)
        finally:
            if conn:
                conn.close()

    def get_asset_components(self, aid):
        conn = self.get_connection()
        c = conn.cursor()
        c.execute(
            "SELECT id, parent_id, comp_name, comp_spec, quantity FROM asset_components WHERE asset_id = ?",
            (aid,),
        )
        r = c.fetchall()
        conn.close()
        return r

    def get_asset_components_with_stock(self, aid):
        conn = self.get_connection()
        c = conn.cursor()
        c.execute(
            """
            SELECT ac.id, ac.parent_id, ac.comp_name, ac.comp_spec, ac.quantity, 
                   ac.model_id, m.model_name, IFNULL(s.quantity, 0)
            FROM asset_components ac
            LEFT JOIN component_models m ON ac.model_id = m.id
            LEFT JOIN component_stock s ON m.id = s.model_id
            WHERE ac.asset_id = ?
        """,
            (aid,),
        )
        r = c.fetchall()
        conn.close()
        return r

    def get_asset_stats_detailed(self):
        conn = self.get_connection()
        c = conn.cursor()
        c.execute("SELECT status, COUNT(*) FROM assets GROUP BY status")
        dist = dict(c.fetchall())
        sql = "SELECT c.name, COUNT(CASE WHEN a.status='闲置' THEN 1 END), COUNT(CASE WHEN a.status='在用' THEN 1 END), COUNT(CASE WHEN a.status='维修' THEN 1 END), COUNT(CASE WHEN a.status='报废' THEN 1 END) FROM categories c LEFT JOIN assets a ON c.id=a.category_id GROUP BY c.name"
        c.execute(sql)
        stats = c.fetchall()
        conn.close()
        return {"status_dist": dist, "category_stats": stats}

    def get_category_stock_stats(self):
        conn = self.get_connection()
        c = conn.cursor()
        c.execute(
            """
            SELECT c.name, SUM(IFNULL(s.quantity, 0)) 
            FROM categories c 
            LEFT JOIN component_models m ON c.id = m.category_id 
            LEFT JOIN component_stock s ON m.id = s.model_id 
            GROUP BY c.name
        """
        )
        r = c.fetchall()
        conn.close()
        return r

    def generate_emp_no(self):
        prefix = f"EMP{datetime.datetime.now().strftime('%Y%m%d')}"
        conn = self.get_connection()
        c = conn.cursor()
        c.execute(
            "SELECT emp_no FROM employees WHERE emp_no LIKE ? ORDER BY emp_no DESC LIMIT 1",
            (f"{prefix}%",),
        )
        r = c.fetchone()
        conn.close()
        return f"{prefix}{int(r[0][-4:])+1:04d}" if r else f"{prefix}0001"

    def generate_asset_no(self):
        prefix = f"ZC{datetime.datetime.now().strftime('%Y%m%d')}"
        conn = self.get_connection()
        c = conn.cursor()
        c.execute(
            "SELECT asset_no FROM assets WHERE asset_no LIKE ? ORDER BY asset_no DESC LIMIT 1",
            (f"{prefix}%",),
        )
        r = c.fetchone()
        conn.close()
        return f"{prefix}{int(r[0][-4:])+1:04d}" if r else f"{prefix}0001"

    def batch_import_assets(self, l, op):
        for d in l:
            self.add_asset(d, op)
        return len(l), []

    # ==================== 分类库存相关方法 ====================

    def initialize_category_stock(self, category_id, initial_quantity=100):
        """初始化分类库存"""
        conn = self.get_connection()
        c = conn.cursor()
        try:
            # 检查是否已存在
            c.execute(
                "SELECT id FROM category_stock WHERE category_id = ?", (category_id,)
            )
            if c.fetchone():
                # 如果存在则更新初始数量
                c.execute(
                    "UPDATE category_stock SET quantity = ?, last_update = CURRENT_TIMESTAMP WHERE category_id = ?",
                    (initial_quantity, category_id),
                )
            else:
                # 如果不存在则插入新记录
                c.execute(
                    "INSERT INTO category_stock (category_id, quantity) VALUES (?, ?)",
                    (category_id, initial_quantity),
                )

            # 获取分类名称
            c.execute("SELECT name FROM categories WHERE id = ?", (category_id,))
            category_result = c.fetchone()
            category_name = (
                category_result[0] if category_result else f"未知分类(#{category_id})"
            )

            self.log_action(
                "Admin",
                "库存管理",
                "分类库存初始化",
                f"初始化分类 '{category_name}' (ID: {category_id}) 的库存为 {initial_quantity}",
                cursor=c,
            )
            conn.commit()
            return True
        except Exception as e:
            logging.error(f"Initialize category stock failed: {e}")
            conn.rollback()
            return False
        finally:
            conn.close()

    def get_category_stock(self, category_id):
        """获取指定分类的库存数量"""
        conn = self.get_connection()
        c = conn.cursor()
        c.execute(
            "SELECT quantity FROM category_stock WHERE category_id = ?", (category_id,)
        )
        result = c.fetchone()
        conn.close()
        return result[0] if result else 0

    def check_category_stock_available(self, category_id):
        """检查分类库存是否充足（大于0）"""
        stock = self.get_category_stock(category_id)
        return stock > 0

    def add_category_stock(self, category_id, quantity=1, operator="Admin", remark=""):
        """增加分类库存"""
        conn = self.get_connection()
        c = conn.cursor()
        try:
            # 检查分类库存记录是否存在
            c.execute(
                "SELECT id, quantity FROM category_stock WHERE category_id = ?",
                (category_id,),
            )
            result = c.fetchone()

            if result:
                # 如果存在则增加库存
                current_qty = result[1]
                new_qty = current_qty + quantity
                c.execute(
                    "UPDATE category_stock SET quantity = ?, last_update = CURRENT_TIMESTAMP WHERE category_id = ?",
                    (new_qty, category_id),
                )
            else:
                # 如果不存在则创建新记录
                c.execute(
                    "INSERT INTO category_stock (category_id, quantity) VALUES (?, ?)",
                    (category_id, quantity),
                )

            # 获取分类名称
            c.execute("SELECT name FROM categories WHERE id = ?", (category_id,))
            category_result = c.fetchone()
            category_name = (
                category_result[0] if category_result else f"未知分类(#{category_id})"
            )

            # 记录操作日志
            c.execute(
                "INSERT INTO system_logs (operator, module, op_type, detail) VALUES (?, ?, ?, ?)",
                (
                    operator,
                    "库存管理",
                    "分类库存增加",
                    f"增加分类 '{category_name}' (ID: {category_id}) 库存 {quantity} 个。{remark}",
                ),
            )

            conn.commit()
            return True, "增加成功"
        except Exception as e:
            logging.error(f"Add category stock failed: {e}")
            conn.rollback()
            return False, f"增加失败: {str(e)}"
        finally:
            conn.close()

    def deduct_category_stock(
        self, category_id, quantity=1, operator="Admin", remark=""
    ):
        """扣减分类库存"""
        conn = self.get_connection()
        c = conn.cursor()
        try:
            # 检查库存是否充足
            current_stock = self.get_category_stock(category_id)
            if current_stock < quantity:
                return False, f"分类库存不足：当前库存 {current_stock}，需要 {quantity}"

            # 扣减库存
            c.execute(
                "UPDATE category_stock SET quantity = quantity - ?, last_update = CURRENT_TIMESTAMP WHERE category_id = ?",
                (quantity, category_id),
            )

            # 获取分类名称
            c.execute("SELECT name FROM categories WHERE id = ?", (category_id,))
            category_result = c.fetchone()
            category_name = (
                category_result[0] if category_result else f"未知分类(#{category_id})"
            )

            # 记录操作日志
            c.execute(
                "INSERT INTO system_logs (operator, module, op_type, detail) VALUES (?, ?, ?, ?)",
                (
                    operator,
                    "库存管理",
                    "分类库存扣减",
                    f"扣减分类 '{category_name}' (ID: {category_id}) 库存 {quantity} 个。{remark}",
                ),
            )

            conn.commit()
            return True, "扣减成功"
        except Exception as e:
            logging.error(f"Deduct category stock failed: {e}")
            conn.rollback()
            return False, f"扣减失败: {str(e)}"
        finally:
            conn.close()

    def get_all_category_stock_info(self):
        """获取所有分类的库存信息"""
        conn = self.get_connection()
        c = conn.cursor()
        c.execute(
            """
            SELECT c.id, c.name, COALESCE(cs.quantity, 0) as stock_quantity
            FROM categories c
            LEFT JOIN category_stock cs ON c.id = cs.category_id
            ORDER BY c.name
        """
        )
        result = c.fetchall()
        conn.close()
        return result

    def add_asset_with_category_stock_check(self, asset_data, operator):
        """添加资产时检查并扣减分类库存"""
        conn = self.get_connection()
        c = conn.cursor()
        try:
            category_id = asset_data.get("category_id")

            # 检查分类库存
            if not self.check_category_stock_available(category_id):
                return None, f"分类库存不足，无法创建该类型资产"

            # 生成资产编号
            if not asset_data.get("asset_no"):
                asset_data["asset_no"] = self.generate_asset_no()

            # 插入资产记录
            keys = ", ".join(asset_data.keys())
            placeholders = ", ".join(["?"] * len(asset_data))
            values = tuple(asset_data.values())

            c.execute(f"INSERT INTO assets ({keys}) VALUES ({placeholders})", values)
            new_asset_id = c.lastrowid

            # 获取分类名称
            c.execute("SELECT name FROM categories WHERE id = ?", (category_id,))
            category_result = c.fetchone()
            category_name = (
                category_result[0] if category_result else f"未知分类(#{category_id})"
            )

            # 检查库存是否充足
            c.execute(
                "SELECT quantity FROM category_stock WHERE category_id = ?",
                (category_id,),
            )
            result = c.fetchone()
            current_stock = result[0] if result else 0
            if current_stock < 1:
                conn.rollback()
                return None, f"分类库存不足：当前库存 {current_stock}，需要 1"

            # 扣减分类库存
            c.execute(
                "UPDATE category_stock SET quantity = quantity - ?, last_update = CURRENT_TIMESTAMP WHERE category_id = ?",
                (1, category_id),
            )

            # 记录库存扣减操作日志
            c.execute(
                "INSERT INTO system_logs (operator, module, op_type, detail) VALUES (?, ?, ?, ?)",
                (
                    operator,
                    "库存管理",
                    "分类库存扣减",
                    f"扣减分类 '{category_name}' (ID: {category_id}) 库存 1 个。用于创建资产 {asset_data['name']} (ID: {new_asset_id}) 属于分类 '{category_name}' (ID: {category_id})",
                ),
            )

            # 记录操作日志
            self.log_action(
                operator,
                "资产管理",
                "资产入库",
                f"创建资产 {asset_data['name']} (ID: {new_asset_id})，扣减分类 '{category_name}' (ID: {category_id}) 库存",
                cursor=c,
            )

            conn.commit()
            return new_asset_id, "创建成功"
        except Exception as e:
            logging.error(f"Add asset with category stock check failed: {e}")
            conn.rollback()
            return None, f"创建失败: {str(e)}"
        finally:
            conn.close()
