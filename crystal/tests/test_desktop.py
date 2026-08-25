#!/usr/bin/env python3
"""Crystal 桌面版离线测试（全部 mock 网络/付费图像调用，无真实请求）。

覆盖：动态背景库（任意文件/添加/删除/外部路径拒绝/快照）、frozen 与源码
app_dir 语义、配置往返与 Token Plan 校验、视觉源图分析（有效/畸形/用户要求）、
base QA 失败即停、任意背景无文件名分支进入 generate_base_scene、placements
校验、编排阶段顺序、compose 进度回调（CLI 行为不变）、标注确定性与夹紧、
桌面编排无 Agent/JSON 用户步骤、测试全程零网络。
"""

import inspect
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import crystal  # noqa: E402
import desktop_core as dc  # noqa: E402


def make_img(path, size=(64, 64), color=(120, 130, 140)):
    Image.new("RGB", size, color).save(path)
    return Path(path)


VALID_ANALYSIS = {
    "bracelet_bbox_1000": [100, 100, 900, 900],
    "bead_groups": [
        {"display_name": "圆珠1",
         "visual_identity": "round translucent pale pink bead",
         "representative_bbox_1000": [200, 200, 300, 300]},
        {"display_name": "方珠1",
         "visual_identity": "opaque dark square bead",
         "representative_bbox_1000": [400, 400, 480, 480]},
    ],
}

VALID_QA = {"pass": True, "reason": "", "placements": [
    {"reference_index": 2, "bbox_1000": [600, 700, 680, 780]},
    {"reference_index": 1, "bbox_1000": [150, 700, 230, 780]},
]}


def vision_reply(obj):
    return json.dumps(obj, ensure_ascii=False)


# ---------------------------------------------------------------- 1-5 背景库

class BackgroundLibraryTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="crystal_bg_"))
        self._patcher = mock.patch.object(dc, "app_dir", return_value=self.tmp)
        self._patcher.start()
        self.bg = dc.background_dir()
        self.assertEqual(self.bg, self.tmp / "templates")

    def tearDown(self):
        self._patcher.stop()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_list_arbitrary_files_no_six_file_assumption(self):
        make_img(self.bg / "zebra.png")
        make_img(self.bg / "apple.jpg")
        make_img(self.bg / "10.webp")
        (self.bg / "notes.txt").write_text("not an image")
        (self.bg / "broken.jpg").write_bytes(b"\x00garbage")  # 扩展名对但不可读
        names = [p.name for p in dc.list_backgrounds()]
        self.assertEqual(names, ["10.webp", "apple.jpg", "zebra.png"],
                         "任意数量/任意名称，大小写不敏感自然排序，剔除不可读")

    def test_add_appears_and_collision_renames(self):
        src = make_img(self.tmp / "nice.jpg")
        added = dc.add_background(src)
        self.assertEqual(added.name, "nice.jpg")
        self.assertIn("nice.jpg", [p.name for p in dc.list_backgrounds()])
        again = dc.add_background(src)
        self.assertEqual(again.name, "nice (2).jpg", "重名必须递增为 name (2)")

    def test_delete_removes(self):
        make_img(self.bg / "gone.png")
        dc.delete_background(self.bg / "gone.png")
        self.assertNotIn("gone.png", [p.name for p in dc.list_backgrounds()])

    def test_delete_outside_path_rejected(self):
        outside = make_img(self.tmp / "outside.jpg")
        with self.assertRaises(dc.DesktopError):
            dc.delete_background(outside)
        with self.assertRaises(dc.DesktopError):
            dc.delete_background(self.bg / ".." / "outside.jpg")
        self.assertTrue(outside.exists(), "外部文件不得被删除")

    def test_snapshot_detects_external_changes(self):
        f = make_img(self.bg / "watch.jpg")
        s1 = dc.background_snapshot()
        make_img(self.bg / "watch.jpg", size=(80, 80), color=(9, 9, 9))
        s2 = dc.background_snapshot()
        self.assertNotEqual(s1, s2, "内容变化必须改变快照")
        make_img(self.bg / "added.png")
        s3 = dc.background_snapshot()
        self.assertNotEqual(s2, s3, "外部新增必须改变快照")
        (self.bg / "added.png").unlink()
        s4 = dc.background_snapshot()
        self.assertNotEqual(s3, s4, "外部删除必须改变快照")
        self.assertEqual(s2, s4)


