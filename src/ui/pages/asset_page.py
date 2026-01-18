import datetime
import pandas as pd
import sqlite3
import os
from PySide6.QtWidgets import (QWidget, QVBoxLayout, QHBoxLayout, QPushButton, 
                               QTableView, QLineEdit, QHeaderView, QDialog, QLabel, 
                               QComboBox, QFormLayout, QDateEdit, QFileDialog, QMessageBox,
                               QAbstractItemView, QStyledItemDelegate, QStyleOptionButton, QStyle, QApplication, QTextEdit, QItemDelegate)
from PySide6.QtCore import Qt, QDate, QAbstractTableModel, QModelIndex, QTimer, QRect
from PySide6.QtGui import QStandardItemModel, QStandardItem, QIcon, QColor, QPixmap, QFont

from src.database.db_manager import DBManager
from src.utils.qr_generator import QRGenerator
from src.utils.pagination import PaginationWidget

# --- 核心改进：配件型号下拉代理 ---
class ComponentModelDelegate(QItemDelegate):
    def __init__(self, db, parent=None):
        super().__init__(parent); self.db = db
    def createEditor(self, parent, option, index):
        if index.column() == 1: # 型号列
            type_name = index.model().data(index.model().index(index.row(), 0))
            models = self.db.get_all_component_models(type_name)
            cb = QComboBox(parent)
            cb.addItem("请选择型号...", None)
            for mid, _, mname, brand, stock in models:
                cb.addItem(f"{mname} ({brand}) - 库存:{stock}", mid)
            return cb
        if index.column() == 2: # 数量列
            cb = QComboBox(parent)
            # 获取当前行选中的型号 ID
            mid = index.model().index(index.row(), 1).data(Qt.UserRole)
            stock = self.db.get_model_stock(mid) if mid else 0
            for i in range(1, stock + 1): cb.addItem(str(i), i)
            return cb
        return super().createEditor(parent, option, index)
    
    def setEditorData(self, editor, index):
        if isinstance(editor, QComboBox):
            cur_text = index.data(Qt.DisplayRole)
            idx = editor.findText(cur_text)
            if idx >= 0: editor.setCurrentIndex(idx)
        else: super().setEditorData(editor, index)

    def setModelData(self, editor, model, index):
        if isinstance(editor, QComboBox):
            model.setData(index, editor.currentText(), Qt.DisplayRole)
            model.setData(index, editor.currentData(), Qt.UserRole)
        else: super().setModelData(editor, model, index)

class ButtonDelegate(QStyledItemDelegate):
    def __init__(self, parent=None): super().__init__(parent)
    def paint(self, painter, option, index):
        if index.column() == 9:
            btn = QStyleOptionButton()
            btn.rect = QRect(option.rect.left()+10, option.rect.top()+10, option.rect.width()-20, option.rect.height()-20)
            btn.text = "配置与升级"; btn.state = QStyle.State_Enabled
            QApplication.style().drawControl(QStyle.CE_PushButton, btn, painter)
        else: super().paint(painter, option, index)

class AssetTableModel(QAbstractTableModel):
    def __init__(self, data=None, headers=None): super().__init__(); self._data = data or []; self._headers = headers or []
    def rowCount(self, p=QModelIndex()): return len(self._data)
    def columnCount(self, p=QModelIndex()): return len(self._headers)
    def data(self, index, role=Qt.DisplayRole):
        if not index.isValid(): return None
        r = self._data[index.row()]; c = index.column()
        if role == Qt.DisplayRole: return "" if c == 9 else (str(r[c]) if r[c] is not None else "-")
        if role == Qt.TextAlignmentRole: return Qt.AlignCenter
        if role == Qt.ForegroundRole and c == 6:
            st = str(r[6]); 
            if st == "在用": return QColor("#1890ff")
            if st == "闲置": return QColor("#52c41a")
            if st == "维修": return QColor("#fa8c16")
            if st == "报废": return QColor("#f5222d")
        if role == Qt.FontRole and c == 6:
            f = QFont(); f.setBold(True); return f
        return None
    def headerData(self, s, o, role=Qt.DisplayRole):
        if role == Qt.DisplayRole and o == Qt.Horizontal: return self._headers[s]
        return None
    def update_data(self, d): self.beginResetModel(); self._data = d; self.endResetModel()

