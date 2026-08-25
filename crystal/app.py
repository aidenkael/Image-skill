#!/usr/bin/env python3
"""Crystal 桌面版 — Tkinter UI（仅 UI；业务/网络逻辑在 desktop_core.py / crystal.py）。

用法：
    pythonw app.py           # 桌面 GUI
    app.py --smoke-test      # 打包/源码冒烟：初始化路径、列背景、读配置、导入核心，
                             # 不启动 GUI、不联网、退出码 0
"""

import os
import queue
import shutil
import sys
import threading
from pathlib import Path

import tkinter as tk
from tkinter import filedialog, messagebox, ttk
from PIL import Image, ImageTk

import desktop_core as dc
from desktop_core import AppConfig, DesktopError

SOURCE_FILETYPES = [("图片", "*.jpg *.jpeg *.png *.webp"), ("所有文件", "*.*")]
BG_THUMB_SIZE = (150, 150)


def _fit_photo(path, max_w, max_h):
    with Image.open(path) as im:
        im = im.convert("RGB")
        im.thumbnail((max_w, max_h), Image.LANCZOS)
        return ImageTk.PhotoImage(im)


# ---------------------------------------------------------------- API 设置对话框

class ApiDialog(tk.Toplevel):
    """API 设置：保存 / 测试连接 / 取消；Key 掩码；结果只回传中文状态。"""

    def __init__(self, master, config, on_saved, on_test):
        super().__init__(master)
        self.title("API 设置")
        self.resizable(False, False)
        self._on_saved = on_saved
        self._on_test = on_test
        self._entries = {}

        rows = [
            ("api_key", "DASHSCOPE_API Key（必填）", True),
            ("image_api_url", "图像 API URL（sk-sp- 可留空）", False),
            ("vision_api_url", "视觉 API URL（可留空）", False),
            ("vision_model", "视觉模型", False),
            ("base_model", "基础场景模型", False),
            ("edit_model", "局部编辑模型", False),
        ]

        pad = {"padx": 10, "pady": 4}
        for i, (key, label, masked) in enumerate(rows):
            ttk.Label(self, text=label).grid(row=i, column=0, sticky="e", **pad)
            entry = ttk.Entry(self, width=52, show="*" if masked else "")
            entry.insert(0, str(getattr(config, key)))
            entry.grid(row=i, column=1, sticky="w", **pad)
            self._entries[key] = entry

        self._status = ttk.Label(self, text="", foreground="#666")
        self._status.grid(row=len(rows), column=0, columnspan=2,
                          sticky="w", padx=10, pady=(2, 0))

        bar = ttk.Frame(self)
        bar.grid(row=len(rows) + 1, column=0, columnspan=2, pady=10)
        ttk.Button(bar, text="测试连接",
                   command=self._test).pack(side="left", padx=6)
        ttk.Button(bar, text="保存",
                   command=self._save).pack(side="left", padx=6)
        ttk.Button(bar, text="取消",
                   command=self.destroy).pack(side="left", padx=6)

        self.transient(master)
        self.grab_set()

    def _collect(self) -> AppConfig:
        return AppConfig(**{key: entry.get().strip()
                            for key, entry in self._entries.items()})

    def _save(self):
        cfg = self._collect()
        try:
            dc.save_config(cfg)
        except Exception as e:
            messagebox.showerror("保存失败", f"配置保存失败：{e}", parent=self)
            return
        self._on_saved(cfg)
        self._status.config(text="已保存")

    def _test(self):
        self._save()
        self._status.config(text="正在测试连接…")
        self._on_test(self._collect(), self._test_result)

    def _test_result(self, ok, message):
        if self.winfo_exists():
            self._status.config(text=message,
                                foreground="#0a0" if ok else "#a00")


# ---------------------------------------------------------------- 主窗口

