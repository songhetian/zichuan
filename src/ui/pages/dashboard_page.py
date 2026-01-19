from PySide6.QtWidgets import (
    QWidget,
    QVBoxLayout,
    QHBoxLayout,
    QLabel,
    QFrame,
    QPushButton,
    QListWidget,
    QListWidgetItem,
    QProgressBar,
    QGridLayout,
    QGraphicsDropShadowEffect,
    QTableWidget,
    QTableWidgetItem,
    QHeaderView,
)

# 移除matplotlib相关导入，因为我们使用表格而非图表显示
from PySide6.QtCore import Qt, Signal, QSize
from PySide6.QtGui import QColor, QFont, QBrush

from src.database.db_manager import DBManager


class ModernStatCard(QFrame):
    def __init__(self, title, value="0", sub_text="", color="#1890ff"):
        super().__init__()
        self.setObjectName("StatCard")
        self.setFixedHeight(140)

        # 阴影效果
        shadow = QGraphicsDropShadowEffect(self)
        shadow.setBlurRadius(20)
        shadow.setXOffset(0)
        shadow.setYOffset(4)
        shadow.setColor(QColor(0, 0, 0, 15))
        self.setGraphicsEffect(shadow)

        self.setStyleSheet(
            f"""
            QFrame#StatCard {{
                background-color: #fafafa;
                border-radius: 12px;
                border: 1px solid #f0f0f0;
            }}
            QFrame#StatCard:hover {{
                background-color: white;
                border: 1px solid {color};
            }}
        """
        )

        layout = QVBoxLayout(self)
        layout.setContentsMargins(24, 24, 24, 24)

        # 顶部：图标 + 标题
        top_layout = QHBoxLayout()

        title_label = QLabel(title)
        title_label.setStyleSheet(
            "color: #8c8c8c; font-size: 14px; font-weight: 500; background: transparent;"
        )

        top_layout.addWidget(title_label)
        top_layout.addStretch()
        layout.addLayout(top_layout)

        layout.addStretch()

        # 中部：数值
        self.value_label = QLabel(str(value))
        self.value_label.setStyleSheet(
            f"color: #262626; font-size: 36px; font-weight: bold; font-family: 'Segoe UI', 'Microsoft YaHei'; background: transparent;"
        )
        layout.addWidget(self.value_label)

        # 底部：描述文本
        self.sub_label = QLabel(sub_text)
        self.sub_label.setStyleSheet(
            "color: #8c8c8c; font-size: 12px; margin-top: 4px; background: transparent;"
        )
        layout.addWidget(self.sub_label)

    def update_data(self, value, sub_text=None):
        self.value_label.setText(str(value))
        if sub_text:
            self.sub_label.setText(sub_text)


class CategoryDistItem(QWidget):
    """单行分类分布，包含状态明细 - 改进版"""

    def __init__(self, name, counts, total, color="#1890ff"):
        super().__init__()
        # counts: (total, idle, in_use, repair, scrap)
        t_count, idle, in_use, repair, scrap = counts

        layout = QHBoxLayout(self)  # 改为水平布局
        layout.setContentsMargins(10, 8, 10, 8)
        layout.setSpacing(15)

        # 左侧：分类名称和总计
        left_layout = QVBoxLayout()
        left_layout.setSpacing(5)

        name_lbl = QLabel(name)
        name_lbl.setStyleSheet(
            "font-weight: bold; color: #262626; font-size: 14px;"
        )  # 增大字体

        percent = (t_count / total * 100) if total > 0 else 0
        val_lbl = QLabel(f"共 {t_count} 项 ({percent:.1f}%)")
        val_lbl.setStyleSheet(
            "color: #8c8c8c; font-size: 13px; font-weight: 500;"
        )  # 增大字体

        left_layout.addWidget(name_lbl)
        left_layout.addWidget(val_lbl)
        left_layout.addStretch()
        layout.addLayout(left_layout)

        # 中间：状态标签
        status_layout = QHBoxLayout()
        status_layout.setSpacing(8)

        status_styles = [
            (f"闲置:{idle}", "#52c41a"),
            (f"在用:{in_use}", "#1890ff"),
            (f"维修:{repair}", "#fa8c16"),
            (f"报废:{scrap}", "#f5222d"),
        ]

        for text, s_color in status_styles:
            if int(text.split(":")[1]) > 0:  # 只显示数量大于0的状态
                lbl = QLabel(text)
                lbl.setStyleSheet(
                    f"color: {s_color}; font-size: 12px; font-weight: 500; padding: 3px 8px; border: 1px solid {s_color}; border-radius: 12px;"
                )
                status_layout.addWidget(lbl)

        status_layout.addStretch()
        layout.addLayout(status_layout)

        # 右侧：彩色圆点和百分比
        right_layout = QVBoxLayout()
        right_layout.setAlignment(Qt.AlignRight | Qt.AlignVCenter)

        # 彩色圆点指示器
        color_indicator = QLabel()
        color_indicator.setFixedSize(12, 12)
        color_indicator.setStyleSheet(f"background-color: {color}; border-radius: 6px;")

        # 百分比数字
        percent_lbl = QLabel(f"{percent:.1f}%")
        percent_lbl.setStyleSheet(
            f"color: {color}; font-size: 16px; font-weight: bold;"
        )  # 增大字体

        right_layout.addWidget(percent_lbl)
        right_layout.addWidget(color_indicator)
        layout.addLayout(right_layout)