class AssetPage(QWidget):
    def __init__(self): 
        super().__init__(); self.db = DBManager(); self.offset = 0; self.init_ui(); self.load_data()

    def init_ui(self):
        layout = QVBoxLayout(self); layout.setContentsMargins(20, 20, 20, 20); layout.setSpacing(15)
        toolbar = QHBoxLayout(); toolbar.setSpacing(10)
        self.s = QLineEdit(); self.s.setPlaceholderText("🔍 全局搜索资产..."); self.s.setFixedWidth(200); self.s.textChanged.connect(self.on_search_changed)
        self.d = QComboBox(); self.d.addItem("全部部门", None)
        for did, n in self.db.get_departments(): self.d.addItem(n, did)
        self.d.currentIndexChanged.connect(self.on_search_changed)
        
        btn_cfg = [
            ("📋 资产履历", self.open_history), ("📥 数据导出", self.open_export), 
            ("✏️ 编辑基础信息", self.open_edit), ("🛠️ 报废/维修", self.open_status), 
            ("🔄 领用分配", self.open_assign), ("🔳 打印标签", self.open_qr), ("+ 新增入库", self.open_add)
        ]
        toolbar.addWidget(self.s); toolbar.addWidget(self.d); toolbar.addStretch()
        for text, func in btn_cfg:
            btn = QPushButton(text); btn.clicked.connect(func)
            if "+" in text: btn.setStyleSheet("background-color: #52c41a; color: white; font-weight: bold; padding: 10px 15px;")
            elif "分配" in text: btn.setStyleSheet("background-color: #1890ff; color: white; font-weight: bold; padding: 10px 15px;")
            else: btn.setStyleSheet("padding: 10px 12px;")
            toolbar.addWidget(btn)
        layout.addLayout(toolbar)

        self.table = QTableView(); self.table.setSelectionBehavior(QAbstractItemView.SelectRows); self.table.setAlternatingRowColors(True)
        self.table.setSelectionMode(QAbstractItemView.SingleSelection); self.table.verticalHeader().setVisible(False)
        self.table.verticalHeader().setDefaultSectionSize(60); self.table.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        self.table.setItemDelegateForColumn(9, ButtonDelegate(self.table))
        self.headers = ["ID", "编号", "名称", "型号", "分类", "部门", "状态", "使用人", "硬件配置摘要", "操作"]
        self.model = AssetTableModel(headers=self.headers); self.table.setModel(self.model)
        self.table.clicked.connect(self.on_click); self.table.doubleClicked.connect(self.open_edit)
        layout.addWidget(self.table)
        self.pagination = PaginationWidget(page_size=20); self.pagination.page_changed.connect(self.on_page_changed); layout.addWidget(self.pagination)

    def load_data(self):
        sel_aid = None; idx = self.table.currentIndex()
        if idx.isValid() and idx.row() < len(self.model._data): sel_aid = self.model._data[idx.row()][0]
        total, rows = self.db.get_all_assets(self.s.text(), self.d.currentData(), limit=20, offset=self.offset)
        processed = [list(r[:9]) + ["", r[10]] for r in rows]; self.model.update_data(processed)
        self.pagination.update_stats(total)
        if sel_aid:
            for r in range(len(self.model._data)):
                if self.model._data[r][0] == sel_aid: self.table.selectRow(r); break

    def on_click(self, idx):
        if idx.column() in [8, 9]:
            r = self.model._data[idx.row()]
            ComponentManageDialog(r[0], r[2], r[10], self).exec(); self.load_data()

    def open_assign(self):
        idx = self.table.currentIndex()
        if not idx.isValid(): QMessageBox.warning(self, "提示", "请先在列表中选择一个闲置资产。"); return
        r = self.model._data[idx.row()]
        if r[6] != "闲置": QMessageBox.warning(self, "禁止分配", f"当前资产状态为[{r[6]}]，无法分配。"); return
        if DirectAssignDialog(r[0], r[2], r[1], self).exec(): self.load_data()

    def on_search_changed(self): self.offset = 0; self.pagination.reset(); self.load_data()
    def on_page_changed(self, offset): self.offset = offset; self.load_data()
    def open_add(self):
        if AddAssetDialog(self).exec(): self.load_data()
    def open_edit(self):
        idx = self.table.currentIndex()
        if idx.isValid():
            aid = self.model._data[idx.row()][0]
            conn = self.db.get_connection(); c = conn.cursor(); c.execute("SELECT * FROM assets WHERE id=?", (aid,)); data = c.fetchone(); conn.close()
            if EditAssetDialog(data, self).exec(): self.load_data()
    def open_status(self):
        idx = self.table.currentIndex()
        if idx.isValid():
            r = self.model._data[idx.row()]
            if StatusChangeDialog(r[0], r[2], r[6], self).exec(): self.load_data()
    def open_history(self):
        idx = self.table.currentIndex()
        if idx.isValid(): AssetHistoryDialog(self.model._data[idx.row()][0], self.model._data[idx.row()][2], self).exec()
    def open_qr(self):
        idx = self.table.currentIndex()
        if idx.isValid():
            aid = self.model._data[idx.row()][0]
            conn = self.db.get_connection(); conn.row_factory = sqlite3.Row; c = conn.cursor()
            c.execute("SELECT a.asset_no, a.name, a.status, a.spec, d.name as dept FROM assets a LEFT JOIN departments d ON a.dept_id=d.id WHERE a.id=?", (aid,))
            data = dict(c.fetchone()); conn.close(); AssetQRDialog(data, self).exec()
    def open_export(self):
        p, _ = QFileDialog.getSaveFileName(self, "导出档案", "资产档案.xlsx", "Excel Files (*.xlsx)")
        if p: self.db.get_assets_for_export().to_excel(p, index=False)
    def refresh_data(self): self.load_data()