class App:
    def __init__(self):
        self.root = tk.Tk()
        self.root.title("Crystal")
        self.root.geometry("1180x760")
        self.root.minsize(980, 640)

        self._source_path = None
        self._source_photo = None
        self._selected_bg = None          # 当前选中背景文件名
        self._bg_snapshot = None
        self._bg_photos = []              # 保活缩略图引用
        self._result_path = None
        self._result_photo = None
        self._last_run_dir = None
        self._running = False
        self._queue = None
        self._api_status = "未配置"

        self._build_ui()
        self._refresh_api_status()
        self._refresh_backgrounds(force=True)
        self.root.after(1000, self._poll_backgrounds)

    # ---------------- UI 构建

    def _build_ui(self):
        top = ttk.Frame(self.root, padding=(12, 8))
        top.pack(fill="x")
        ttk.Label(top, text="Crystal", font=("", 16, "bold")).pack(side="left")
        ttk.Button(top, text="API 设置",
                   command=self._open_api_dialog).pack(side="right")
        self._api_label = ttk.Label(top, text="", foreground="#a60")
        self._api_label.pack(side="right", padx=12)

        body = ttk.Frame(self.root, padding=(12, 4))
        body.pack(fill="both", expand=True)
        body.columnconfigure(1, weight=1)
        body.rowconfigure(0, weight=1)

        self._build_source_pane(body)
        self._build_background_pane(body)
        self._build_result_pane(body)
        self._refresh_generate_state()

        bottom = ttk.Frame(self.root, padding=(12, 6))
        bottom.pack(fill="x")
        self._status = ttk.Label(bottom, text="就绪", foreground="#444")
        self._status.pack(side="left")

    def _build_source_pane(self, parent):
        pane = ttk.LabelFrame(parent, text=" 原图 ", padding=8)
        pane.grid(row=0, column=0, sticky="nsew", padx=(0, 8))

        self._source_label = ttk.Label(pane, anchor="center",
                                       width=40)
        self._source_label.pack(fill="both", expand=True)
        self._set_placeholder(self._source_label, "未上传原图")

        ttk.Button(pane, text="上传原图",
                   command=self._upload_source).pack(fill="x", pady=(6, 10))

        ttk.Label(pane, text="要求（自然语言，可留空）：").pack(anchor="w")
        self._instruction = tk.Text(pane, height=3, width=34)
        self._instruction.pack(fill="x")
        ttk.Label(pane, foreground="#888",
                  text="例如：3种珠子，两种圆珠，一种方珠").pack(anchor="w")

        self._add_labels_var = tk.BooleanVar(value=True)
        ttk.Checkbutton(pane, text="添加珠子名称标注",
                        variable=self._add_labels_var).pack(anchor="w", pady=6)

        self._generate_btn = tk.Button(
            pane, text="生成预览图", font=("", 12, "bold"),
            height=2, bg="#2d6cdf", fg="white",
            activebackground="#2458b8", activeforeground="white",
            command=self._generate)
        self._generate_btn.pack(fill="x", pady=(4, 6))
        self._generate_hint = ttk.Label(pane, text="", foreground="#a00")
        self._generate_hint.pack(anchor="w")

    def _build_background_pane(self, parent):
        pane = ttk.LabelFrame(parent, text=" 背景库 ", padding=8)
        pane.grid(row=0, column=1, sticky="nsew")

        bar = ttk.Frame(pane)
        bar.pack(fill="x")
        ttk.Button(bar, text="添加背景",
                   command=self._add_background).pack(side="left", padx=2)
        ttk.Button(bar, text="删除背景",
                   command=self._delete_background).pack(side="left", padx=2)
        ttk.Button(bar, text="打开背景文件夹",
                   command=lambda: os.startfile(dc.background_dir())
                   ).pack(side="left", padx=2)
        self._bg_count = ttk.Label(bar, text="", foreground="#888")
        self._bg_count.pack(side="right")

        self._bg_canvas = tk.Canvas(pane, highlightthickness=0)
        scroll = ttk.Scrollbar(pane, orient="vertical",
                               command=self._bg_canvas.yview)
        self._bg_inner = ttk.Frame(self._bg_canvas)
        self._bg_inner.bind(
            "<Configure>",
            lambda e: self._bg_canvas.configure(
                scrollregion=self._bg_canvas.bbox("all")))
        self._bg_canvas.create_window((0, 0), window=self._bg_inner,
                                      anchor="nw")
        self._bg_canvas.configure(yscrollcommand=scroll.set)
        self._bg_canvas.pack(side="left", fill="both", expand=True, pady=(6, 0))
        scroll.pack(side="left", fill="y", pady=(6, 0))

        def _on_mousewheel(event):
            self._bg_canvas.yview_scroll(int(-event.delta / 120), "units")
        self._bg_canvas.bind_all("<MouseWheel>", _on_mousewheel)

    def _build_result_pane(self, parent):
        pane = ttk.LabelFrame(parent, text=" 成品 ", padding=8)
        pane.grid(row=0, column=2, sticky="nsew", padx=(8, 0))

        self._result_label = ttk.Label(pane, anchor="center")
        self._result_label.pack(fill="both", expand=True)
        self._set_placeholder(self._result_label, "尚无成品")

        bar = ttk.Frame(pane)
        bar.pack(fill="x", pady=(6, 0))
        self._save_btn = ttk.Button(bar, text="保存成品",
                                    command=self._save_result, state="disabled")
        self._save_btn.pack(side="left", padx=2)
        self._open_dir_btn = ttk.Button(bar, text="打开输出文件夹",
                                        command=self._open_run_dir,
                                        state="disabled")
        self._open_dir_btn.pack(side="left", padx=2)
        self._regen_btn = ttk.Button(bar, text="重新生成",
                                     command=self._generate, state="disabled")
        self._regen_btn.pack(side="left", padx=2)

    def _set_placeholder(self, label, text):
        label.config(image="", text=f"\n\n{text}\n\n")

    # ---------------- API 状态 / 对话框

    def _refresh_api_status(self, text=None):
        if text is None:
            cfg = dc.load_config()
            issues = dc.config_issues(cfg)
            text = issues[0] if issues else "配置完整"
        self._api_status = text
        self._api_label.config(
            text=f"API：{text}",
            foreground="#0a0" if text in ("连接成功", "生成 API 已验证")
            else ("#a60" if text == "配置完整" else "#a00"))
        self._refresh_generate_state()

    def _open_api_dialog(self):
        ApiDialog(self.root, dc.load_config(),
                  on_saved=lambda cfg: self._refresh_api_status(),
                  on_test=self._run_connection_test)

    def _run_connection_test(self, cfg, callback):
        def worker():
            try:
                ok, message = dc.test_connection(cfg)
            except Exception as e:
                ok, message = False, dc.sanitize_error(f"连接失败：{e}", cfg)
            self.root.after(0, lambda: self._conn_done(ok, message, callback))

        threading.Thread(target=worker, daemon=True).start()

    def _conn_done(self, ok, message, callback):
        if ok:
            self._refresh_api_status("连接成功")
        callback(ok, message)

    # ---------------- 原图

    def _upload_source(self):
        path = filedialog.askopenfilename(
            title="选择手镯原图", filetypes=SOURCE_FILETYPES)
        if not path:
            return
        path = Path(path)
        try:
            self._source_photo = _fit_photo(path, 300, 300)
        except Exception as e:
            messagebox.showerror("打开失败", f"无法打开图片：{e}")
            return
        self._source_path = path
        self._source_label.config(image=self._source_photo, text="")
        self._refresh_generate_state()

    # ---------------- 背景库

    def _refresh_backgrounds(self, force=False):
        snapshot = dc.background_snapshot()
        if not force and snapshot == self._bg_snapshot:
            return
        self._bg_snapshot = snapshot

        for child in self._bg_inner.winfo_children():
            child.destroy()
        self._bg_photos = []

        backgrounds = dc.list_backgrounds()
        self._bg_count.config(
            text=f"{len(backgrounds)} 个背景" if backgrounds else "没有背景")

        if not backgrounds:
            ttk.Label(self._bg_inner, foreground="#888",
                      text="背景库为空：点击上方「添加背景」").grid(
                row=0, column=0, padx=8, pady=8)
            self._selected_bg = None
        else:
            cols = 4
            names = {p.name for p in backgrounds}
            if self._selected_bg not in names:
                self._selected_bg = None
            for i, path in enumerate(backgrounds):
                photo = self._make_bg_thumb(path)
                self._bg_photos.append(photo)
                selected = path.name == self._selected_bg
                label = tk.Label(
                    self._bg_inner, image=photo, bd=3,
                    relief="solid" if selected else "flat",
                    cursor="hand2",
                    bg="#2d6cdf" if selected else self._bg_inner.winfo_toplevel().cget("bg"))
                label.grid(row=i // cols, column=i % cols, padx=6, pady=6)
                label.bind("<Button-1>",
                           lambda e, name=path.name: self._select_bg(name))

        self._refresh_generate_state()

    def _make_bg_thumb(self, path):
        try:
            with Image.open(path) as im:
                im = im.convert("RGB")
                im.thumbnail(BG_THUMB_SIZE, Image.LANCZOS)
                return ImageTk.PhotoImage(im)
        except Exception:
            return ImageTk.PhotoImage(Image.new("RGB", BG_THUMB_SIZE,
                                                (220, 220, 220)))

    def _select_bg(self, name):
        self._selected_bg = name
        self._refresh_backgrounds(force=True)

    def _selected_bg_path(self):
        if not self._selected_bg:
            return None
        path = dc.background_dir() / self._selected_bg
        return path if path.is_file() else None

    def _add_background(self):
        path = filedialog.askopenfilename(
            title="添加背景", filetypes=SOURCE_FILETYPES)
        if not path:
            return
        try:
            added = dc.add_background(path)
        except DesktopError as e:
            messagebox.showerror("添加失败", str(e))
            return
        self._selected_bg = added.name
        self._refresh_backgrounds(force=True)

    def _delete_background(self):
        path = self._selected_bg_path()
        if path is None:
            messagebox.showinfo("删除背景", "请先在背景库中选择一张背景")
            return
        if not messagebox.askyesno("删除背景", f"删除背景「{path.name}」？"):
            return
        try:
            dc.delete_background(path)
        except DesktopError as e:
            messagebox.showerror("删除失败", str(e))
            return
        self._selected_bg = None   # 删除选中背景后清空选择
        self._refresh_backgrounds(force=True)

    def _poll_backgrounds(self):
        """每秒轮询一次背景库（无 watchdog）：快照变化才刷新。"""
        try:
            self._refresh_backgrounds()
        except Exception:
            pass
        self.root.after(1000, self._poll_backgrounds)

    # ---------------- 生成

    def _refresh_generate_state(self):
        if self._running:
            self._generate_btn.config(state="disabled")
            self._regen_btn.config(state="disabled")
            self._generate_hint.config(text="正在生成…")
            return
        reasons = []
        cfg = dc.load_config()
        reasons.extend(dc.config_issues(cfg))
        if self._source_path is None or not self._source_path.is_file():
            reasons.append("请先上传原图")
        if self._selected_bg_path() is None:
            reasons.append("没有可用背景，请先添加背景")
        if reasons:
            self._generate_btn.config(state="disabled")
            self._generate_hint.config(text=reasons[0])
        else:
            self._generate_btn.config(state="normal")
            self._generate_hint.config(text="")
        self._regen_btn.config(
            state="normal" if (not reasons and self._result_path) else "disabled")

    def _generate(self):
        if self._running:
            return
        cfg = dc.load_config()
        issues = dc.config_issues(cfg)
        if issues:
            messagebox.showwarning("配置不完整", issues[0])
            return
        if self._source_path is None:
            messagebox.showwarning("缺少原图", "请先上传原图")
            return
        background = self._selected_bg_path()
        if background is None:
            messagebox.showwarning("缺少背景", "没有可用背景，请先添加背景")
            return

        instruction = self._instruction.get("1.0", "end").strip()
        add_labels = self._add_labels_var.get()

        self._running = True
        self._queue = queue.Queue()
        self._save_btn.config(state="disabled")
        self._open_dir_btn.config(state="disabled")
        self._refresh_generate_state()
        self._set_status("准备生成…")

        thread = threading.Thread(
            target=self._generation_worker,
            args=(self._queue, self._source_path, background,
                  instruction, add_labels, cfg),
            daemon=True)
        thread.start()
        self.root.after(100, self._poll_queue)

    @staticmethod
    def _generation_worker(q, source, background, instruction, add_labels, cfg):
        """恰好一个生成线程：进度/结果/失败经 queue 回传主线程。"""
        try:
            result = dc.generate_preview(
                source, background, instruction, add_labels, cfg,
                progress=lambda msg: q.put(("progress", msg)))
            q.put(("done", str(result.final_path), str(result.run_dir)))
        except DesktopError as e:
            q.put(("error", str(e)))
        except Exception as e:
            q.put(("error", dc.sanitize_error(f"生成失败：{e}", cfg)))

    def _poll_queue(self):
        if self._queue is None:
            return
        try:
            while True:
                event = self._queue.get_nowait()
                kind = event[0]
                if kind == "progress":
                    self._set_status(event[1])
                elif kind == "done":
                    self._on_generated(Path(event[1]), Path(event[2]))
                    return
                elif kind == "error":
                    self._on_generation_failed(event[1])
                    return
        except queue.Empty:
            pass
        self.root.after(100, self._poll_queue)

    def _on_generated(self, final_path, run_dir):
        self._running = False
        self._result_path = final_path
        self._last_run_dir = run_dir
        try:
            self._result_photo = _fit_photo(final_path, 430, 580)
            self._result_label.config(image=self._result_photo, text="")
        except Exception:
            self._set_placeholder(self._result_label, "成品预览失败")
        self._save_btn.config(state="normal")
        self._open_dir_btn.config(state="normal")
        self._refresh_api_status("生成 API 已验证")
        self._set_status("生成完成")
        self._refresh_generate_state()

    def _on_generation_failed(self, message):
        self._running = False
        self._queue = None
        self._set_status(f"生成失败：{message}")
        self._refresh_api_status()
        self._refresh_generate_state()
        messagebox.showerror("生成失败", message)

    # ---------------- 成品操作

    def _save_result(self):
        if self._result_path is None or not self._result_path.is_file():
            return
        dest = filedialog.asksaveasfilename(
            title="保存成品", defaultextension=".png",
            initialfile="crystal_final.png",
            filetypes=[("PNG", "*.png"), ("JPEG", "*.jpg *.jpeg")])
        if not dest:
            return
        try:
            shutil.copyfile(self._result_path, dest)
        except Exception as e:
            messagebox.showerror("保存失败", f"保存成品失败：{e}")
            return
        self._set_status(f"已保存：{dest}")

    def _open_run_dir(self):
        if self._last_run_dir and Path(self._last_run_dir).is_dir():
            os.startfile(self._last_run_dir)

    def _set_status(self, text):
        self._status.config(text=text)

    # ---------------- 主循环

    def run(self):
        self.root.mainloop()


# ---------------------------------------------------------------- 冒烟模式

def smoke_test():
    """初始化路径、列背景、读配置（不打印密钥）、导入核心；不启动 GUI、不联网。"""
    import crystal

    bg_dir = dc.background_dir()
    backgrounds = dc.list_backgrounds()
    cfg = dc.load_config()
    dc.config_dir().mkdir(parents=True, exist_ok=True)
    dc.runs_dir().mkdir(parents=True, exist_ok=True)

    key_state = "未配置"
    if cfg.api_key.strip():
        tail = cfg.api_key.strip()[-4:]
        key_state = f"已配置（****{tail}）"

    print("[smoke] app_dir:", dc.app_dir())
    print("[smoke] background_dir:", bg_dir)
    print("[smoke] backgrounds:", len(backgrounds),
          [p.name for p in backgrounds[:10]])
    print("[smoke] config_dir:", dc.config_dir())
    print("[smoke] runs_dir:", dc.runs_dir())
    print("[smoke] api_key:", key_state)
    print("[smoke] vision_model:", cfg.vision_model,
          "| base_model:", cfg.base_model, "| edit_model:", cfg.edit_model)
    print("[smoke] crystal core:", Path(crystal.__file__).name)
    print("[smoke] OK")
    return 0


def main():
    if "--smoke-test" in sys.argv[1:]:
        sys.exit(smoke_test())
    App().run()


if __name__ == "__main__":
    main()