# ---------------------------------------------------------------- 6 app_dir

class AppDirTest(unittest.TestCase):
    def test_source_mode_app_dir(self):
        self.assertFalse(getattr(sys, "frozen", False))
        self.assertEqual(dc.app_dir(), Path(dc.__file__).resolve().parent)

    def test_frozen_mode_app_dir(self):
        tmp = Path(tempfile.mkdtemp(prefix="crystal_frozen_"))
        saved = (getattr(sys, "frozen", None), sys.executable)
        try:
            sys.frozen = True
            sys.executable = str(tmp / "Crystal.exe")
            # Windows 短路径（8.3）下 resolve 结果可能与 tempfile 字面不同，
            # 用同一条 resolve 路径对比语义而非字面
            self.assertEqual(dc.app_dir(),
                             Path(tmp / "Crystal.exe").resolve().parent)
            self.assertNotEqual(dc.app_dir(),
                                Path(dc.__file__).resolve().parent,
                                "frozen 模式必须取 exe 目录而非源码目录")
        finally:
            if saved[0] is None:
                del sys.frozen
            else:
                sys.frozen = saved[0]
            sys.executable = saved[1]
            shutil.rmtree(tmp, ignore_errors=True)


# ---------------------------------------------------------------- 7-8 配置

class ConfigTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="crystal_cfg_"))
        self._env = mock.patch.dict(os.environ, {
            "APPDATA": str(self.tmp / "appdata"),
            "LOCALAPPDATA": str(self.tmp / "localappdata"),
        })
        self._env.start()

    def tearDown(self):
        self._env.stop()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_save_load_roundtrip_outside_repo(self):
        cfg = dc.AppConfig(api_key="sk-sp-test-key",
                           image_api_url="",
                           vision_api_url="https://v.example/x",
                           vision_model="qwen3.7-plus",
                           base_model="qwen-image-3.0-pro",
                           edit_model="wan2.7-image-pro")
        dc.save_config(cfg)
        path = dc.config_path()
        self.assertTrue(str(path).startswith(str(self.tmp)),
                        "配置绝不得写入仓库")
        loaded = dc.load_config()
        self.assertEqual(loaded, cfg)

    def test_token_plan_vs_non_token_plan_validation(self):
        tp = dc.AppConfig(api_key="sk-sp-abc")
        self.assertEqual(dc.config_issues(tp), [],
                         "Token Plan key 无需图像 API URL")
        plain = dc.AppConfig(api_key="sk-plain")
        self.assertEqual(dc.config_issues(plain),
                         ["非 Token Plan Key 需要填写图像 API URL"])
        plain.image_api_url = "https://img.example/v1"
        self.assertEqual(dc.config_issues(plain), [])
        self.assertEqual(dc.config_issues(dc.AppConfig()), ["未配置 API Key"])

    def test_vision_url_resolution(self):
        cfg = dc.AppConfig(api_key="sk-sp-abc")
        self.assertEqual(dc.resolve_vision_url(cfg), dc.VISION_TOKEN_PLAN_URL)
        cfg2 = dc.AppConfig(api_key="sk-plain")
        self.assertEqual(dc.resolve_vision_url(cfg2), dc.VISION_DEFAULT_URL)
        cfg3 = dc.AppConfig(api_key="sk-sp-abc",
                            vision_api_url="https://v.example/x")
        self.assertEqual(dc.resolve_vision_url(cfg3), "https://v.example/x")