# --- 核心重构：支持型号下拉与库存查询的配件管理 ---
class ComponentManageDialog(QDialog):
    def __init__(self, aid, name, cid, parent=None):
        super().__init__(parent); self.aid = aid; self.cid = cid; self.db = DBManager()
        self.setWindowTitle(f"配件升降级与维护 - {name}"); self.resize(850, 650); self.init_ui()
    def init_ui(self):
        l = QVBoxLayout(self); l.setContentsMargins(30,30,30,30); l.setSpacing(20)
        h = QHBoxLayout(); h.addWidget(QLabel("变更性质:")); self.type_cb = QComboBox()
        self.type_cb.addItems(["配置升级", "配置降级", "维修替换", "初始录入"]); h.addWidget(self.type_cb); h.addStretch()
        l.addLayout(h)

        self.t = QTableView(); self.t.setAlternatingRowColors(True); self.t.verticalHeader().setVisible(False)
        self.m = QStandardItemModel(); self.m.setHorizontalHeaderLabels(["配件类型", "具体型号(下拉选择)", "数量(基于库存)"])
        self.t.setModel(self.m); self.t.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        
        # 应用下拉代理
        self.t.setItemDelegate(ComponentModelDelegate(self.db, self.t))
        self.t.setEditTriggers(QAbstractItemView.CurrentChanged | QAbstractItemView.SelectedClicked)
        l.addWidget(self.t)
        
        cur = self.db.get_asset_components(self.aid); tpl = self.db.get_category_components(self.cid)
        if not cur:
            for n, q in tpl: self.m.appendRow([QStandardItem(n), QStandardItem("请选择型号..."), QStandardItem(str(q))])
        else:
            for n, s in cur: self.m.appendRow([QStandardItem(n), QStandardItem(s), QStandardItem("1")])
        
        for r in range(self.m.rowCount()):
            for c in range(3): self.m.item(r, c).setTextAlignment(Qt.AlignCenter)

        btn = QPushButton("💾 确认变更并扣减/更新库存"); btn.setFixedHeight(55); btn.setStyleSheet("background-color: #1890ff; color: white; font-weight: bold; font-size: 16px;")
        btn.clicked.connect(self.save); l.addWidget(btn)
        l.addWidget(QLabel("提示：双击'型号'和'数量'列可开启下拉框；内容已自动居中。"))

    def save(self):
        change_type = self.type_cb.currentText()
        data_to_update = []
        
        for r in range(self.m.rowCount()):
            t_item = self.m.item(r, 0)
            m_item = self.m.item(r, 1)
            q_item = self.m.item(r, 2)
            
            if m_item and "请选择" not in m_item.text():
                # 提取数据：(配件名, 型号名, 数量, 型号ID)
                t_name = t_item.text()
                m_name = m_item.text().split(" (")[0] # 去掉库存提示文字
                qty = int(q_item.text())
                mid = m_item.data(Qt.UserRole) # 之前在代理中存入的 ID
                data_to_update.append((t_name, m_name, qty, mid))
        
        if not data_to_update:
            self.reject(); return

        if self.db.update_asset_components_batch(self.aid, data_to_update, "Admin", change_type):
            QMessageBox.information(self, "成功", "硬件配置已更新，相关配件库存已自动扣减并记录流水。")
            self.accept()
        else:
            QMessageBox.critical(self, "错误", "保存失败，可能是库存不足或数据库错误。")

