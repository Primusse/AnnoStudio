# -*- coding: utf-8 -*-
"""会话状态与业务操作。

HTTP 层只负责解析请求、调用这里的方法、把结果序列化；
所有「打开哪个目录、保存到哪、类别是什么」的逻辑都在这个类里。
"""

import os
import threading
import time
from xml.etree import ElementTree as ET

from . import dataset
from .formats import read_voc, read_yolo, write_voc, write_yolo
from .paths import (ann_path, atomic_write, natural_key, resolve_label_dir,
                    safe_path, store_label_dir)


class SessionError(Exception):
    """可以直接返回给前端的错误：message 给用户看，status 是 HTTP 状态码。"""

    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


class Session:
    def __init__(self):
        self._lock = threading.RLock()
        self.folder = None
        self.images = []        # [{"rel": "a.jpg", "ann": True}]
        self.classes = []
        self.format = dataset.DEFAULT_FORMAT
        self.recursive = False
        self.label_dir = None   # 自定义标注目录的绝对路径；None = 默认位置
        self.classes_file = None  # 手动指定的类别清单文件；None = 自动查找
        self.subfolder_images = 0   # 未递归时，子文件夹里还有多少张图（仅用于提示）
        self.auto_layout = False    # 是否命中了 images/ + labels/ 标准布局
        self.root_folder = None     # 用户实际选的目录（自动布局时是 images 的父目录）

    # ---------------------------------------------------------- 状态

    def state(self):
        with self._lock:
            return {
                "folder": self.folder,
                "root": self.root_folder or self.folder,
                "auto_layout": self.auto_layout,
                "images": [dict(i) for i in self.images],
                "classes": list(self.classes),
                "format": self.format,
                "recursive": self.recursive,
                "label_dir": self.label_dir or "",
                "classes_file": self.classes_file or "",
                "subfolder_images": self.subfolder_images,
            }

    def _require_folder(self):
        with self._lock:
            if not self.folder:
                raise SessionError("尚未打开文件夹")
            return self.folder, self.format, self.label_dir

    def _class_extra(self):
        """自动识别 images/ + labels/ 布局时，类别文件也可能放在数据集根目录。"""
        with self._lock:
            if self.auto_layout and self.root_folder:
                return [self.root_folder]
            return []

    def _mark(self, rel, ann):
        with self._lock:
            for item in self.images:
                if item["rel"] == rel:
                    item["ann"] = ann
                    break

    # ---------------------------------------------------------- 打开

    def open(self, folder, recursive=None):
        try:
            info = dataset.analyze(folder, recursive)
        except (OSError, ValueError) as exc:
            raise SessionError(str(exc))
        with self._lock:
            self.folder = info["folder"]
            self.images = [dict(i) for i in info["images"]]
            self.classes = list(info["classes"])
            self.format = info["format"]
            self.recursive = info["recursive"]
            self.label_dir = info["label_dir"] or None
            self.classes_file = info.get("classes_file") or None
            self.subfolder_images = info.get("subfolder_images", 0)
            self.auto_layout = bool(info.get("auto_layout"))
            self.root_folder = info.get("root") or info["folder"]
        dataset.save_config(info["folder"], format=info["format"],
                            recursive=info["recursive"], classes=info["classes"])
        return info

    def close(self):
        """关掉当前数据集，回到起始页（前端「回到初始页面」）。"""
        with self._lock:
            self.folder = None
            self.images = []
            self.classes = []
            self.format = dataset.DEFAULT_FORMAT
            self.recursive = False
            self.label_dir = None
            self.classes_file = None
            self.subfolder_images = 0
            self.auto_layout = False
            self.root_folder = None
        return {"ok": True}

    def image_path(self, rel):
        with self._lock:
            folder = self.folder
        if not folder:
            raise SessionError("尚未打开文件夹")
        if not rel:
            raise SessionError("缺少图片路径")
        try:
            return safe_path(folder, rel)
        except ValueError as exc:
            raise SessionError(str(exc), 403)

    # ---------------------------------------------------------- 类别

    def set_classes(self, items):
        classes = [str(c).strip() for c in (items or []) if str(c).strip()]
        with self._lock:
            self.classes = classes
            folder = self.folder
            fmt = self.format
            classes_file = self.classes_file
            # 自动布局时 classes.txt 放数据集根目录，跟 data.yaml 作伴
            class_root = self.root_folder if (self.auto_layout and self.root_folder) else folder
        wrote_txt = False
        if folder:
            dataset.save_config(folder, classes=classes)
            # 类别名要有唯一可信来源：优先写回用户指定的文件，
            # 否则 YOLO 模式写回 classes.txt（序号映射必须和磁盘一致）
            target = classes_file or (os.path.join(class_root, "classes.txt") if fmt == "yolo" else None)
            if target:
                try:
                    atomic_write(target, ("\n".join(classes) + "\n").encode("utf-8"))
                except OSError as exc:
                    raise SessionError("写类别文件失败: %s" % exc, 500)
                wrote_txt = True
        return {"ok": True, "classes": classes, "wrote_txt": wrote_txt}

    def set_classes_file(self, raw):
        """指定类别清单文件；传空字符串表示恢复自动查找。"""
        with self._lock:
            folder = self.folder
            label_dir = self.label_dir
            current = list(self.classes)
        if not folder:
            raise SessionError("尚未打开文件夹")

        raw = (raw or "").strip().strip('"')
        if not raw:
            path = None
        else:
            path = os.path.abspath(os.path.expanduser(raw))
            if not os.path.isfile(path):
                raise SessionError("找不到这个文件: %s" % path, 422)

        dataset.save_config(folder, classes_file=path or "")
        if path:
            names = dataset.read_names_file(path)
            if not names:
                raise SessionError("这个文件里没有读到任何类别名: %s" % path, 422)
        else:
            names = dataset.read_classes_file(folder, label_dir) or current

        with self._lock:
            self.classes_file = path
            self.classes = names
        dataset.save_config(folder, classes=names)
        return {"ok": True, "classes_file": path or "", "classes": names}

    def rescan_classes(self):
        """重新从磁盘收集类别。

        VOC 的名字写在 xml 里，扫一遍并追加新出现的；
        YOLO 的名字只在 classes.txt 里、且顺序就是序号映射，只能整份替换。
        """
        with self._lock:
            folder, fmt, label_dir = self.folder, self.format, self.label_dir
            current = list(self.classes)
            rels = [i["rel"] for i in self.images]
        if not folder:
            raise SessionError("尚未打开文件夹")

        if fmt == "yolo":
            names = dataset.read_yolo_classes(folder, label_dir, self._class_extra())
            if not names:
                raise SessionError(
                    "这个目录没有 classes.txt，YOLO 无法推断类别名。"
                    "请点「映射」按序号手动填写。", 422)
            with self._lock:
                self.classes = names
            dataset.save_config(folder, classes=names)
            return {"ok": True, "classes": names, "mode": "replace", "scanned": 0,
                    "added": [n for n in names if n not in current], "truncated": False}

        limit = 3000
        scanned = 0
        truncated = False
        found = []
        for rel in rels:
            if scanned >= limit:
                truncated = True
                break
            path = ann_path(folder, rel, fmt, label_dir)
            if not os.path.isfile(path):
                continue
            scanned += 1
            try:
                for box in read_voc(path)[0]:
                    if box["label"] not in found:
                        found.append(box["label"])
            except (OSError, ET.ParseError):
                continue

        merged = list(current)
        added = []
        for name in dataset.read_classes_file(folder, label_dir, self._class_extra()) + found:
            if name and name not in merged:
                merged.append(name)
                added.append(name)

        with self._lock:
            self.classes = merged
        dataset.save_config(folder, classes=merged)
        return {"ok": True, "classes": merged, "mode": "merge", "scanned": scanned,
                "added": added, "truncated": truncated}

    # ---------------------------------------------------------- 格式

    def set_format(self, fmt):
        if fmt not in dataset.FORMATS:
            raise SessionError("格式必须是 voc 或 yolo")
        with self._lock:
            folder, label_dir = self.folder, self.label_dir
            self.format = fmt
            for item in self.images:
                item["ann"] = (os.path.isfile(ann_path(folder, item["rel"], fmt, label_dir))
                               if folder else False)
            images = [dict(i) for i in self.images]
            classes = list(self.classes)

        if folder:
            dataset.save_config(folder, format=fmt)
            if not classes:
                classes = dataset.seed_classes(
                    folder, [i["rel"] for i in images], fmt, label_dir, limit=100)
                with self._lock:
                    self.classes = classes
                dataset.save_config(folder, classes=classes)

        payload = {"ok": True, "format": fmt, "images": images, "classes": classes}
        # YOLO 的 txt 只有序号：目录里没有 classes.txt 时，界面只能显示 class_0 这种占位名
        if fmt == "yolo" and folder and any(i["ann"] for i in images) \
                and not dataset.has_yolo_classes(folder, label_dir, self._class_extra()):
            payload["warning"] = ("这个目录没有 classes.txt，YOLO 的 txt 只存序号，"
                                  "界面上只能显示 class_0 这类占位名。"
                                  "点类别标题右边的「映射」按序号填真实名字。")
        return payload

    # ---------------------------------------------------------- 标注目录

    def set_label_dir(self, raw):
        with self._lock:
            folder, fmt = self.folder, self.format
        if not folder:
            raise SessionError("尚未打开文件夹")

        raw = (raw or "").strip()
        label_dir = resolve_label_dir(folder, raw) if raw else None
        created = False
        if label_dir and not os.path.isdir(label_dir):
            try:
                os.makedirs(label_dir)
            except OSError as exc:
                raise SessionError("无法创建标注目录: %s" % exc, 500)
            created = True

        dataset.save_config(folder, label_dir=store_label_dir(folder, label_dir))
        with self._lock:
            self.label_dir = label_dir
            for item in self.images:
                item["ann"] = os.path.isfile(ann_path(folder, item["rel"], fmt, label_dir))
            images = [dict(i) for i in self.images]
            classes = list(self.classes)

        # 换了标注目录后，classes.txt 可能跟着在那边：类别还空着就顺手读一次
        if not classes:
            found = dataset.read_classes_file(folder, label_dir)
            if found:
                classes = found
                with self._lock:
                    self.classes = classes
                dataset.save_config(folder, classes=classes)

        return {
            "ok": True,
            "label_dir": label_dir or "",
            "saved_as": store_label_dir(folder, label_dir),
            "images": images,
            "labeled": sum(1 for i in images if i["ann"]),
            "classes": classes,
            "created": created,
        }

    # ---------------------------------------------------------- 读标注

    def read_annotations(self, rel):
        with self._lock:
            folder, fmt = self.folder, self.format
            classes = list(self.classes)
            label_dir = self.label_dir
        if not folder:
            raise SessionError("尚未打开文件夹")
        if not rel:
            raise SessionError("缺少图片路径")

        path = ann_path(folder, rel, fmt, label_dir)
        payload = {"boxes": [], "polygons": [], "readonly": False,
                   "exists": os.path.isfile(path), "format": fmt,
                   "size": None, "normalized": False, "labels": []}
        if not payload["exists"]:
            # 当前格式没有文件时，看看另一种格式有没有，前端据此提示「别以为标注丢了」
            other = "voc" if fmt == "yolo" else "yolo"
            if os.path.isfile(ann_path(folder, rel, other, label_dir)):
                payload["other_format"] = other
            return payload

        try:
            if fmt == "yolo":
                raw = read_yolo(path)
                payload["normalized"] = True

                def name_of(cid):
                    return classes[cid] if cid < len(classes) else "class_%d" % cid

                payload["boxes"] = [
                    {"x1": b["cx"] - b["bw"] / 2, "y1": b["cy"] - b["bh"] / 2,
                     "x2": b["cx"] + b["bw"] / 2, "y2": b["cy"] + b["bh"] / 2,
                     "label": name_of(b["cls"])}
                    for b in raw if b.get("kind") != "poly"
                ]
                payload["polygons"] = [
                    {"label": name_of(b["cls"]),
                     "points": [[pt[0], pt[1]] for pt in b["points"]]}
                    for b in raw if b.get("kind") == "poly"
                ]
                # 含多边形就整张图只读，绝不写回（否则会把分割标签覆盖成检测框）
                payload["readonly"] = bool(payload["polygons"])
                payload["labels"] = classes
                payload["missing_classes"] = any(b["cls"] >= len(classes) for b in raw)
            else:
                boxes, size = read_voc(path)
                payload["boxes"] = boxes
                payload["size"] = size
        except (OSError, ET.ParseError) as exc:
            # 绝不覆盖读不懂的文件：先改名存档，让用户还有救回来的机会
            backup = path + ".bad-" + time.strftime("%Y%m%d-%H%M%S")
            try:
                os.replace(path, backup)
            except OSError:
                raise SessionError("标注文件解析失败，且无法备份: %s" % exc, 422)
            payload["warning"] = "标注文件无法解析，已备份为 %s" % os.path.basename(backup)
            payload["exists"] = False
        return payload

    # ---------------------------------------------------------- 写标注

    def write_annotations(self, rel, size, boxes):
        with self._lock:
            folder, fmt = self.folder, self.format
            classes = list(self.classes)
            label_dir = self.label_dir
        if not folder:
            raise SessionError("尚未打开文件夹")

        try:
            width = int((size or {}).get("w") or 0)
            height = int((size or {}).get("h") or 0)
        except (TypeError, ValueError):
            raise SessionError("图像尺寸无效")
        if width <= 0 or height <= 0:
            raise SessionError("图像尺寸无效")

        clean = []
        for b in boxes or []:
            try:
                clean.append({
                    "label": str(b.get("label") or "object"),
                    "x1": float(b["x1"]), "y1": float(b["y1"]),
                    "x2": float(b["x2"]), "y2": float(b["y2"]),
                })
            except (KeyError, TypeError, ValueError):
                continue

        target = ann_path(folder, rel, fmt, label_dir)

        # 多边形（分割）标注文件绝不覆盖：写回去会把分割数据变成检测框
        if fmt == "yolo" and os.path.isfile(target):
            try:
                existing = read_yolo(target)
            except OSError:
                existing = []
            if any(item.get("kind") == "poly" for item in existing):
                raise SessionError(
                    "这个标注文件是多边形（分割）格式，为避免覆盖原数据，工具暂不支持修改它。",
                    409)

        try:
            if not clean:
                # 框删光了，就当作「未标注」：移除标注文件，避免留下一堆空文件
                if os.path.isfile(target):
                    os.remove(target)
                self._mark(rel, False)
                return {"ok": True, "boxes": 0, "deleted": True}

            if fmt == "yolo":
                norm = []
                for b in clean:
                    x1, y1 = b["x1"], b["y1"]
                    x2, y2 = b["x2"], b["y2"]
                    norm.append({
                        "label": b["label"],
                        "cx": max(0.0, min(1.0, (x1 + x2) / 2 / width)),
                        "cy": max(0.0, min(1.0, (y1 + y2) / 2 / height)),
                        "bw": max(0.0, min(1.0, abs(x2 - x1) / width)),
                        "bh": max(0.0, min(1.0, abs(y2 - y1) / height)),
                    })
                target = write_yolo(folder, rel, classes, norm, label_dir)
            else:
                target = write_voc(folder, rel, {"w": width, "h": height}, clean, label_dir)
        except OSError as exc:
            raise SessionError("写入失败: %s" % exc, 500)

        # 新出现的类别顺手登记
        new_labels = [b["label"] for b in clean if b["label"] not in classes]
        if new_labels:
            for label in new_labels:
                if label not in classes:
                    classes.append(label)
            with self._lock:
                self.classes = classes
            dataset.save_config(folder, classes=classes)

        self._mark(rel, True)
        return {"ok": True, "saved": target, "boxes": len(clean)}

    # ---------------------------------------------------------- 导出

    def export_yolo(self):
        with self._lock:
            folder, fmt = self.folder, self.format
            classes = list(self.classes)
            images = [dict(i) for i in self.images]
            label_dir = self.label_dir
            # 自动识别布局时，导出的产物放到数据集根目录（images 的上一层）
            out_root = self.root_folder if (self.auto_layout and self.root_folder) else folder
        if not folder:
            raise SessionError("尚未打开文件夹")

        written, boxes_total, errors = 0, 0, []
        seen = set(classes)
        for item in images:
            rel = item["rel"]
            if fmt == "yolo":
                continue  # 已经是 YOLO，只需要补 classes.txt / data.yaml
            path = ann_path(folder, rel, fmt, label_dir)
            if not os.path.isfile(path):
                continue
            try:
                boxes, size = read_voc(path)
            except (OSError, ET.ParseError) as exc:
                errors.append("%s: %s" % (rel, exc))
                continue
            width = (size or {}).get("w")
            height = (size or {}).get("h")
            if not width or not height:
                errors.append("%s: 缺少图像尺寸" % rel)
                continue
            norm = []
            for b in boxes:
                norm.append({
                    "label": b["label"],
                    "cx": max(0.0, min(1.0, (b["x1"] + b["x2"]) / 2 / width)),
                    "cy": max(0.0, min(1.0, (b["y1"] + b["y2"]) / 2 / height)),
                    "bw": max(0.0, min(1.0, abs(b["x2"] - b["x1"]) / width)),
                    "bh": max(0.0, min(1.0, abs(b["y2"] - b["y1"]) / height)),
                })
                seen.add(b["label"])
            final = sorted(seen, key=natural_key)   # 导出时固定类别顺序
            write_yolo(folder, rel, final, norm, label_dir)
            written += 1
            boxes_total += len(norm)

        final_classes = sorted(seen, key=natural_key)
        try:
            atomic_write(os.path.join(out_root, "classes.txt"),
                         ("\n".join(final_classes) + "\n").encode("utf-8"))
            yaml = [
                "path: .",
                "train: .",
                "val: .",
                "nc: %d" % len(final_classes),
                "names:",
            ] + ["  - %s" % n for n in final_classes]
            atomic_write(os.path.join(out_root, "data.yaml"), ("\n".join(yaml) + "\n").encode("utf-8"))
        except OSError as exc:
            raise SessionError("写 classes.txt 失败: %s" % exc, 500)

        with self._lock:
            self.classes = final_classes
        dataset.save_config(folder, classes=final_classes)
        return {"ok": True, "images": written, "boxes": boxes_total,
                "classes": final_classes, "errors": errors[:20]}
