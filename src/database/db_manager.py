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
        conn = sqlite3.connect(self.db_path, timeout=10)
        conn.execute("PRAGMA journal_mode=WAL;")
        return conn

    def init_db(self):
        conn = self.get_connection(); c = conn.cursor()
        c.execute('CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE)')
        c.execute('CREATE TABLE IF NOT EXISTS departments (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE)')
        c.execute('''CREATE TABLE IF NOT EXISTS employees (id INTEGER PRIMARY KEY AUTOINCREMENT, emp_no TEXT UNIQUE, name TEXT NOT NULL, dept_id INTEGER, contact TEXT, status TEXT DEFAULT '在职', FOREIGN KEY (dept_id) REFERENCES departments (id))''')
        c.execute('''CREATE TABLE IF NOT EXISTS assets (id INTEGER PRIMARY KEY AUTOINCREMENT, asset_no TEXT UNIQUE, name TEXT NOT NULL, model TEXT, brand TEXT, spec TEXT, category_id INTEGER, dept_id INTEGER, user_id INTEGER, location TEXT, status TEXT DEFAULT '闲置', purchase_date DATE, remarks TEXT, FOREIGN KEY (category_id) REFERENCES categories (id), FOREIGN KEY (dept_id) REFERENCES departments (id), FOREIGN KEY (user_id) REFERENCES employees (id))''')
        c.execute('''CREATE TABLE IF NOT EXISTS category_components (id INTEGER PRIMARY KEY AUTOINCREMENT, category_id INTEGER, component_name TEXT, default_quantity INTEGER DEFAULT 1, FOREIGN KEY (category_id) REFERENCES categories (id))''')
        c.execute('''CREATE TABLE IF NOT EXISTS asset_components (id INTEGER PRIMARY KEY AUTOINCREMENT, asset_id INTEGER, comp_name TEXT, comp_spec TEXT, FOREIGN KEY (asset_id) REFERENCES assets (id))''')
        c.execute('''CREATE TABLE IF NOT EXISTS lifecycle_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, asset_id INTEGER, op_type TEXT, operator TEXT, target_user_id INTEGER, op_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP, remark TEXT)''')
        c.execute('''CREATE TABLE IF NOT EXISTS maintenance_records (id INTEGER PRIMARY KEY AUTOINCREMENT, asset_id INTEGER, type TEXT, content TEXT, date DATE)''')
        c.execute('''CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT, role TEXT)''')
        c.execute('''CREATE TABLE IF NOT EXISTS system_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, op_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP, operator TEXT, module TEXT, op_type TEXT, detail TEXT)''')
        c.execute('''CREATE TABLE IF NOT EXISTS component_models (id INTEGER PRIMARY KEY AUTOINCREMENT, type_name TEXT, model_name TEXT NOT NULL, brand TEXT, UNIQUE(type_name, model_name))''')
        c.execute('''CREATE TABLE IF NOT EXISTS component_stock (id INTEGER PRIMARY KEY AUTOINCREMENT, model_id INTEGER, quantity INTEGER DEFAULT 0, last_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (model_id) REFERENCES component_models (id))''')
        c.execute('''CREATE TABLE IF NOT EXISTS component_stock_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, model_id INTEGER, op_type TEXT, quantity INTEGER, operator TEXT, op_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP, remark TEXT, FOREIGN KEY (model_id) REFERENCES component_models (id))''')
        try: c.execute("ALTER TABLE category_components ADD COLUMN default_quantity INTEGER DEFAULT 1")
        except: pass
        self._insert_initial_data(c); conn.commit(); conn.close()

    def _insert_initial_data(self, c):
        c.execute("INSERT OR IGNORE INTO users (username, password, role) VALUES (?, ?, ?)", ('admin', 'admin123', 'super'))
        for cat in ['电脑', '服务器', '打印机']: c.execute("INSERT OR IGNORE INTO categories (name) VALUES (?)", (cat,))
        for dept in ['行政部', '技术部', '财务部']: c.execute("INSERT OR IGNORE INTO departments (name) VALUES (?)", (dept,))

    def log_action(self, op, mod, typ, det):
        conn = self.get_connection(); c = conn.cursor(); c.execute("INSERT INTO system_logs (operator, module, op_type, detail) VALUES (?,?,?,?)", (op, mod, typ, det)); conn.commit(); conn.close()

    def _get_paged_data(self, base_sql, params, limit, offset, order_by_clause=""):
        conn = self.get_connection(); c = conn.cursor()
        from_index = base_sql.upper().find("FROM")
        c.execute(f"SELECT COUNT(*) {base_sql[from_index:]}", params); total = c.fetchone()[0]
        c.execute(f"{base_sql} {order_by_clause} LIMIT ? OFFSET ?", list(params) + [limit, offset])
        rows = c.fetchall(); conn.close(); return total, rows

    def validate_user(self, u, p):
        conn = self.get_connection(); c = conn.cursor(); c.execute("SELECT * FROM users WHERE username=? AND password=?", (u, p)); r = c.fetchone(); conn.close(); return r is not None

    # --- 核心：带库存扣减的批量更新 ---
    def update_asset_components_batch(self, aid, components_list, op, change_type):
        """
        components_list: list of (comp_type, model_name, qty, model_id)
        """
        conn = self.get_connection(); c = conn.cursor()
        try:
            c.execute("SELECT name, asset_no FROM assets WHERE id=?", (aid,)); aname, ano = c.fetchone()
            for t_name, m_name, qty, mid in components_list:
                # 1. 记录旧规格
                c.execute("SELECT comp_spec FROM asset_components WHERE asset_id=? AND comp_name=?", (aid, t_name))
                old_res = c.fetchone(); old_spec = old_res[0] if old_res else "未配置"
                new_spec = f"{m_name}" # 简写
                
                if new_spec != old_spec:
                    # 2. 更新资产配件表
                    if old_res: c.execute("UPDATE asset_components SET comp_spec=? WHERE asset_id=? AND comp_name=?", (new_spec, aid, t_name))
                    else: c.execute("INSERT INTO asset_components (asset_id, comp_name, comp_spec) VALUES (?,?,?)", (aid, t_name, new_spec))
                    
                    # 3. 扣减库存 (如果是升级/维修)
                    if mid and change_type in ["配置升级", "维修替换"]:
                        c.execute("UPDATE component_stock SET quantity = quantity - ? WHERE model_id = ?", (qty, mid))
                        c.execute("INSERT INTO component_stock_logs (model_id, op_type, quantity, operator, remark) VALUES (?, '设备领用', ?, ?, ?)", 
                                   (mid, -qty, op, f"用于资产: {aname}({ano})"))
                    
                    # 4. 记录维护审计
                    c.execute("INSERT INTO maintenance_records (asset_id, type, content, date) VALUES (?, ?, ?, DATE('now'))", 
                               (aid, change_type, f"{t_name}: {old_spec} -> {new_spec}"))
            
            # 更新摘要
            c.execute("SELECT comp_name, comp_spec FROM asset_components WHERE asset_id=?", (aid,))
            summary = " / ".join([f"{x[0]}:{x[1]}" for x in c.fetchall() if x[1]])
            c.execute("UPDATE assets SET spec=? WHERE id=?", (summary, aid))
            conn.commit(); return True
        except Exception as e:
            logging.error(f"Batch Error: {e}"); conn.rollback(); return False
        finally: conn.close()

    def get_dashboard_stats(self):
        conn = self.get_connection(); c = conn.cursor(); r = {}
        c.execute("SELECT COUNT(*) FROM assets"); r['total_count'] = c.fetchone()[0]
        c.execute("SELECT COUNT(*) FROM assets WHERE status='在用'"); r['in_use_count'] = c.fetchone()[0]
        c.execute("SELECT COUNT(*) FROM assets WHERE status='闲置'"); r['idle_count'] = c.fetchone()[0]
        c.execute("SELECT COUNT(*) FROM assets WHERE status='维修'"); r['maintenance_count'] = c.fetchone()[0]
        conn.close(); return r

    def get_recent_activity(self, limit=10):
        conn = self.get_connection(); c = conn.cursor()
        c.execute('''SELECT l.op_date, l.op_type, a.name, e.name FROM lifecycle_logs l JOIN assets a ON l.asset_id = a.id 
                     LEFT JOIN employees e ON l.target_user_id = e.id ORDER BY l.op_date DESC LIMIT ?''', (limit,))
        r = c.fetchall(); conn.close(); return r

    def get_all_assets(self, kw="", did=None, limit=20, offset=0, order_col="id", order_dir="DESC"):
        mapping = {"id": "a.id", "asset_no": "a.asset_no", "name": "a.name", "status": "a.status"}
        sql = f'''SELECT a.id, a.asset_no, a.name, a.model, c.name, d.name, a.status, e.name, a.spec, a.purchase_date, a.category_id 
                 FROM assets a LEFT JOIN categories c ON a.category_id = c.id
                 LEFT JOIN departments d ON a.dept_id = d.id LEFT JOIN employees e ON a.user_id = e.id WHERE 1=1'''
        ps = []
        if kw: sql += " AND (a.name LIKE ? OR a.asset_no LIKE ? OR a.spec LIKE ?)"; p = f"%{kw}%"; ps.extend([p,p,p])
        if did: sql += " AND a.dept_id = ?"; ps.append(did)
        return self._get_paged_data(sql, ps, limit, offset, f"ORDER BY {mapping.get(order_col, 'a.id')} {order_dir}")

    def get_all_employees(self, kw="", did=None, status=None, limit=20, offset=0, order_col="id", order_dir="DESC"):
        mapping = {"id": "e.id", "name": "e.name", "status": "e.status"}
        sql = "SELECT e.id, e.emp_no, e.name, d.name, e.contact, e.status FROM employees e LEFT JOIN departments d ON e.dept_id = d.id WHERE 1=1"
        ps = []
        if kw: sql += " AND e.name LIKE ?"; ps.append(f"%{kw}%")
        if did: sql += " AND e.dept_id = ?"; ps.append(did)
        if status and status != "全部": sql += " AND e.status = ?"; ps.append(status)
        if limit is None:
            conn = self.get_connection(); c = conn.cursor(); c.execute(f"{sql} ORDER BY {mapping.get(order_col, 'e.id')} {order_dir}", ps); r = c.fetchall(); conn.close(); return r
        return self._get_paged_data(sql, ps, limit, offset, f"ORDER BY {mapping.get(order_col, 'e.id')} {order_dir}")

    def get_all_component_models(self, type_name=None):
        conn = self.get_connection(); c = conn.cursor()
        sql = "SELECT m.id, m.type_name, m.model_name, m.brand, IFNULL(s.quantity, 0) FROM component_models m LEFT JOIN component_stock s ON m.id = s.model_id"
        if type_name: c.execute(sql + " WHERE m.type_name = ?", (type_name,))
        else: c.execute(sql)
        r = c.fetchall(); conn.close(); return r

    def add_component_model(self, t, m, b):
        conn = self.get_connection(); c = conn.cursor()
        try:
            c.execute("INSERT INTO component_models (type_name, model_name, brand) VALUES (?,?,?)", (t, m, b))
            mid = c.lastrowid; c.execute("INSERT INTO component_stock (model_id, quantity) VALUES (?, 0)", (mid,)); conn.commit(); return True
        except: return False
        finally: conn.close()

    def add_component_stock(self, mid, qty, op, rem):
        conn = self.get_connection(); c = conn.cursor()
        try:
            c.execute("UPDATE component_stock SET quantity = quantity + ? WHERE model_id = ?", (qty, mid))
            c.execute("INSERT INTO component_stock_logs (model_id, op_type, quantity, operator, remark) VALUES (?, '采购入库', ?, ?, ?)", (mid, qty, op, rem))
            conn.commit(); return True
        except: return False
        finally: conn.close()

    def get_component_stock_logs(self, keyword=""):
        conn = self.get_connection(); c = conn.cursor()
        sql = "SELECT l.op_date, m.type_name, m.model_name, l.op_type, l.quantity, l.operator, l.remark FROM component_stock_logs l JOIN component_models m ON l.model_id = m.id ORDER BY l.op_date DESC"
        c.execute(sql); r = c.fetchall(); conn.close(); return r
    def get_model_stock(self, mid):
        conn = self.get_connection(); c = conn.cursor(); c.execute("SELECT quantity FROM component_stock WHERE model_id = ?", (mid,)); r = c.fetchone(); conn.close(); return r[0] if r else 0
    def get_departments(self):
        conn = self.get_connection(); c = conn.cursor(); c.execute("SELECT id, name FROM departments"); r = c.fetchall(); conn.close(); return r
    def get_categories(self):
        conn = self.get_connection(); c = conn.cursor(); c.execute("SELECT id, name FROM categories"); r = c.fetchall(); conn.close(); return r
    def get_all_admins(self):
        conn = self.get_connection(); c = conn.cursor(); c.execute("SELECT id, username, role FROM users"); r = c.fetchall(); conn.close(); return r
    def get_all_admins_paged(self, l, o): return self._get_paged_data("SELECT id, username, role FROM users", [], l, o, "ORDER BY id ASC")
    def get_departments_paged(self, l, o): return self._get_paged_data("SELECT id, name FROM departments", [], l, o, "ORDER BY id ASC")
    def get_categories_paged(self, l, o): return self._get_paged_data("SELECT id, name FROM categories", [], l, o, "ORDER BY id ASC")
    def add_asset(self, d, op):
        conn = self.get_connection(); c = conn.cursor()
        try:
            if not d.get('asset_no'): d['asset_no'] = f"ZC{datetime.datetime.now().strftime('%y%m%d%H%M%S')}"
            ks = ', '.join(d.keys()); vs = ', '.join(['?']*len(d)); c.execute(f"INSERT INTO assets ({ks}) VALUES ({vs})", tuple(d.values())); conn.commit(); return True
        except: return False
        finally: conn.close()
    def update_asset(self, aid, d, op):
        conn = self.get_connection(); c = conn.cursor()
        try:
            sets = ", ".join([f"{k}=?" for k in d.keys()]); c.execute(f"UPDATE assets SET {sets} WHERE id=?", tuple(d.values()) + (aid,)); conn.commit(); return True
        except: return False
        finally: conn.close()
    def change_asset_status(self, aid, ns, op, rem):
        conn = self.get_connection(); c = conn.cursor(); c.execute("UPDATE assets SET status=?, user_id=NULL WHERE id=?", (ns, aid)); conn.commit(); conn.close(); return True
    def checkout_asset(self, aid, eid, op, rem):
        conn = self.get_connection(); c = conn.cursor()
        try:
            c.execute("UPDATE assets SET status='在用', user_id=? WHERE id=?", (eid, aid)); c.execute("INSERT INTO lifecycle_logs (asset_id, op_type, operator, target_user_id, remark) VALUES (?,'领用',?,?,?)", (aid, op, eid, rem)); conn.commit(); return True
        except: return False
        finally: conn.close()
    def return_asset(self, aid, op, rem):
        conn = self.get_connection(); c = conn.cursor()
        try:
            c.execute("SELECT user_id FROM assets WHERE id=?", (aid,)); uid = c.fetchone()[0]; c.execute("UPDATE assets SET status='闲置', user_id=NULL WHERE id=?", (aid,)); c.execute("INSERT INTO lifecycle_logs (asset_id, op_type, operator, target_user_id, remark) VALUES (?,'归还',?,?,?)", (aid, op, uid, rem)); conn.commit(); return True
        except: return False
        finally: conn.close()
    def get_system_logs(self, u="", m="", k="", l=20, o=0):
        sql = "SELECT op_date, operator, module, op_type, detail FROM system_logs WHERE 1=1"
        ps = []
        if u: sql += " AND operator LIKE ?"; ps.append(f"%{u}%")
        if m and m != "全部": sql += " AND module=?"; ps.append(m)
        if k: sql += " AND detail LIKE ?"; ps.append(f"%{k}%")
        return self._get_paged_data(sql, ps, l, o, "ORDER BY op_date DESC")
    def get_config_history(self, k="", l=20, o=0):
        sql = "SELECT date, '资产', '变更', type, content FROM maintenance_records m JOIN assets a ON m.asset_id = a.id WHERE 1=1"
        ps = []
        if k: sql += " AND (a.asset_no LIKE ? OR a.name LIKE ?)"; p = f"%{k}%"; ps.extend([p, p])
        return self._get_paged_data(sql, ps, l, o, "ORDER BY date DESC")
    def get_asset_resume(self, aid):
        conn = self.get_connection(); c = conn.cursor(); c.execute("SELECT op_date, op_type, operator, remark FROM lifecycle_logs WHERE asset_id=? ORDER BY op_date DESC", (aid,)); r = c.fetchall(); conn.close(); return r
    def get_assets_for_export(self):
        conn = self.get_connection(); sql = "SELECT * FROM assets"; df = pd.read_sql_query(sql, conn); conn.close(); return df
    def add_admin(self, u, p):
        conn = self.get_connection(); c = conn.cursor(); c.execute("INSERT INTO users (username, password, role) VALUES (?, ?, 'admin')", (u, p)); conn.commit(); conn.close(); return True
    def delete_admin(self, uid):
        conn = self.get_connection(); c = conn.cursor(); c.execute("DELETE FROM users WHERE id=?", (uid,)); conn.commit(); conn.close(); return True
    def update_admin_password(self, uid, pwd):
        conn = self.get_connection(); c = conn.cursor(); c.execute("UPDATE users SET password=? WHERE id=?", (pwd, uid)); conn.commit(); conn.close(); return True
    def update_admin(self, uid, u, r):
        conn = self.get_connection(); c = conn.cursor(); c.execute("UPDATE users SET username=?, role=? WHERE id=?", (u, r, uid)); conn.commit(); conn.close(); return True
    def add_department(self, n):
        conn = self.get_connection(); c = conn.cursor(); c.execute("INSERT OR IGNORE INTO departments (name) VALUES (?)", (n,)); conn.commit(); conn.close(); return True
    def delete_department(self, did):
        conn = self.get_connection(); c = conn.cursor(); c.execute("SELECT id FROM employees WHERE dept_id=?", (did,)); 
        if c.fetchone(): conn.close(); return False
        c.execute("DELETE FROM departments WHERE id=?", (did,)); conn.commit(); conn.close(); return True
    def add_category(self, n):
        conn = self.get_connection(); c = conn.cursor(); c.execute("INSERT OR IGNORE INTO categories (name) VALUES (?)", (n,)); conn.commit(); conn.close(); return True
    def delete_category(self, cid):
        conn = self.get_connection(); c = conn.cursor(); c.execute("SELECT id FROM assets WHERE category_id=?", (cid,));
        if c.fetchone(): conn.close(); return False
        c.execute("DELETE FROM categories WHERE id=?", (cid,)); conn.commit(); conn.close(); return True
    def get_category_components(self, cid):
        conn = self.get_connection(); c = conn.cursor(); c.execute("SELECT component_name, default_quantity FROM category_components WHERE category_id = ?", (cid,)); r = c.fetchall(); conn.close(); return r
    def update_category_components(self, cid, data):
        conn = self.get_connection(); c = conn.cursor()
        try:
            c.execute("DELETE FROM category_components WHERE category_id = ?", (cid,))
            for n, q in data: c.execute("INSERT INTO category_components (category_id, component_name, default_quantity) VALUES (?, ?, ?)", (cid, n, q))
            conn.commit(); return True
        except: return False
        finally: conn.close()
    def get_asset_components(self, aid):
        conn = self.get_connection(); c = conn.cursor(); c.execute("SELECT comp_name, comp_spec FROM asset_components WHERE asset_id = ?", (aid,)); r = c.fetchall(); conn.close(); return r
    def get_asset_stats_detailed(self):
        conn = self.get_connection(); c = conn.cursor(); c.execute("SELECT status, COUNT(*) FROM assets GROUP BY status"); dist = dict(c.fetchall())
        sql = "SELECT c.name, COUNT(CASE WHEN a.status='闲置' THEN 1 END), COUNT(CASE WHEN a.status='在用' THEN 1 END), COUNT(CASE WHEN a.status='维修' THEN 1 END), COUNT(CASE WHEN a.status='报废' THEN 1 END) FROM categories c LEFT JOIN assets a ON c.id=a.category_id GROUP BY c.name"
        c.execute(sql); stats = c.fetchall(); conn.close(); return {"status_dist": dist, "category_stats": stats}
    def generate_emp_no(self):
        prefix = f"EMP{datetime.datetime.now().strftime('%Y%m%d')}"
        conn = self.get_connection(); c = conn.cursor(); c.execute("SELECT emp_no FROM employees WHERE emp_no LIKE ? ORDER BY emp_no DESC LIMIT 1", (f"{prefix}%",)); r = c.fetchone(); conn.close()
        return f"{prefix}{int(r[0][-4:])+1:04d}" if r else f"{prefix}0001"
    def batch_import_assets(self, l, op):
        for d in l: self.add_asset(d, op)
        return len(l), []