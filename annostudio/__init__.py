# -*- coding: utf-8 -*-
"""AnnoStudio —— 零依赖的本地图像标注工具。

只用 Python 标准库：在 127.0.0.1 起一个本地服务，用浏览器做标注界面。
支持 Pascal VOC XML 与 YOLO txt 两种格式的读取 / 写回。

    python -m annostudio                 启动并自动打开浏览器
    python -m annostudio --folder D:\\imgs  启动时直接打开目录
"""

__version__ = "2.0.0"
__all__ = ["__version__"]