# ---------------------------------------------------------------- 9-11 源图视觉

class SourceVisionTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="crystal_vis_"))
        self.img = make_img(self.tmp / "src.png", size=(400, 400))
        self.cfg = dc.AppConfig(api_key="sk-sp-test")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_valid_vision_output_passes_existing_validate_analysis(self):
        with mock.patch.object(dc, "_vision_chat",
                               return_value=vision_reply(
                                   {"ok": True, "analysis": VALID_ANALYSIS})):
            result = dc.analyze_source_image(self.img, "", self.cfg)
        self.assertEqual(result, crystal.validate_analysis(VALID_ANALYSIS))

    def test_malformed_vision_output_rejected_not_repaired(self):
        for bad in ("not json at all",
                    vision_reply({"ok": True}),
                    vision_reply({"ok": True, "analysis": {"bead_groups": []}}),
                    vision_reply(["ok"])):
            with mock.patch.object(dc, "_vision_chat", return_value=bad):
                with self.assertRaises(dc.DesktopError) as ctx:
                    dc.analyze_source_image(self.img, "", self.cfg)
                self.assertIn("原图识别结果无效", str(ctx.exception))

    def test_ok_false_surfaces_user_reason(self):
        with mock.patch.object(dc, "_vision_chat",
                               return_value=vision_reply(
                                   {"ok": False, "error": "图中没有手镯"})):
            with self.assertRaises(dc.DesktopError) as ctx:
                dc.analyze_source_image(self.img, "", self.cfg)
        self.assertEqual(str(ctx.exception), "图中没有手镯")
        with mock.patch.object(dc, "_vision_chat",
                               return_value=vision_reply({"ok": False})):
            with self.assertRaises(dc.DesktopError) as ctx:
                dc.analyze_source_image(self.img, "", self.cfg)
        self.assertEqual(str(ctx.exception), "原图与描述无法对应")

    def test_user_instruction_present_in_request(self):
        captured = {}

        def fake_chat(cfg, messages, timeout=120):
            captured["messages"] = messages
            return vision_reply({"ok": True, "analysis": VALID_ANALYSIS})

        with mock.patch.object(dc, "_vision_chat", side_effect=fake_chat):
            dc.analyze_source_image(self.img, "3种珠子，2种圆珠、1种方珠",
                                    self.cfg)
        payload = json.dumps(captured["messages"], ensure_ascii=False)
        self.assertIn("3种珠子，2种圆珠、1种方珠", payload,
                      "用户自然语言要求必须进入源图分析请求")
        self.assertIn("data:image", payload, "源图必须随请求发送")


# ---------------------------------------------------------------- 12/14 QA 规划

class QaPlanningTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="crystal_qa_"))
        self.base = make_img(self.tmp / "base.png", size=(600, 800))
        self.cfg = dc.AppConfig(api_key="sk-sp-test")
        self.analysis = crystal.validate_analysis(VALID_ANALYSIS)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_placement_output_passes_existing_validate_placements(self):
        with mock.patch.object(dc, "_vision_chat",
                               return_value=vision_reply(VALID_QA)):
            placements = dc.inspect_base_and_plan(self.base, self.analysis,
                                                  self.cfg)
        self.assertEqual(
            placements,
            crystal.validate_placements(VALID_QA, 2))
        self.assertEqual([p["reference_index"] for p in placements], [1, 2])

    def test_qa_fail_raises_with_reason(self):
        with mock.patch.object(dc, "_vision_chat",
                               return_value=vision_reply(
                                   {"pass": False,
                                    "reason": "基础场景存在多余散珠"})):
            with self.assertRaises(dc.DesktopError) as ctx:
                dc.inspect_base_and_plan(self.base, self.analysis, self.cfg)
        self.assertIn("基础场景检查失败", str(ctx.exception))
        self.assertIn("基础场景存在多余散珠", str(ctx.exception))


