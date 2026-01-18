from PySide6.QtWidgets import (QWidget, QHBoxLayout, QPushButton, QLabel)
from PySide6.QtCore import Signal, Qt

class PaginationWidget(QWidget):
    """通用分页控制组件"""
    page_changed = Signal(int) # 信号：页码改变，传递 offset

    def __init__(self, page_size=20, parent=None):
        super().__init__(parent)
        self.page_size = page_size
        self.current_page = 1
        self.total_count = 0
        self.total_pages = 1
        self.init_ui()

    def init_ui(self):
        layout = QHBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(10)

        self.btn_first = QPushButton("« 首页")
        self.btn_prev = QPushButton("‹ 上一页")
        self.label_info = QLabel("第 1 / 1 页 (共 0 条)")
        self.btn_next = QPushButton("下一页 ›")
        self.btn_last = QPushButton("尾页 »")

        for btn in [self.btn_first, self.btn_prev, self.btn_next, self.btn_last]:
            btn.setFixedWidth(80)
            btn.setCursor(Qt.PointingHandCursor)
            btn.clicked.connect(self.on_btn_clicked)
            layout.addWidget(btn)
            if btn == self.btn_prev: layout.addWidget(self.label_info)

        layout.addStretch()
        self.update_controls()

    def update_stats(self, total_count):
        self.total_count = total_count
        self.total_pages = max(1, (total_count + self.page_size - 1) // self.page_size)
        if self.current_page > self.total_pages: self.current_page = self.total_pages
        self.update_controls()

    def update_controls(self):
        self.label_info.setText(f"第 {self.current_page} / {self.total_pages} 页 (共 {self.total_count} 条)")
        self.btn_first.setEnabled(self.current_page > 1)
        self.btn_prev.setEnabled(self.current_page > 1)
        self.btn_next.setEnabled(self.current_page < self.total_pages)
        self.btn_last.setEnabled(self.current_page < self.total_pages)

    def on_btn_clicked(self):
        sender = self.sender()
        if sender == self.btn_first: self.current_page = 1
        elif sender == self.btn_prev: self.current_page -= 1
        elif sender == self.btn_next: self.current_page += 1
        elif sender == self.btn_last: self.current_page = self.total_pages
        
        self.update_controls()
        # 计算 offset 并发送信号
        offset = (self.current_page - 1) * self.page_size
        self.page_changed.emit(offset)

    def reset(self):
        self.current_page = 1
        self.update_controls()
