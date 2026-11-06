# -*- coding: utf-8 -*-
"""路径解析与安全写入。

这个模块只管「文件放在哪」和「怎么安全地写」，不关心标注内容。
"""

import os
import re

IMG_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff", ".gif"}

_NUM = re.compile(r"(\d+)")


def natural_key(text):
    """让 img_2 排在 img_10 前面。"""
    return [(0, int(t)) if t.isdigit() else (1, t.lower()) for t in _NUM.split(text or "")]


def is_image(name):
    return os.path.splitext(name)[1].lower() in IMG_EXTS


def safe_path(root, rel):
    """把相对路径限制在 root 内，拒绝 ../ 越界。"""
    root_abs = os.path.abspath(root)
    target = os.path.abspath(os.path.join(root_abs, rel.replace("/", os.sep)))
    if os.path.commonpath([root_abs, target]) != root_abs:
        raise ValueError("路径越界: %s" % rel)
    return target


def resolve_label_dir(folder, raw):
    """把配置里的标注目录解析成绝对路径；空值表示沿用默认位置。"""
    if not raw:
        return None
    text = str(raw).strip()
    if not text:
        return None
    text = os.path.expanduser(text)
    if not os.path.isabs(text):
        text = os.path.join(folder, text)
    return os.path.abspath(os.path.normpath(text))


def store_label_dir(folder, abs_path):
    """标注目录尽量存相对路径，整个数据集拷走也不会断。

    允许 "../labels" 这种同级目录（images/ 与 labels/ 并排的标准布局），
    隔两层的太容易失联，就存绝对路径。
    """
    if not abs_path:
        return ""
    try:
        rel = os.path.relpath(abs_path, os.path.abspath(folder))
    except ValueError:
        return abs_path
    if rel.startswith(".." + os.sep + ".."):
        return abs_path
    return rel.replace(os.sep, "/")


def ann_path(folder, rel, fmt, label_dir=None):
    """标注文件位置。

    默认：VOC 与图片同目录，YOLO 放在 labels/ 下。
    指定了 label_dir 之后，两种格式都存进那个独立目录，并按图片的相对路径建子目录。
    """
    stem = os.path.splitext(rel.replace("/", os.sep))[0]
    ext = ".txt" if fmt == "yolo" else ".xml"
    if label_dir:
        root = label_dir
    elif fmt == "yolo":
        root = os.path.join(folder, "labels")
    else:
        root = folder
    return os.path.join(root, stem + ext)


def atomic_write(path, data):
    """先写临时文件再 replace，避免中途崩溃留下半个文件。"""
    parent = os.path.dirname(path)
    if parent and not os.path.isdir(parent):
        os.makedirs(parent)
    tmp = path + ".tmp-annex"
    with open(tmp, "wb") as fh:
        fh.write(data)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, path)
