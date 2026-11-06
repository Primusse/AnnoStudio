# -*- coding: utf-8 -*-
"""数据目录这一层：扫描图片、读写目录级配置、收集类别。

这里只做「读」，不改全局状态；状态由 session.Session 持有。
"""

import json
import os
from xml.etree import ElementTree as ET

from .formats import read_voc
from .paths import (ann_path, atomic_write, is_image, natural_key,
                    resolve_label_dir)

CONFIG_NAME = ".annostudio.json"

FORMATS = ("voc", "yolo")
DEFAULT_FORMAT = "yolo"   # 没配置过的目录默认用 YOLO


def scan_images(folder, recursive=False):
    """按自然顺序列出图片的相对路径。"""
    found = []
    if recursive:
        for dirpath, dirnames, filenames in os.walk(folder):
            dirnames[:] = [d for d in dirnames if not d.startswith(".")]
            for fn in filenames:
                if is_image(fn):
                    rel = os.path.relpath(os.path.join(dirpath, fn), folder)
                    found.append(rel.replace(os.sep, "/"))
    else:
        for fn in os.listdir(folder):
            if is_image(fn) and os.path.isfile(os.path.join(folder, fn)):
                found.append(fn)
    found.sort(key=natural_key)
    return found


# ---------------------------------------------------------------- 目录配置

def config_path(folder):
    return os.path.join(folder, CONFIG_NAME)


def load_config(folder):
    try:
        with open(config_path(folder), "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def save_config(folder, **changes):
    cfg = load_config(folder)
    cfg.update(changes)
    try:
        atomic_write(config_path(folder),
                     json.dumps(cfg, ensure_ascii=False, indent=2).encode("utf-8"))
    except OSError:
        pass
    return cfg


# ---------------------------------------------------------------- 类别

def _read_names(path):
    """读一行一个名字的文本；utf-8-sig 顺带吃掉记事本常见的 BOM。"""
    try:
        with open(path, "r", encoding="utf-8-sig", errors="replace") as fh:
            return [ln.strip() for ln in fh if ln.strip()]
    except OSError:
        return []


def read_names_file(path):
    """读用户指定的类别清单文件。"""
    return _read_names(path)


def _class_bases(folder, label_dir=None, extra=None):
    """类别文件的查找顺序：图片根目录 → 数据集根目录 → 标注目录。"""
    bases = []
    for base in [folder] + list(extra or []) + [label_dir]:
        if not base:
            continue
        if any(os.path.abspath(base) == os.path.abspath(b) for b in bases):
            continue
        bases.append(base)
    return bases


def read_classes_file(folder, label_dir=None, extra=None):
    for base in _class_bases(folder, label_dir, extra):
        for name in ("classes.txt", "predefined_classes.txt"):
            path = os.path.join(base, name)
            if os.path.isfile(path):
                items = _read_names(path)
                if items:
                    return items
    return []


def read_yolo_classes(folder, label_dir=None, extra=None):
    """YOLO txt 里只有类别序号，名字要查 classes.txt。"""
    for base in _class_bases(folder, label_dir, extra):
        path = os.path.join(base, "classes.txt")
        if os.path.isfile(path):
            items = _read_names(path)
            if items:
                return items
    return []


def has_yolo_classes(folder, label_dir=None, extra=None):
    """YOLO 目录是否自带类别名文件（没有就只能显示 class_0 这种占位名）。"""
    for base in _class_bases(folder, label_dir, extra):
        if os.path.isfile(os.path.join(base, "classes.txt")):
            return True
    return False


def seed_classes(folder, rels, fmt, label_dir=None, limit=400):
    """从已有标注里快速收集类别，避免用户手动重录。"""
    seen = []
    for rel in rels[:limit]:
        path = ann_path(folder, rel, fmt, label_dir)
        if not os.path.isfile(path):
            continue
        try:
            if fmt == "yolo":
                for name in read_yolo_classes(folder, label_dir):
                    if name and name not in seen:
                        seen.append(name)
            else:
                for box in read_voc(path)[0]:
                    if box["label"] not in seen:
                        seen.append(box["label"])
        except (OSError, ET.ParseError):
            continue
    return sorted(seen, key=natural_key)


# ---------------------------------------------------------------- 打开目录

def count_subfolder_images(folder, limit=5000):
    """不递归时也数一下子文件夹里还有多少图，用来提示用户勾选「包含子文件夹」。"""
    count = 0
    root_abs = os.path.abspath(folder)
    for dirpath, dirnames, filenames in os.walk(folder):
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]
        if os.path.abspath(dirpath) == root_abs:
            continue                      # 根目录的图已经算过了
        for name in filenames:
            if is_image(name):
                count += 1
                if count >= limit:
                    return count
    return count


