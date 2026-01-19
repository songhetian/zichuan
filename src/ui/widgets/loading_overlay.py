from PySide6.QtWidgets import (
    QWidget,
    QLabel,
    QVBoxLayout,
    QGraphicsOpacityEffect,
    QGraphicsDropShadowEffect,
)
from PySide6.QtCore import Qt, QTimer, QPropertyAnimation, QEasingCurve, QEvent
from PySide6.QtGui import QColor, QPalette


class LoadingOverlay(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        if parent:
            self.resize(parent.size())
            parent.installEventFilter(self)

        self.setAttribute(Qt.WA_TransparentForMouseEvents, False)  # 拦截鼠标
        self.setVisible(False)

        # 半透明背景
        self.setAutoFillBackground(True)
        pal = self.palette()
        pal.setColor(QPalette.Window, QColor(255, 255, 255, 180))
        self.setPalette(pal)

        # 布局
        layout = QVBoxLayout(self)
        layout.setAlignment(Qt.AlignCenter)

        self.label = QLabel("⏳ 处理中...")
        self.label.setStyleSheet(
            """
            QLabel {
                color: #333;
                font-size: 16px;
                font-weight: bold;
                background-color: white;
                padding: 15px 30px;
                border: 1px solid #ddd;
                border-radius: 8px;
            }
        """
        )

        # 阴影效果
        shadow = QGraphicsDropShadowEffect(self)
        shadow.setBlurRadius(20)
        shadow.setColor(QColor(0, 0, 0, 50))
        shadow.setOffset(0, 4)
        self.label.setGraphicsEffect(shadow)

        layout.addWidget(self.label)

    def eventFilter(self, obj, event):
        if obj == self.parent() and event.type() == QEvent.Type.Resize:
            self.resize(event.size())
        return super().eventFilter(obj, event)

    def show_loading(self, text="处理中..."):
        self.label.setText(f"⏳ {text}")
        self.setVisible(True)
        self.raise_()

    def hide_loading(self):
        self.setVisible(False)