class ActivityTimeline(QListWidget):
    def __init__(self):
        super().__init__()
        self.setFocusPolicy(Qt.NoFocus)
        self.setVerticalScrollBarPolicy(Qt.ScrollBarAsNeeded)
        self.setStyleSheet(
            """
            QListWidget {
                background: transparent;
                border: none;
                outline: none;
            }
            QListWidget::item {
                background: white;
                border: 1px solid #f0f0f0;
                border-radius: 6px;
                padding: 12px;
                margin-bottom: 8px;
            }
            QListWidget::item:hover {
                background: #fafafa;
                border-color: #e1e4e8;
            }
        """
        )

    def add_activity(self, date_str, op_type, asset_name, user_name):
        item = QListWidgetItem()
        widget = QWidget()
        layout = QHBoxLayout(widget)
        layout.setContentsMargins(5, 5, 5, 5)

        op_type_map = {
            "领用": ("#1890ff", "领"),
            "归还": ("#52c41a", "还"),
            "维修": ("#fa8c16", "修"),
            "报废": ("#f5222d", "废"),
        }
        color, short_char = op_type_map.get(op_type, ("#8c8c8c", "未知"))

        op_label = QLabel(short_char)
        op_label.setFixedSize(24, 24)
        op_label.setAlignment(Qt.AlignCenter)
        op_label.setStyleSheet(
            f"""
            background-color: {color};
            color: white;
            font-size: 12px;
            font-weight: bold;
            border-radius: 12px;
        """
        )
        layout.addWidget(op_label)

        # 2. 内容
        content_layout = QVBoxLayout()
        title = QLabel(f"{op_type}: {asset_name}")
        title.setStyleSheet("font-weight: bold; color: #262626; font-size: 14px;")

        meta = QLabel(f"{date_str}  |  操作人: {user_name or '系统'}")
        meta.setStyleSheet("color: #8c8c8c; font-size: 12px;")

        content_layout.addWidget(title)
        content_layout.addWidget(meta)
        layout.addLayout(content_layout)
        layout.addStretch()

        # 进一步增加固定高度，确保长文本显示完整
        item.setSizeHint(QSize(0, 90))
        self.addItem(item)
        self.setItemWidget(item, widget)


