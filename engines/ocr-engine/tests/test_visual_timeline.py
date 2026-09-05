# -*- coding: utf-8 -*-
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from visual_timeline import (
    NG_DOI,
    build_accurate_timeline,
    build_fast_timeline,
    clip_polygon_to_rect,
    jaccard,
    khung_on_dinh,
    normalize_rapidocr_item,
    phan_doan,
    polygon_shoelace_area,
    polygon_to_aabb,
    timeline_to_srt,
    write_visual_timeline,
)


def metadata(width=100, height=60, duration_seconds=0.25, frame_count=2, geometry_fingerprint="a" * 64):
    return {
        "width": width,
        "height": height,
        "duration_seconds": duration_seconds,
        "frame_count": frame_count,
        "geometry_fingerprint": geometry_fingerprint,
    }


class VisualTimelineTests(unittest.TestCase):
    def test_accurate_detects_every_sample_and_preserves_each_geometry(self):
        calls = []

        def detect(path):
            calls.append(path)
            index = int(Path(path).stem[1:])
            return [(
                [(10 + index, 10), (30 + index, 10), (30 + index, 20), (10 + index, 20)],
                "hello",
                0.9,
            )]

        timeline = build_accurate_timeline(
            ["f000000.png", "f000001.png"],
            detect,
            metadata(width=100, height=60, duration_seconds=0.25, frame_count=2),
            {"x0": 0, "y0": 0, "x1": 100, "y1": 60},
        )
        self.assertEqual(calls, ["f000000.png", "f000001.png"])
        self.assertEqual(
            [(s["startFrame"], s["endFrameExclusive"], s["boxes"][0]["x0"])
             for s in timeline["segments"]],
            [(0, 1, 10), (1, 2, 11)],
        )
        self.assertEqual(timeline["protocol"], "ocr-visual-cues/1")
        self.assertEqual(timeline["schemaVersion"], 1)
        self.assertEqual(timeline["profile"], "accurate")
        self.assertEqual(timeline["segments"][0]["id"], "accurate-0")
        self.assertEqual(timeline["segments"][1]["id"], "accurate-1")

    def test_fast_profile_matrix(self):
        self.assertEqual(NG_DOI, 0.45)

        # Mock frame masks with controlled Jaccard distances:
        # 6 frames:
        # Frame 0, 1, 2 have mask A
        # Frame 3, 4, 5 have mask B (Jaccard > 0.45 from A)
        import numpy as np

        mask_a = np.zeros((20, 20), dtype=np.uint8)
        mask_a[5:15, 5:15] = 255

        mask_b = np.zeros((20, 20), dtype=np.uint8)
        mask_b[0:5, 0:5] = 255  # Disjoint from mask_a -> Jaccard = 1.0 > 0.45

        masks = [mask_a, mask_a, mask_a, mask_b, mask_b, mask_b]

        def mock_mask_getter(idx):
            return masks[idx]

        intervals, rung = phan_doan(len(masks), mock_mask_getter)
        # Intervals must be half-open [0, 3) and [3, 6)
        self.assertEqual(intervals, [(0, 3), (3, 6)])

        # Stable frame selection: least motion
        stable_0 = khung_on_dinh(rung, 0, 3)
        stable_1 = khung_on_dinh(rung, 3, 6)
        self.assertTrue(0 <= stable_0 < 3)
        self.assertTrue(3 <= stable_1 < 6)

        calls = []

        def detect(path):
            calls.append(path)
            idx = int(Path(path).stem[1:])
            return [(
                [(10, 10), (30, 10), (30, 20), (10, 20)],
                f"text-{idx}",
                0.85,
            )]

        timeline = build_fast_timeline(
            [f"f00000{i}.png" for i in range(6)],
            detect,
            metadata(width=100, height=60, duration_seconds=0.75, frame_count=6),
            {"x0": 0, "y0": 0, "x1": 100, "y1": 60},
            mask_getter=mock_mask_getter,
        )

        # RapidOCR is called exactly once per preliminary interval (2 calls total)
        self.assertEqual(len(calls), 2)
        self.assertEqual(len(timeline["segments"]), 2)
        s0, s1 = timeline["segments"]
        self.assertEqual(s0["id"], "fast-0-3")
        self.assertEqual(s0["startFrame"], 0)
        self.assertEqual(s0["endFrameExclusive"], 3)
        self.assertEqual(s0["start"], 0.0)
        self.assertEqual(s0["end"], 3 / 8.0)

        self.assertEqual(s1["id"], "fast-3-6")
        self.assertEqual(s1["startFrame"], 3)
        self.assertEqual(s1["endFrameExclusive"], 6)
        self.assertEqual(s1["start"], 3 / 8.0)
        self.assertEqual(s1["end"], 6 / 8.0)

    def test_below_threshold_change_missed_by_fast_retained_by_accurate(self):
        import numpy as np

        # Base mask with 100 pixels
        mask_base = np.zeros((50, 50), dtype=np.uint8)
        mask_base[10:20, 10:20] = 255  # 100 pixels

        # Slightly modified mask (add 10 pixels -> Jaccard diff ~ 10/110 = 0.09 < 0.45)
        mask_slight = mask_base.copy()
        mask_slight[20:21, 10:20] = 255

        masks = [mask_base, mask_slight]

        def mock_mask_getter(idx):
            return masks[idx]

        intervals, _ = phan_doan(2, mock_mask_getter)
        # In fast mode, below threshold change is grouped into a SINGLE interval [0, 2)
        self.assertEqual(intervals, [(0, 2)])

        # In accurate mode, each frame is evaluated independently
        calls = []

        def detect(path):
            calls.append(path)
            idx = int(Path(path).stem[1:])
            return [(
                [(10 + idx * 5, 10), (30 + idx * 5, 10), (30 + idx * 5, 20), (10 + idx * 5, 20)],
                f"word{idx}",
                0.9,
            )]

        timeline_acc = build_accurate_timeline(
            ["f000000.png", "f000001.png"],
            detect,
            metadata(width=100, height=60, duration_seconds=0.25, frame_count=2),
            {"x0": 0, "y0": 0, "x1": 100, "y1": 60},
        )
        self.assertEqual(len(timeline_acc["segments"]), 2)
        self.assertEqual(timeline_acc["segments"][0]["boxes"][0]["x0"], 10)
        self.assertEqual(timeline_acc["segments"][1]["boxes"][0]["x0"], 15)

    def test_sutherland_hodgman_polygon_clipping(self):
        scan = {"x0": 10, "y0": 10, "x1": 90, "y1": 50}

        # Polygon crossing left edge (x goes from 0 to 30)
        poly_left = [(0, 20), (30, 20), (30, 40), (0, 40)]
        clipped_left = clip_polygon_to_rect(poly_left, scan["x0"], scan["y0"], scan["x1"], scan["y1"])
        self.assertTrue(len(clipped_left) >= 3)
        self.assertAlmostEqual(min(p[0] for p in clipped_left), 10.0)

        # Polygon crossing right edge (x goes from 70 to 110)
        poly_right = [(70, 20), (110, 20), (110, 40), (70, 40)]
        clipped_right = clip_polygon_to_rect(poly_right, scan["x0"], scan["y0"], scan["x1"], scan["y1"])
        self.assertTrue(len(clipped_right) >= 3)
        self.assertAlmostEqual(max(p[0] for p in clipped_right), 90.0)

        # Rotated quadrilateral (diamond)
        poly_diamond = [(50, 5), (95, 30), (50, 55), (5, 30)]
        clipped_diamond = clip_polygon_to_rect(poly_diamond, scan["x0"], scan["y0"], scan["x1"], scan["y1"])
        self.assertTrue(len(clipped_diamond) >= 4)
        for x, y in clipped_diamond:
            self.assertTrue(scan["x0"] - 1e-6 <= x <= scan["x1"] + 1e-6)
            self.assertTrue(scan["y0"] - 1e-6 <= y <= scan["y1"] + 1e-6)

        # Zero-area polygon entirely outside
        poly_outside = [(100, 100), (120, 100), (120, 120), (100, 120)]
        clipped_outside = clip_polygon_to_rect(poly_outside, scan["x0"], scan["y0"], scan["x1"], scan["y1"])
        area_outside = polygon_shoelace_area(clipped_outside)
        self.assertEqual(area_outside, 0.0)

    def test_aabb_derivation_and_confidence_threshold(self):
        scan = {"x0": 0, "y0": 0, "x1": 100, "y1": 100}

        # Confidence exactly 0.5 must be rejected (> 0.5 required)
        res_05 = normalize_rapidocr_item(
            ([(10.2, 10.2), (30.8, 10.2), (30.8, 20.8), (10.2, 20.8)], "text", 0.5),
            scan,
        )
        self.assertIsNone(res_05)

        # Confidence 0.500001 must be accepted
        res_pass = normalize_rapidocr_item(
            ([(10.2, 10.2), (30.8, 10.2), (30.8, 20.8), (10.2, 20.8)], "text", 0.500001),
            scan,
        )
        self.assertIsNotNone(res_pass)
        # AABB: floor minima, ceil maxima
        # min_x=10.2 -> 10, min_y=10.2 -> 10, max_x=30.8 -> 31, max_y=20.8 -> 21
        self.assertEqual(res_pass["x0"], 10)
        self.assertEqual(res_pass["y0"], 10)
        self.assertEqual(res_pass["x1"], 31)
        self.assertEqual(res_pass["y1"], 21)
        self.assertAlmostEqual(res_pass["confidence"], 0.500001)

        # Whitespace-only text must be rejected
        res_ws = normalize_rapidocr_item(
            ([(10, 10), (30, 10), (30, 20), (10, 20)], "   \n\t  ", 0.9),
            scan,
        )
        self.assertIsNone(res_ws)

    def test_reading_order_two_lines_and_left_to_right(self):
        # Line 2 (lower Y ~ 40): "World" (x: 50-80), "Hello" (x: 10-40) -> in wrong order
        # Line 1 (upper Y ~ 15): "Top" (x: 10-30)
        items = [
            ([(50, 35), (80, 35), (80, 45), (50, 45)], "World", 0.8),
            ([(10, 10), (30, 10), (30, 20), (10, 20)], "Top", 0.9),
            ([(10, 35), (40, 35), (40, 45), (10, 45)], "Hello", 0.85),
        ]

        def detect(_path):
            return items

        timeline = build_accurate_timeline(
            ["f000000.png"],
            detect,
            metadata(width=100, height=60, duration_seconds=0.125, frame_count=1),
            {"x0": 0, "y0": 0, "x1": 100, "y1": 60},
        )
        self.assertEqual(len(timeline["segments"]), 1)
        seg = timeline["segments"][0]
        # Line 1 ("Top") then Line 2 ("Hello World")
        self.assertEqual(seg["text"], "Top Hello World")
        # Confidence must be min of boxes (min(0.8, 0.9, 0.85) = 0.8)
        self.assertAlmostEqual(seg["confidence"], 0.8)

    def test_timeline_to_srt(self):
        timeline = {
            "segments": [
                {
                    "id": "fast-0-2",
                    "startFrame": 0,
                    "endFrameExclusive": 2,
                    "start": 0.0,
                    "end": 0.25,
                    "text": "Hello World",
                    "confidence": 0.9,
                    "boxes": [],
                },
                {
                    "id": "fast-2-4",
                    "startFrame": 2,
                    "endFrameExclusive": 4,
                    "start": 0.25,
                    "end": 0.5,
                    "text": "Second line",
                    "confidence": 0.85,
                    "boxes": [],
                },
            ]
        }
        srt = timeline_to_srt(timeline)
        self.assertIn("1\n00:00:00,000 --> 00:00:00,250\nHello World\n", srt)
        self.assertIn("2\n00:00:00,250 --> 00:00:00,500\nSecond line\n", srt)

    def test_write_visual_timeline_atomic_and_bounded(self):
        with tempfile.TemporaryDirectory() as td:
            out_file = os.path.join(td, "visual-cues.json")
            timeline = {
                "schemaVersion": 1,
                "protocol": "ocr-visual-cues/1",
                "video": {
                    "width": 100,
                    "height": 60,
                    "durationSeconds": 1.0,
                    "sampleFps": 8,
                    "frameCount": 8,
                    "geometryFingerprint": "f" * 64,
                },
                "profile": "fast",
                "scanRegion": {"x0": 0, "y0": 0, "x1": 100, "y1": 60},
                "segments": [
                    {
                        "id": "fast-0-4",
                        "startFrame": 0,
                        "endFrameExclusive": 4,
                        "start": 0.0,
                        "end": 0.5,
                        "text": "Test segment",
                        "confidence": 0.95,
                        "boxes": [
                            {"x0": 10, "y0": 10, "x1": 50, "y1": 30, "text": "Test", "confidence": 0.95}
                        ],
                    }
                ],
            }
            write_visual_timeline(out_file, timeline)
            self.assertTrue(os.path.exists(out_file))
            with open(out_file, "r", encoding="utf-8") as f:
                data = json.load(f)
            self.assertEqual(data["protocol"], "ocr-visual-cues/1")


if __name__ == "__main__":
    unittest.main()
