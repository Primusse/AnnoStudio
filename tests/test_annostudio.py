# -*- coding: utf-8 -*-
"""AnnoStudio 自检：跑一遍标注读写往返，确认不会写坏数据。

    python tests/test_annostudio.py

只用标准库，不需要 pytest。
"""

import os
import shutil
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from annostudio import dataset, formats, paths, session  # noqa: E402

# 1x1 像素 PNG，用来造测试图片
PNG_1PX = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
    "890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082"
)


def expect(cond, msg):
    if not cond:
        raise AssertionError(msg)


def check(name, fn):
    try:
        fn()
        print("  ok   %s" % name)
        return True
    except AssertionError as exc:
        print("  FAIL %s -> %s" % (name, exc))
        return False


def main():
    root = tempfile.mkdtemp(prefix="annostudio-")
    ok = True
    try:
        print("工作目录: %s" % root)

        for name in ("a.png", "b.png", "img_2.png", "img_10.png"):
            with open(os.path.join(root, name), "wb") as fh:
                fh.write(PNG_1PX)
        with open(os.path.join(root, "notes.txt"), "w") as fh:
            fh.write("不是图片")
        # 这批用例按 VOC 语义造数据，显式写上，别依赖全局默认格式
        dataset.save_config(root, format="voc")

        def t_scan():
            found = dataset.scan_images(root)
            expect("notes.txt" not in found, "不该把 txt 当图片")
            expect(len(found) == 4, "应找到 4 张图，实际 %d" % len(found))
            expect(found.index("img_2.png") < found.index("img_10.png"), "自然排序失效")

        def t_safe():
            expect(paths.safe_path(root, "a.png").endswith("a.png"), "正常路径被拒")
            try:
                paths.safe_path(root, "../outside.png")
            except ValueError:
                return
            raise AssertionError("越界路径没被拒绝")

        def t_voc():
            boxes = [
                {"label": "person", "x1": 10.4, "y1": 20.6, "x2": 100.2, "y2": 200.9},
                {"label": "dog", "x1": 5, "y1": 6, "x2": 50, "y2": 60},
            ]
            formats.write_voc(root, "a.png", {"w": 640, "h": 480}, boxes)
            path = paths.ann_path(root, "a.png", "voc")
            expect(os.path.isfile(path), "VOC 文件没写出来")
            back, size = formats.read_voc(path)
            expect(len(back) == 2, "读回来框数量不对: %d" % len(back))
            expect(size == {"w": 640, "h": 480}, "图像尺寸丢失: %r" % (size,))
            expect(back[0]["label"] == "person", "标签错误")
            expect(back[0]["x1"] == 10 and back[0]["y1"] == 21, "取整不对: %r" % (back[0],))

        def t_voc_empty_dims():
            formats.write_voc(root, "b.png", {"w": 100, "h": 100}, [])
            back, size = formats.read_voc(paths.ann_path(root, "b.png", "voc"))
            expect(back == [], "空标注应读回 0 个框")
            expect(size == {"w": 100, "h": 100}, "空标注也要保留尺寸")

        def t_yolo():
            norm = [{"label": "cat", "cx": 0.5, "cy": 0.25, "bw": 0.2, "bh": 0.1}]
            formats.write_yolo(root, "a.png", ["cat", "dog"], norm)
            path = paths.ann_path(root, "a.png", "yolo")
            expect(path.endswith(os.path.join("labels", "a.txt")),
                   "YOLO 应放在 labels/ 下: %s" % path)
            back = formats.read_yolo(path)
            expect(len(back) == 1, "YOLO 读回数量不对")
            expect(back[0]["cls"] == 0, "类别序号不对")
            expect(abs(back[0]["cx"] - 0.5) < 1e-6, "cx 不精确")

        def t_open_folder():
            data = dataset.analyze(root)
            expect(len(data["images"]) == 4, "打开文件夹应返回 4 张图")
            expect(any(i["ann"] for i in data["images"]), "应识别出已有标注")
            expect("person" in data["classes"] or "cat" in data["classes"],
                   "类别没自动收集: %r" % (data["classes"],))

        def t_corrupt():
            path = paths.ann_path(root, "img_2.png", "voc")
            with open(path, "wb") as fh:
                fh.write(b"<annotation><object>")  # 故意写坏的 XML
            try:
                formats.read_voc(path)
            except Exception:
                return
            raise AssertionError("坏 XML 应该抛异常")

        def t_labeldir():
            labels = os.path.join(root, "labels")
            boxes = [{"label": "person", "x1": 1, "y1": 2, "x2": 30, "y2": 40}]
            path = formats.write_voc(root, "img_10.png", {"w": 100, "h": 100}, boxes, labels)
            expect(path.startswith(labels), "自定义标注目录没生效: %s" % path)
            expect(os.path.isfile(path), "标注没写进自定义目录")
            expect(not os.path.isfile(os.path.join(root, "img_10.xml")),
                   "不该同时写进图片目录")
            back, size = formats.read_voc(path)
            expect(len(back) == 1 and size["w"] == 100, "自定义目录读回不正确")
            expect(paths.ann_path(root, "img_10.png", "voc", labels) == path,
                   "ann_path 与写入位置不一致")

        def t_labeldir_paths():
            stored = paths.store_label_dir(root, os.path.join(root, "labels"))
            expect(stored == "labels", "目录内应存相对路径，实际 %r" % stored)

            sibling = os.path.join(os.path.dirname(root), "elsewhere")
            expect(paths.store_label_dir(root, sibling) == "../elsewhere",
                   "同级目录应存 ../xxx，实际 %r" % paths.store_label_dir(root, sibling))

            far = os.path.join(os.path.dirname(os.path.dirname(root)), "far")
            expect(paths.store_label_dir(root, far) == far,
                   "隔两层以上应存绝对路径，实际 %r" % paths.store_label_dir(root, far))

            expect(paths.resolve_label_dir(root, "labels") == os.path.join(root, "labels"),
                   "相对路径解析错误")
            expect(paths.resolve_label_dir(root, "../labels") ==
                   os.path.normpath(os.path.join(root, "..", "labels")),
                   "../ 相对路径解析错误")
            expect(paths.resolve_label_dir(root, "") is None, "空值应表示默认位置")

        def t_session():
            s = session.Session()
            info = s.open(root)
            expect(info["folder"] == os.path.abspath(root), "Session 没记住目录")
            expect(len(info["images"]) == 4, "Session 图片数量不对")

            res = s.write_annotations(
                "b.png", {"w": 100, "h": 100},
                [{"label": "cat", "x1": 1, "y1": 2, "x2": 30, "y2": 40}])
            expect(res["boxes"] == 1, "写入数量不对")
            back = s.read_annotations("b.png")
            expect(len(back["boxes"]) == 1, "写进去读不回来")
            expect(back["boxes"][0]["label"] == "cat", "标签不对")

            empty = s.read_annotations("img_2.png")
            expect(empty["boxes"] == [] and empty["exists"] is False, "不该有标注")

            # 删光所有框 -> 标注文件应被移除
            s.write_annotations("b.png", {"w": 100, "h": 100}, [])
            expect(not os.path.isfile(paths.ann_path(root, "b.png", "voc")),
                   "删光框后文件应被移除")

            s.set_format("yolo")
            expect(s.format == "yolo", "格式没切换")
            r = s.set_label_dir("labels")
            expect(r["label_dir"].endswith("labels"), "标注目录没切换")
            s.set_label_dir("")
            expect(s.label_dir is None, "没切回默认位置")

            try:
                session.Session().write_annotations("x.png", {"w": 10, "h": 10}, [])
            except session.SessionError:
                pass
            else:
                raise AssertionError("没打开目录时应报 SessionError")

        def t_rescan():
            base = os.path.join(root, "rescan")
            os.makedirs(base)
            open(os.path.join(base, "r1.jpg"), "wb").write(PNG_1PX)
            formats.write_voc(base, "r1.jpg", {"w": 50, "h": 50},
                              [{"label": "alpha", "x1": 1, "y1": 1, "x2": 10, "y2": 10}])
            dataset.save_config(base, format="voc")   # 这个用例针对 VOC 重扫

            s = session.Session()
            s.open(base)
            expect(s.classes == ["alpha"], "打开时应自动收集到 alpha，实际 %r" % (s.classes,))

            # 人为清空缓存，模拟「类别列表过期」
            s.set_classes([])
            formats.write_voc(base, "r1.jpg", {"w": 50, "h": 50},
                              [{"label": "beta", "x1": 2, "y1": 2, "x2": 12, "y2": 12}])
            res = s.rescan_classes()
            expect(res["mode"] == "merge", "VOC 重扫应是合并模式")
            expect("beta" in res["classes"], "重扫没发现 beta: %r" % (res["classes"],))
            expect(res["scanned"] >= 1, "应至少扫描 1 个标注文件")

        def t_yolo_names():
            base = os.path.join(root, "yolo-names")
            os.makedirs(os.path.join(base, "labels"))
            for name in ("p1.jpg", "p2.jpg"):
                open(os.path.join(base, name), "wb").write(PNG_1PX)
            with open(os.path.join(base, "labels", "p1.txt"), "w") as fh:
                fh.write("0 0.5 0.5 0.2 0.2\n")

            s = session.Session()
            s.open(base)
            res = s.set_format("yolo")
            expect(res.get("warning"), "缺 classes.txt 时应给出 warning")

            ann = s.read_annotations("p1.jpg")
            expect(ann.get("missing_classes") is True, "应标记缺类别名")
            expect(ann["boxes"][0]["label"] == "class_0",
                   "缺名字时应是占位名，实际 %r" % (ann["boxes"][0]["label"],))

            # 填了映射后：写回 classes.txt，标签立刻变成真名
            s.set_classes(["helmet"])
            expect(os.path.isfile(os.path.join(base, "classes.txt")),
                   "YOLO 模式下改类别应写 classes.txt")
            expect(dataset.read_yolo_classes(base) == ["helmet"], "classes.txt 内容不对")
            expect(s.read_annotations("p1.jpg")["boxes"][0]["label"] == "helmet",
                   "映射后标签应变成真名")

            # 重扫应直接采用 classes.txt 的顺序
            with open(os.path.join(base, "classes.txt"), "w", encoding="utf-8") as fh:
                fh.write("helmet\nvest\n")
            res2 = s.rescan_classes()
            expect(res2["mode"] == "replace", "YOLO 重扫应是替换模式")
            expect(res2["classes"] == ["helmet", "vest"], "应整份替换为 classes.txt 的内容")

            # 没有 classes.txt 时重扫应明确报错，而不是瞎猜
            os.remove(os.path.join(base, "classes.txt"))
            try:
                s.rescan_classes()
            except session.SessionError:
                pass
            else:
                raise AssertionError("缺 classes.txt 时重扫应报错")

        def t_classes_file():
            base = os.path.join(root, "clsfile")
            os.makedirs(base)
            open(os.path.join(base, "x.jpg"), "wb").write(PNG_1PX)
            shared = os.path.join(root, "shared_classes.txt")
            with open(shared, "w", encoding="utf-8") as fh:
                fh.write("red\ngreen\n")

            s = session.Session()
            s.open(base)
            expect(s.classes == [], "空目录应没有类别")
            res = s.set_classes_file(shared)
            expect(res["classes"] == ["red", "green"],
                   "应读到指定文件: %r" % (res["classes"],))

            s.set_classes(["red", "green", "blue"])
            names = dataset.read_names_file(shared)
            expect(names == ["red", "green", "blue"],
                   "改动应写回指定文件: %r" % (names,))

            try:
                s.set_classes_file(os.path.join(root, "nope.txt"))
            except session.SessionError:
                pass
            else:
                raise AssertionError("文件不存在时应报错")

            s.set_classes_file("")
            expect(s.classes_file is None, "恢复自动后应清空指针")

        def t_layout():
            base = os.path.join(root, "layout")
            img = os.path.join(base, "images")
            lbl = os.path.join(base, "labels")
            os.makedirs(img)
            os.makedirs(lbl)
            for n in ("a.jpg", "b.jpg"):
                open(os.path.join(img, n), "wb").write(PNG_1PX)
            with open(os.path.join(lbl, "a.txt"), "w") as fh:
                fh.write("0 0.5 0.5 0.2 0.2\n")
            with open(os.path.join(base, "classes.txt"), "w", encoding="utf-8") as fh:
                fh.write("cat\ndog\n")

            info = dataset.analyze(base)
            expect(info["auto_layout"] is True, "应识别 images/labels 布局")
            expect(os.path.basename(info["folder"]) == "images",
                   "图片目录应为 images: %s" % info["folder"])
            expect(info["label_dir"] == lbl, "标注目录应为 labels: %s" % info["label_dir"])
            expect(info["classes"] == ["cat", "dog"],
                   "应读到数据集根目录的 classes.txt: %r" % (info["classes"],))

            s = session.Session()
            s.open(base)
            s.set_format("yolo")
            ann = s.read_annotations("a.jpg")
            expect(len(ann["boxes"]) == 1 and ann["boxes"][0]["label"] == "cat",
                   "YOLO 标签应映射成 cat: %r" % (ann["boxes"],))

            res = s.write_annotations("b.jpg", {"w": 100, "h": 100},
                                      [{"label": "dog", "x1": 10, "y1": 10, "x2": 40, "y2": 40}])
            expect(os.path.dirname(res["saved"]) == lbl,
                   "标注应写进 labels/: %s" % res["saved"])
            expect(not os.path.isfile(os.path.join(img, "b.txt")),
                   "不该写进 images/")

            info2 = dataset.analyze(img)
            expect(info2["auto_layout"] is True and info2["label_dir"] == lbl,
                   "直接选中 images/ 也应识别同级 labels/")

        def t_close():
            s = session.Session()
            s.open(root)
            expect(s.folder is not None, "应先打开目录")
            s.close()
            st = s.state()
            expect(st["folder"] is None, "关闭后 folder 应为空: %r" % (st["folder"],))
            expect(st["images"] == [], "关闭后图片列表应为空")
            expect(st["format"] == dataset.DEFAULT_FORMAT, "关闭后应回到默认格式")
            expect(st["label_dir"] == "", "关闭后标注目录应清空")

        def t_polygon():
            base = os.path.join(root, "poly")
            os.makedirs(os.path.join(base, "labels"))
            open(os.path.join(base, "p1.jpg"), "wb").write(PNG_1PX)
            with open(os.path.join(base, "classes.txt"), "w", encoding="utf-8") as fh:
                fh.write("lesion\n")
            label_file = os.path.join(base, "labels", "p1.txt")
            with open(label_file, "w") as fh:
                fh.write("0 0.1 0.1 0.5 0.1 0.5 0.5 0.1 0.5\n")

            items = formats.read_yolo(label_file)
            expect(len(items) == 1 and items[0]["kind"] == "poly",
                   "应识别成多边形: %r" % (items,))
            expect(len(items[0]["points"]) == 4, "应有 4 个点")

            # 框和多边形混在一份文件里也能区分
            with open(label_file, "w") as fh:
                fh.write("0 0.5 0.5 0.2 0.2\n0 0.1 0.1 0.5 0.1 0.5 0.5\n")
            mixed = formats.read_yolo(label_file)
            expect(len(mixed) == 2, "应解析出 2 条")
            expect(mixed[0]["kind"] == "box" and mixed[1]["kind"] == "poly",
                   "框和应多边形要区分开: %r" % (mixed,))

            s = session.Session()
            s.open(base)
            ann = s.read_annotations("p1.jpg")
            expect(ann["readonly"] is True, "含多边形的图应只读")
            expect(len(ann["polygons"]) == 1 and len(ann["boxes"]) == 1,
                   "应返回 1 个框 + 1 个多边形")

            before = open(label_file).read()
            try:
                s.write_annotations("p1.jpg", {"w": 100, "h": 100},
                                    [{"label": "lesion", "x1": 1, "y1": 1, "x2": 30, "y2": 30}])
            except session.SessionError:
                pass
            else:
                raise AssertionError("多边形文件应拒绝写入")
            expect(open(label_file).read() == before, "多边形文件被改动了")

        ok &= check("扫描图片 + 自然排序", t_scan)
        ok &= check("路径越界防护", t_safe)
        ok &= check("VOC 写入 / 读回", t_voc)
        ok &= check("空标注保留尺寸", t_voc_empty_dims)
        ok &= check("YOLO 写入 / 读回", t_yolo)
        ok &= check("打开文件夹 + 类别收集", t_open_folder)
        ok &= check("坏 XML 能被识别", t_corrupt)
        ok &= check("独立标注目录写入 / 读回", t_labeldir)
        ok &= check("标注目录相对/绝对路径处理", t_labeldir_paths)
        ok &= check("Session 读写与状态切换", t_session)
        ok &= check("重新扫描类别", t_rescan)
        ok &= check("YOLO 类别名与占位名处理", t_yolo_names)
        ok &= check("指定类别文件 / 写回 / 恢复自动", t_classes_file)
        ok &= check("images/labels 布局自动识别", t_layout)
        ok &= check("关闭目录回到初始状态", t_close)
        ok &= check("多边形 YOLO 解析与只读保护", t_polygon)
    finally:
        shutil.rmtree(root, ignore_errors=True)

    print("")
    print("全部通过" if ok else "有失败项")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