# ---------------------------------------------------------------- 16 compose 进度

class ComposeProgressTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="crystal_prog_"))
        self.base = make_img(self.tmp / "base.png", size=(300, 400))
        self.assets = [{"path": make_img(self.tmp / f"ref{i}.png"),
                        "visual_identity": f"id-{i}"} for i in range(1, 4)]
        self.placements = crystal.validate_placements({"placements": [
            {"reference_index": 1, "bbox_1000": [50, 50, 150, 150]},
            {"reference_index": 2, "bbox_1000": [400, 50, 500, 150]},
            {"reference_index": 3, "bbox_1000": [50, 250, 150, 350]}]}, 3)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _fake_edit(self, base_path, asset, bbox_1000, output_path):
        Image.new("RGB", (300, 400), (200, 200, 200)).save(output_path)
        return Path(output_path)

    def test_progress_callback_reports_i_of_n(self):
        events = []
        with mock.patch.object(crystal, "generate_representative_edit",
                               side_effect=self._fake_edit):
            crystal.compose_representatives(
                self.base, self.assets, self.placements,
                self.tmp / "c1.png", self.tmp / "work",
                progress_callback=lambda i, total: events.append((i, total)))
        self.assertEqual(events, [(1, 3), (2, 3), (3, 3)])

    def test_cli_behavior_unchanged_without_callback(self):
        sig = inspect.signature(crystal.compose_representatives)
        self.assertIsNone(sig.parameters["progress_callback"].default,
                          "缺省不传回调时 CLI 行为必须不变")
        with mock.patch.object(crystal, "generate_representative_edit",
                               side_effect=self._fake_edit):
            out = crystal.compose_representatives(
                self.base, self.assets, self.placements,
                self.tmp / "c2.png", self.tmp / "work")
        self.assertTrue(Path(out).exists())


# ---------------------------------------------------------------- 17 标注

class LabelDerivationTest(unittest.TestCase):
    def setUp(self):
        self.analysis = crystal.validate_analysis(VALID_ANALYSIS)
        self.placements = crystal.validate_placements(VALID_QA, 2)

    def test_labels_deterministic_and_clamped(self):
        a = dc.derive_labels(self.analysis, self.placements, 1200, 1600)
        b = dc.derive_labels(self.analysis, self.placements, 1200, 1600)
        self.assertEqual(a, b, "标注必须确定性推导")
        self.assertEqual([lb["text"] for lb in a], ["圆珠1", "方珠1"])
        for lb in a:
            self.assertGreaterEqual(lb["y"], 0)
            self.assertLess(lb["y"], 1600)
            self.assertGreater(lb["x"], 0)
            self.assertLess(lb["x"], 1200)
            cx, cy = lb["point_to"]
            self.assertTrue(0 <= cx <= 1200 and 0 <= cy <= 1600)

    def test_label_moves_above_when_no_room_below(self):
        bottom = crystal.validate_placements({"placements": [
            {"reference_index": 1, "bbox_1000": [100, 850, 200, 980]},
            {"reference_index": 2, "bbox_1000": [500, 850, 600, 980]}]}, 2)
        labels = dc.derive_labels(self.analysis, bottom, 1200, 1600)
        for lb, placement in zip(labels, bottom):
            bbox_px = crystal.bbox1000_to_pixels(placement["bbox_1000"],
                                                 1200, 1600)
            self.assertLess(lb["y"], bbox_px[1], "下方无空间时必须放到框上方")

    def test_label_clamped_for_edge_boxes(self):
        edge = crystal.validate_placements({"placements": [
            {"reference_index": 1, "bbox_1000": [0, 0, 60, 60]},
            {"reference_index": 2, "bbox_1000": [940, 940, 1000, 1000]}]}, 2)
        labels = dc.derive_labels(self.analysis, edge, 600, 800)
        for lb in labels:
            self.assertGreaterEqual(lb["y"], 0)
            self.assertLess(lb["y"], 800)
            self.assertGreater(lb["x"], 0)
            self.assertLess(lb["x"], 600)