class PieChartWidget(QWidget):
    """饼图可视化组件"""

    def __init__(self):
        super().__init__()
        self.categories = []
        self.counts = []
        self.colors = []

        if MATPLOTLIB_AVAILABLE:
            self.fig = Figure(figsize=(6, 6), dpi=100)
            self.canvas = FigureCanvas(self.fig)
            layout = QVBoxLayout(self)
            layout.addWidget(self.canvas)
        else:
            layout = QVBoxLayout(self)
            warning_label = QLabel(
                "图表功能需要安装 matplotlib\n请运行: pip install matplotlib"
            )
            warning_label.setAlignment(Qt.AlignCenter)
            warning_label.setStyleSheet(
                "color: #f5222d; font-size: 14px; font-weight: bold;"
            )
            layout.addWidget(warning_label)

    def update_data(self, cat_data):
        if not MATPLOTLIB_AVAILABLE:
            return

        self.categories = [row[0] for row in cat_data]
        self.counts = [row[1] for row in cat_data]  # 总数
        # 使用与主界面一致的颜色
        self.colors = ["#1890ff", "#13c2c2", "#52c41a", "#fa8c16", "#f5222d"]

        self.fig.clear()
        ax = self.fig.add_subplot(111)

        # 计算百分比并格式化标签
        total = sum(self.counts)
        percentages = [count / total * 100 for count in self.counts]
        labels = [
            f"{cat}\n{pct:.1f}%" for cat, pct in zip(self.categories, percentages)
        ]

        # 绘制饼图
        wedges, texts, autotexts = ax.pie(
            self.counts,
            labels=labels,
            colors=self.colors[: len(self.counts)],
            autopct="%1.1f%%",
            startangle=90,
            textprops={"fontsize": 10},
        )

        # 设置标题
        ax.set_title("资产分类分布", fontsize=14, fontweight="bold", pad=20)

        # 调整字体大小
        for text in texts:
            text.set_fontsize(11)
        for autotext in autotexts:
            autotext.set_color("white")
            autotext.set_fontsize(10)
            autotext.set_weight("bold")

        self.canvas.draw()


