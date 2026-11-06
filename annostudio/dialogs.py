#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""独立进程里弹一个系统选择窗口，把结果打印到 stdout。

单独成进程的原因：Tk 在主线程外创建窗口容易和 HTTP 服务线程互相干扰，
起一个一次性进程最省心，窗口关掉进程就退出。

用法：
    python dialogs.py dir  "选择图片文件夹"
    python dialogs.py file "选择类别文件"
"""

import sys


def _root():
    import tkinter as tk

    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    root.update()
    return root


def pick_directory(title="选择文件夹"):
    from tkinter import filedialog

    root = _root()
    try:
        chosen = filedialog.askdirectory(title=title, mustexist=True)
    finally:
        root.destroy()
    return chosen or ""


def pick_file(title="选择文件"):
    from tkinter import filedialog

    root = _root()
    try:
        chosen = filedialog.askopenfilename(
            title=title,
            filetypes=[("文本文件", "*.txt"), ("所有文件", "*.*")],
        )
    finally:
        root.destroy()
    return chosen or ""


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "dir"
    title = sys.argv[2] if len(sys.argv) > 2 else "选择文件夹"
    try:
        chosen = pick_file(title) if mode == "file" else pick_directory(title)
        sys.stdout.write(chosen)
        sys.stdout.flush()
    except Exception as exc:  # tkinter 缺失或无显示环境
        sys.stderr.write("对话框不可用: %s\n" % exc)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