# ---------------------------------------------------------------- 12/13/15/18/19 编排

class OrchestrationTest(unittest.TestCase):
    ENV_KEYS = ("DASHSCOPE_API_KEY", "DASHSCOPE_API_URL",
                "CRYSTAL_BASE_MODEL", "CRYSTAL_IMAGE_MODEL")

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="crystal_orch_"))
        self._env = mock.patch.dict(os.environ, {
            "APPDATA": str(self.tmp / "appdata"),
            "LOCALAPPDATA": str(self.tmp / "localappdata"),
        })
        self._env.start()
        self._saved_env = {k: os.environ.get(k) for k in self.ENV_KEYS}

        self.source = make_img(self.tmp / "手镯原图.png", size=(800, 800))
        # 任意名称背景：验证无文件名分支
        self.background = make_img(self.tmp / "我的 背景07.webp",
                                   size=(500, 700))
        self.cfg = dc.AppConfig(api_key="sk-test-key-123456",
                                image_api_url="https://img.example/v1")

        self.order = []
        self.base_calls = []
        self.edit_calls = []

        def fake_vision(cfg, messages, timeout=120):
            if len([o for o in self.order if o.startswith("vision")]) == 0:
                self.order.append("vision-analysis")
                return vision_reply({"ok": True, "analysis": VALID_ANALYSIS})
            self.order.append("vision-qa")
            return vision_reply(VALID_QA)

        def fake_base_scene(clean_src, template, output_path, size="1200*1600"):
            self.order.append("base-scene")
            self.base_calls.append({"clean": Path(clean_src),
                                    "template": Path(template), "size": size})
            Image.new("RGB", (1200, 1600), (240, 238, 232)).save(output_path)
            return Path(output_path)

        def fake_image_model(model, images, prompt, output_path, **kw):
            self.order.append("edit-call")
            self.edit_calls.append({"model": model})
            Image.new("RGB", (1200, 1600), (228, 226, 220)).save(output_path)
            return Path(output_path)

        self._patchers = [
            mock.patch.object(dc, "_vision_chat", side_effect=fake_vision),
            mock.patch.object(crystal, "generate_base_scene",
                              side_effect=fake_base_scene),
            mock.patch.object(crystal, "_call_image_model",
                              side_effect=fake_image_model),
            # 19) 真实网络零容忍：任何漏网请求立即失败
            mock.patch("requests.post",
                       side_effect=AssertionError("测试禁止真实网络请求")),
            mock.patch("requests.get",
                       side_effect=AssertionError("测试禁止真实网络请求")),
        ]
        for p in self._patchers:
            p.start()

    def tearDown(self):
        for p in self._patchers:
            p.stop()
        self._env.stop()
        for k, v in self._saved_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_stage_order_artifacts_and_arbitrary_background(self):
        messages = []
        result = dc.generate_preview(self.source, self.background,
                                     "3种珠子，2种圆珠、1种方珠",
                                     True, self.cfg,
                                     progress=messages.append)

        # 15) 阶段顺序
        self.assertEqual(self.order,
                         ["vision-analysis", "base-scene", "vision-qa",
                          "edit-call", "edit-call"])
        self.assertEqual(messages, [
            "正在分析原图…", "正在生成基础场景…", "正在检查场景并规划珠位…",
            "正在生成散珠 1/2…", "正在合并画面…", "正在添加标注…", "生成完成"])

        run = result.run_dir
        # 运行隔离产物齐全
        for name in ("request.json", "analysis.json", "placements.json",
                     "base.png", "candidate.png", "final.png"):
            self.assertTrue((run / name).exists(), f"缺少 {name}")
        self.assertTrue((run / "source.png").exists())
        bg_copy = run / "background.webp"
        self.assertTrue(bg_copy.exists())

        # 13) 任意名称背景无文件名分支地进入 generate_base_scene
        self.assertEqual(len(self.base_calls), 1)
        call = self.base_calls[0]
        self.assertEqual(call["template"], bg_copy)
        self.assertEqual(bg_copy.read_bytes(), self.background.read_bytes(),
                         "必须使用所选背景本身的副本")
        self.assertEqual(call["size"], "1200*1600")
        self.assertEqual(len(self.edit_calls), 2, "N 组恰好 N 次独立编辑")

        # 2) request.json 不得含密钥
        request_txt = (run / "request.json").read_text(encoding="utf-8")
        self.assertNotIn("sk-test-key-123456", request_txt)
        self.assertIn("我的 背景07.webp", request_txt)
        self.assertIn("3种珠子", request_txt)

        self.assertTrue(result.final_path.exists())

    def test_no_labels_copies_candidate(self):
        result = dc.generate_preview(self.source, self.background, "",
                                     False, self.cfg)
        self.assertEqual(result.final_path.read_bytes(),
                         (result.run_dir / "candidate.png").read_bytes(),
                         "不标注时 final 必须是 candidate 的直接副本")

    def test_qa_fail_stops_before_compose(self):
        def failing_vision(cfg, messages, timeout=120):
            if not getattr(failing_vision, "called", False):
                failing_vision.called = True
                return vision_reply({"ok": True, "analysis": VALID_ANALYSIS})
            return vision_reply({"pass": False, "reason": "基础场景存在多余散珠"})

        compose_mock = mock.Mock(side_effect=AssertionError("QA 失败后不得 compose"))
        with mock.patch.object(dc, "_vision_chat", side_effect=failing_vision), \
                mock.patch.object(crystal, "compose_representatives",
                                  compose_mock):
            with self.assertRaises(dc.DesktopError) as ctx:
                dc.generate_preview(self.source, self.background, "",
                                    True, self.cfg)
        self.assertIn("基础场景检查失败", str(ctx.exception))
        self.assertIn("基础场景存在多余散珠", str(ctx.exception))
        compose_mock.assert_not_called()

    def test_error_txt_sanitized_and_written(self):
        def failing_vision(cfg, messages, timeout=120):
            raise dc.DesktopError(f"Bearer {self.cfg.api_key} 泄露测试")

        with mock.patch.object(dc, "_vision_chat", side_effect=failing_vision):
            with self.assertRaises(dc.DesktopError):
                dc.generate_preview(self.source, self.background, "",
                                    True, self.cfg)
        runs = list(dc.runs_dir().iterdir())
        self.assertEqual(len(runs), 1)
        err = (runs[0] / "error.txt").read_text(encoding="utf-8")
        self.assertNotIn(self.cfg.api_key, err, "error.txt 绝不得含密钥")
        self.assertNotIn("Bearer sk-", err)

    def test_orchestration_requires_no_agent_json_step(self):
        # 18) 桌面编排签名即全流程：用户不需要提供任何 analysis/placements/labels 文件
        params = list(inspect.signature(dc.generate_preview).parameters)
        self.assertEqual(params, ["source_path", "background_path",
                                  "user_instruction", "add_labels",
                                  "config", "progress"])

    def test_incomplete_config_rejected_before_run(self):
        bad = dc.AppConfig(api_key="sk-plain")  # 非 Token Plan 且无图像 URL
        with self.assertRaises(dc.DesktopError) as ctx:
            dc.generate_preview(self.source, self.background, "", True, bad)
        self.assertEqual(str(ctx.exception),
                         "非 Token Plan Key 需要填写图像 API URL")
        runs = dc.runs_dir()
        self.assertTrue(not runs.exists() or list(runs.iterdir()) == [],
                        "配置不完整时不得创建运行目录")


if __name__ == "__main__":
    unittest.main()
