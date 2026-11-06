# -*- coding: utf-8 -*-
"""标注格式的读写：Pascal VOC XML 与 YOLO txt。

对外只暴露四个函数，内部不持有任何状态，方便单独测试。
"""

import os
from xml.etree import ElementTree as ET

from .paths import ann_path, atomic_write


def esc(text):
    return (str(text).replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))


# ---------------------------------------------------------------- VOC

def read_voc(path):
    """返回 (boxes, size)；size 可能为 None。"""
    root = ET.parse(path).getroot()
    size = None
    node = root.find("size")
    if node is not None:
        try:
            size = {
                "w": int(float(node.findtext("width") or 0)),
                "h": int(float(node.findtext("height") or 0)),
            }
        except (TypeError, ValueError):
            size = None
    boxes = []
    for obj in root.findall("object"):
        bb = obj.find("bndbox")
        if bb is None:
            continue
        try:
            boxes.append({
                "label": (obj.findtext("name") or "object").strip() or "object",
                "x1": float(bb.findtext("xmin") or 0),
                "y1": float(bb.findtext("ymin") or 0),
                "x2": float(bb.findtext("xmax") or 0),
                "y2": float(bb.findtext("ymax") or 0),
            })
        except (TypeError, ValueError):
            continue
    return boxes, size


def write_voc(folder, rel, size, boxes, label_dir=None):
    path = ann_path(folder, rel, "voc", label_dir)
    w, h = int(size["w"]), int(size["h"])
    out = [
        "<annotation>",
        "\t<folder>%s</folder>" % esc(os.path.basename(folder)),
        "\t<filename>%s</filename>" % esc(os.path.basename(rel)),
        "\t<path>%s</path>" % esc(os.path.join(folder, rel.replace("/", os.sep)).replace(os.sep, "/")),
        "\t<source><database>Unknown</database></source>",
        "\t<size><width>%d</width><height>%d</height><depth>3</depth></size>" % (w, h),
        "\t<segmented>0</segmented>",
    ]
    for b in boxes:
        x1 = max(0, min(w, int(round(b["x1"]))))
        y1 = max(0, min(h, int(round(b["y1"]))))
        x2 = max(0, min(w, int(round(b["x2"]))))
        y2 = max(0, min(h, int(round(b["y2"]))))
        if x2 - x1 < 1 or y2 - y1 < 1:
            continue
        out.append("\t<object>")
        out.append("\t\t<name>%s</name>" % esc(b.get("label") or "object"))
        out.append("\t\t<pose>Unspecified</pose><truncated>0</truncated><difficult>0</difficult>")
        out.append("\t\t<bndbox><xmin>%d</xmin><ymin>%d</ymin><xmax>%d</xmax><ymax>%d</ymax></bndbox>"
                   % (x1, y1, x2, y2))
        out.append("\t</object>")
    out.append("</annotation>")
    atomic_write(path, ("\n".join(out) + "\n").encode("utf-8"))
    return path


# ---------------------------------------------------------------- YOLO

def read_yolo(path):
    """解析 YOLO 标签，返回条目列表，每项带 kind：

    - 检测框：   class cx cy w h                    → kind="box"
    - 分割多边形：class x1 y1 x2 y2 ...（>=3 个点） → kind="poly"

    多边形识别规则：类别后面是偶数个坐标且不少于 6 个（3 个点）。
    这样 4 个数字的检测框不会被误判成多边形。
    """
    items = []
    # utf-8-sig：有些编辑器会给第一行加 BOM，否则第一个数字会解析失败
    with open(path, "r", encoding="utf-8-sig", errors="replace") as fh:
        for line in fh:
            parts = line.split()
            if len(parts) < 5:
                continue
            try:
                cid = int(float(parts[0]))
                coords = [float(v) for v in parts[1:]]
            except ValueError:
                continue

            if len(coords) >= 6 and len(coords) % 2 == 0:
                points = [(coords[i], coords[i + 1]) for i in range(0, len(coords), 2)]
                items.append({"cls": cid, "label": None, "kind": "poly", "points": points})
            elif len(coords) >= 4:
                cx, cy, bw, bh = coords[0], coords[1], coords[2], coords[3]
                items.append({"cls": cid, "label": None, "kind": "box",
                              "cx": cx, "cy": cy, "bw": bw, "bh": bh})
    return items


def write_yolo(folder, rel, classes, boxes, label_dir=None):
    path = ann_path(folder, rel, "yolo", label_dir)
    index = {name: i for i, name in enumerate(classes)}
    lines = []
    for b in boxes:
        label = b.get("label") or "object"
        if label not in index:
            index[label] = len(index)
        lines.append("%d %.6f %.6f %.6f %.6f" % (
            index[label], b["cx"], b["cy"], b["bw"], b["bh"]))
    atomic_write(path, ("\n".join(lines) + ("\n" if lines else "")).encode("utf-8"))
    return path