class DashboardPage(QWidget):
    view_all_logs = Signal()

    def __init__(self):
        super().__init__()
        self.db = DBManager()
        self.init_ui()
        self.refresh_data()

    def init_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(30, 30, 30, 30)
        layout.setSpacing(25)

        # --- 1. 顶部数据卡片 ---
        cards_layout = QHBoxLayout()
        cards_layout.setSpacing(20)

        self.card_total = ModernStatCard("总资产数量", "0", "总价值估算: --", "#1890ff")
        self.card_inuse = ModernStatCard("在用资产", "0", "使用率: 0%", "#52c41a")
        self.card_new = ModernStatCard("本月入库", "0", "较上月 --", "#722ed1")
        self.card_assign = ModernStatCard("本月领用", "0", "流转活跃", "#fa8c16")

        for c in [self.card_total, self.card_inuse, self.card_new, self.card_assign]:
            cards_layout.addWidget(c)

        layout.addLayout(cards_layout)

        # --- 2. 下部双栏布局 ---
        bottom_layout = QHBoxLayout()
        bottom_layout.setSpacing(25)

        # 左侧：分类分布
        self.dist_panel = QFrame()
        self.dist_panel.setObjectName("DistPanel")
        self.dist_panel.setStyleSheet(
            """
            QFrame#DistPanel {
                background-color: white;
                border-radius: 12px;
                border: 1px solid #e1e4e8;
            }
        """
        )
        dist_layout = QVBoxLayout(self.dist_panel)
        dist_layout.setContentsMargins(25, 25, 25, 25)

        dist_title = QLabel("📊 资产分类分布 (Top 5)")
        dist_title.setStyleSheet("font-size: 16px; font-weight: bold; color: #262626;")
        dist_layout.addWidget(dist_title)

        # 使用QTableWidget替代堆叠窗口
        self.category_table = QTableWidget()
        self.category_table.setColumnCount(4)
        self.category_table.setHorizontalHeaderLabels(
            ["分类名称", "总数", "状态分布", "占比"]
        )
        self.category_table.setEditTriggers(
            QTableWidget.NoEditTriggers
        )  # 设置为不可编辑
        self.category_table.verticalHeader().setVisible(False)
        self.category_table.setAlternatingRowColors(True)
        self.category_table.setStyleSheet(
            "QTableWidget { border: 1px solid #f0f0f0; gridline-color: #f0f0f0; }"
        )

        # 设置表头样式
        header = self.category_table.horizontalHeader()
        header.setStyleSheet(
            "QHeaderView::section { background-color: #f5f5f5; padding: 8px; font-weight: bold; border: 1px solid #d9d9d9; }"
        )

        dist_layout.addWidget(self.category_table)
        dist_layout.addStretch()

        # 右侧：最近动态
        self.log_panel = QFrame()
        self.log_panel.setObjectName("LogPanel")
        self.log_panel.setStyleSheet(
            """
            QFrame#LogPanel {
                background-color: white;
                border-radius: 12px;
                border: 1px solid #e1e4e8;
            }
        """
        )
        log_layout = QVBoxLayout(self.log_panel)
        log_layout.setContentsMargins(20, 20, 20, 20)

        # 动态标题栏
        log_header = QHBoxLayout()
        log_title = QLabel("🕒 最近流转动态")
        log_title.setStyleSheet("font-size: 16px; font-weight: bold; color: #262626;")

        more_btn = QPushButton("查看全部 >")
        more_btn.setCursor(Qt.PointingHandCursor)
        more_btn.setStyleSheet("border: none; color: #1890ff;")
        more_btn.clicked.connect(lambda: self.view_all_logs.emit())

        log_header.addWidget(log_title)
        log_header.addStretch()
        log_header.addWidget(more_btn)
        log_layout.addLayout(log_header)

        self.timeline = ActivityTimeline()
        log_layout.addWidget(self.timeline)

        bottom_layout.addWidget(self.dist_panel, 6)  # 左侧占 60%
        bottom_layout.addWidget(self.log_panel, 4)  # 右侧占 40%

        layout.addLayout(bottom_layout)

    def refresh_data(self):
        # 1. 获取增强版统计数据
        try:
            stats = self.db.get_dashboard_extended_stats()
        except Exception:
            # Fallback for old DB manager without extended stats
            old_stats = self.db.get_dashboard_stats()
            stats = {
                "total": old_stats["total_count"],
                "in_use": old_stats["in_use_count"],
                "new_this_month": 0,
                "assigned_this_month": 0,
                "cat_dist": [],
            }

        total = stats.get("total", 0)
        in_use = stats.get("in_use", 0)

        # 更新卡片
        self.card_total.update_data(total, "企业核心资产")

        usage_rate = (in_use / total * 100) if total > 0 else 0
        self.card_inuse.update_data(in_use, f"使用率: {usage_rate:.1f}%")

        self.card_new.update_data(stats.get("new_this_month", 0), "持续投入中")
        self.card_assign.update_data(stats.get("assigned_this_month", 0), "流转效率")

        # 更新分类分布表格
        self.update_category_table(stats, total)

        # 更新动态列表
        self.timeline.clear()
        activities = self.db.get_recent_activity(8)
        for date, op_type, asset, user in activities:
            self.timeline.add_activity(date, op_type, asset, user)

    def update_category_table(self, stats, total):
        """更新分类分布表格"""
        cat_data = stats.get("cat_dist", [])

        # 设置表格行数
        self.category_table.setRowCount(len(cat_data[:5]))  # 限制显示前5个

        # 填充表格数据
        for row_idx, row in enumerate(cat_data[:5]):
            name = row[0]
            counts = row[1:]  # (total, idle, in_use, repair, scrap)
            t_count, idle, in_use, repair, scrap = counts

            # 分类名称列
            name_item = QTableWidgetItem(name)
            name_item.setTextAlignment(Qt.AlignCenter)
            name_item.setFlags(name_item.flags() ^ Qt.ItemIsEditable)  # 设置为不可编辑
            self.category_table.setItem(row_idx, 0, name_item)

            # 总数列
            total_item = QTableWidgetItem(str(t_count))
            total_item.setTextAlignment(Qt.AlignCenter)
            total_item.setFlags(total_item.flags() ^ Qt.ItemIsEditable)
            self.category_table.setItem(row_idx, 1, total_item)

            # 状态分布列
            status_parts = []
            if idle > 0:
                status_parts.append(f"闲置:{idle}")
            if in_use > 0:
                status_parts.append(f"在用:{in_use}")
            if repair > 0:
                status_parts.append(f"维修:{repair}")
            if scrap > 0:
                status_parts.append(f"报废:{scrap}")
            status_text = ", ".join(status_parts) if status_parts else "无"

            status_item = QTableWidgetItem(status_text)
            status_item.setTextAlignment(Qt.AlignCenter)
            status_item.setFlags(status_item.flags() ^ Qt.ItemIsEditable)
            self.category_table.setItem(row_idx, 2, status_item)

            # 占比列
            percent = (t_count / total * 100) if total > 0 else 0
            percent_item = QTableWidgetItem(f"{percent:.1f}%")
            percent_item.setTextAlignment(Qt.AlignCenter)
            percent_item.setFlags(percent_item.flags() ^ Qt.ItemIsEditable)
            self.category_table.setItem(row_idx, 3, percent_item)

        # 调整列宽
        header = self.category_table.horizontalHeader()
        for col in range(4):
            header.setSectionResizeMode(col, QHeaderView.Stretch)