class DirectAssignDialog(QDialog):
    def __init__(self, aid, name, no, parent=None):
        super().__init__(parent); self.aid = aid; self.db = DBManager(); self.setWindowTitle(f"分配资产 - {name}"); self.resize(500, 400); self.init_ui()
    def init_ui(self):
        l = QVBoxLayout(self); l.setContentsMargins(40,40,40,40); f = QFormLayout(); f.setSpacing(30)
        self.e_cb = QComboBox(); [self.e_cb.addItem(f"{r[2]} ({r[3]})", r[0]) for r in self.db.get_all_employees(status="在职", limit=None)]
        self.rem = QTextEdit(); self.rem.setFixedHeight(100); f.addRow("领用人员:", self.e_cb); f.addRow("备注说明:", self.rem); l.addLayout(f)
        btn = QPushButton("确认分配"); btn.setFixedHeight(50); btn.setStyleSheet("background-color: #1890ff; color: white; font-weight: bold;")
        btn.clicked.connect(self.save); l.addWidget(btn)
    def save(self):
        if self.db.checkout_asset(self.aid, self.e_cb.currentData(), "Admin", self.rem.toPlainText()): self.accept()

class EditAssetDialog(QDialog):
    def __init__(self, data, parent=None):
        super().__init__(parent); self.aid = data[0]; self.setWindowTitle("编辑资产详细档案"); self.resize(800, 600); self.db = DBManager(); self.init_ui(data)
    def init_ui(self, data):
        l = QVBoxLayout(self); f = QFormLayout(); f.setSpacing(30); f.setContentsMargins(50,50,50,50)
        self.n = QLineEdit(str(data[2])); self.m = QLineEdit(str(data[3])); self.l = QLineEdit(str(data[10])); self.r = QTextEdit(str(data[14] or ""))
        f.addRow("设备名称*:", self.n); f.addRow("型号规格:", self.m); f.addRow("物理存放地点:", self.l); f.addRow("详细备注信息:", self.r)
        l.addLayout(f); b = QPushButton("💾 确认保存修改"); b.setFixedHeight(55); b.setStyleSheet("background-color: #1890ff; color: white; font-weight: bold; font-size: 16px;"); b.clicked.connect(self.save); l.addWidget(b)
    def save(self):
        if self.db.update_asset(self.aid, {"name": self.n.text(), "model": self.m.text(), "location": self.l.text(), "remarks": self.r.toPlainText()}, "Admin"): self.accept()

class AddAssetDialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent); self.db = DBManager(); self.setWindowTitle("资产入库登记"); self.resize(700, 600); self.init_ui()
    def init_ui(self):
        l = QVBoxLayout(self); f = QFormLayout(); f.setSpacing(25); f.setContentsMargins(40,40,40,40)
        self.no = QLineEdit(); self.name = QLineEdit(); self.cat = QComboBox()
        for cid, n in self.db.get_categories(): self.cat.addItem(n, cid)
        self.dept = QComboBox(); [self.dept.addItem(n, i) for i, n in self.db.get_departments()]
        f.addRow("资产编号:", self.no); f.addRow("设备名称*:", self.name); f.addRow("所属分类:", self.cat); f.addRow("归属部门:", self.dept)
        l.addLayout(f); b = QPushButton("✅ 确认入库并生成档案"); b.setFixedHeight(50); b.setStyleSheet("background-color: #52c41a; color: white; font-weight: bold;"); b.clicked.connect(self.save); l.addWidget(b)
    def save(self):
        if self.name.text() and self.db.add_asset({"asset_no": self.no.text(), "name": self.name.text(), "category_id": self.cat.currentData(), "dept_id": self.dept.currentData(), "status": "闲置"}, "Admin"): self.accept()

class AssetHistoryDialog(QDialog):
    def __init__(self, aid, name, parent=None):
        super().__init__(parent); self.setWindowTitle(f"流转审计履历 - {name}"); self.resize(800, 500); self.db = DBManager()
        l = QVBoxLayout(self); t = QTableView(); t.verticalHeader().setVisible(False); t.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch); m = QStandardItemModel(); m.setHorizontalHeaderLabels(["时间", "动作", "操作员", "相关人"]); t.setModel(m); l.addWidget(t)
        for r in self.db.get_asset_resume(aid): m.appendRow([QStandardItem(str(x)) for x in r])

class StatusChangeDialog(QDialog):
    def __init__(self, aid, name, cur_st, parent=None):
        super().__init__(parent); self.aid = aid; self.db = DBManager(); self.setWindowTitle("状态手动变更"); self.resize(500, 400); self.init_ui(cur_st)
    def init_ui(self, cur_st):
        l = QVBoxLayout(self); l.setContentsMargins(40,40,40,40); f = QFormLayout(); f.setSpacing(30); self.cb = QComboBox(); self.cb.addItems(["闲置", "维修", "报废"])
        self.cb.setCurrentText(cur_st if cur_st != "在用" else "闲置"); self.rem = QTextEdit(); f.addRow("目标状态:", self.cb); f.addRow("变更原因:", self.rem); l.addLayout(f); btn = QPushButton("提交变更"); btn.setFixedHeight(50); btn.clicked.connect(self.save); l.addWidget(btn)
    def save(self):
        if self.db.change_asset_status(self.aid, self.cb.currentText(), "Admin", self.rem.toPlainText()): self.accept()

class AssetQRDialog(QDialog):
    def __init__(self, d, parent=None):
        super().__init__(parent); self.setWindowTitle("资产标签预览"); self.resize(650, 400); label_img = QRGenerator.generate_asset_label(d)
        l = QVBoxLayout(self); l.setAlignment(Qt.AlignCenter); pix = QPixmap(); pix.loadFromData(QRGenerator.save_to_bytes(label_img))
        lbl = QLabel(); lbl.setPixmap(pix); l.addWidget(lbl)