def _find_child_dir(folder, name):
    """在 folder 里找名字叫 name 的子目录（不区分大小写）。"""
    try:
        for entry in os.scandir(folder):
            if entry.is_dir() and entry.name.lower() == name:
                return entry.path
    except OSError:
        pass
    return None


def _contains_image(folder, limit=1):
    """目录（含子目录）里是否至少有一张图，找到一个就返回。"""
    found = 0
    for dirpath, dirnames, filenames in os.walk(folder):
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]
        for fn in filenames:
            if is_image(fn):
                found += 1
                if found >= limit:
                    return True
    return False


def detect_layout(folder):
    """识别 dataset/images + dataset/labels 这种标准布局。

    返回 (图片目录, 标注目录, 数据集根目录)，没命中返回 None。
    两种选法都认：
      - 选中数据集根目录，它下面有 images/ 和 labels/；
      - 直接选中 images/ 本身，旁边有同级的 labels/。
    """
    images_dir = _find_child_dir(folder, "images")
    labels_dir = _find_child_dir(folder, "labels")
    if images_dir and labels_dir and _contains_image(images_dir):
        return images_dir, labels_dir, folder

    base = os.path.basename(folder.rstrip("\\/")).lower()
    sibling = os.path.join(os.path.dirname(folder), "labels")
    if base == "images" and os.path.isdir(sibling) and _contains_image(folder):
        return folder, sibling, os.path.dirname(folder)
    return None


def analyze(folder, recursive=None):
    """扫一遍目录，返回给前端用的完整描述（不修改全局状态）。"""
    folder = os.path.abspath(folder)
    if not os.path.isdir(folder):
        raise ValueError("文件夹不存在: %s" % folder)

    # 选中 dataset/images + dataset/labels 时，自动把 images 当图片目录、labels 当标注目录
    root_folder = folder
    auto_layout = detect_layout(folder)
    forced_label_dir = None
    if auto_layout:
        folder, forced_label_dir, root_folder = auto_layout

    cfg = load_config(folder)
    fmt = cfg.get("format") if cfg.get("format") in FORMATS else DEFAULT_FORMAT
    recursive = bool(cfg.get("recursive")) if recursive is None else bool(recursive)
    label_dir = forced_label_dir or resolve_label_dir(folder, cfg.get("label_dir"))

    # 用户手动指定的类别文件优先级最高
    classes_file = cfg.get("classes_file") or ""
    classes_file_ok = bool(classes_file) and os.path.isfile(classes_file)

    rels = scan_images(folder, recursive)
    images = [{"rel": rel, "ann": os.path.isfile(ann_path(folder, rel, fmt, label_dir))}
              for rel in rels]

    classes = read_names_file(classes_file) if classes_file_ok else []
    if not classes:
        extra_bases = [root_folder] if auto_layout else []
        classes = (cfg.get("classes") or read_classes_file(folder, label_dir, extra_bases)
                   or seed_classes(folder, rels, fmt, label_dir))

    name = os.path.basename(folder.rstrip("\\/")) or folder
    if auto_layout:
        name = os.path.basename(root_folder.rstrip("\\/")) or name

    return {
        "folder": folder,
        "root": root_folder,
        "auto_layout": bool(auto_layout),
        "name": name,
        "images": images,
        "classes": classes,
        "format": fmt,
        "recursive": recursive,
        "label_dir": label_dir or "",
        "label_dir_saved": cfg.get("label_dir") or "",
        "labeled": sum(1 for i in images if i["ann"]),
        "subfolder_images": 0 if recursive else count_subfolder_images(folder),
        "classes_file": classes_file,
        "classes_file_ok": classes_file_ok,
        "last": cfg.get("last"),
    }
