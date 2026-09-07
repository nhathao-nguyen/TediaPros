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
    build_fast_timeline_stream,
    clip_polygon_to_rect,
    jaccard,
    khung_on_dinh,
    mask_chu,
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
    def test_mask_chu_suppresses_dense_static_edge_noise(self):
        """A dense static dotted background must not hide a text change."""
        import cv2
        import numpy as np

        frames = []
        for with_text in (False, True):
            image = np.full((120, 160, 3), 128, dtype=np.uint8)
            for y in range(2, 120, 8):
                for x in range(2, 160, 8):
                    image[y:y + 3, x:x + 3] = 64
            if with_text:
                image[72:84, 28:92] = 235
            frames.append(image)

        masks = [mask_chu(frame, cv2, np) for frame in frames]
        intervals, _ = phan_doan(2, lambda index: masks[index])
        self.assertEqual(intervals, [(0, 1), (1, 2)])

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

    def test_accurate_timeline_supports_generator_without_full_materialization(self):
        yielded = []

        def sample_gen():
            for i in range(4):
                yielded.append(i)
                yield f"frame-{i}"

        calls = []

        def detect(sample):
            calls.append(sample)
            return [([(10, 10), (50, 10), (50, 30), (10, 30)], "StreamSample", 0.9)]

        timeline = build_accurate_timeline(
            sample_gen(),
            detect,
            metadata(width=100, height=60, duration_seconds=0.5, frame_count=4),
            {"x0": 0, "y0": 0, "x1": 100, "y1": 60},
        )
        self.assertEqual(calls, ["frame-0", "frame-1", "frame-2", "frame-3"])
        self.assertEqual(len(timeline["segments"]), 4)
        self.assertEqual(timeline["segments"][0]["id"], "accurate-0")
        self.assertEqual(timeline["segments"][3]["id"], "accurate-3")
        self.assertEqual(timeline["video"]["frameCount"], 4)

    def test_roi_halo_crop_coordinate_offset_and_clipping(self):
        # User scan region: x: 100..300, y: 400..600 (width 1000, height 800)
        scan_region = {"x0": 100, "y0": 400, "x1": 300, "y1": 600}
        halo = 32
        crop_x0 = max(0, scan_region["x0"] - halo)  # 68
        crop_y0 = max(0, scan_region["y0"] - halo)  # 368

        # Case 1: Box inside user scan region
        # Coordinates relative to crop:
        # User x=150 -> relative x = 150 - 68 = 82
        # User y=450 -> relative y = 450 - 368 = 82
        rel_poly_inside = [(82, 82), (182, 82), (182, 112), (82, 112)]
        display_poly_inside = [[p[0] + crop_x0, p[1] + crop_y0] for p in rel_poly_inside]
        item_inside = [display_poly_inside, "SubInside", 0.95]
        res_inside = normalize_rapidocr_item(item_inside, scan_region)
        self.assertIsNotNone(res_inside)
        self.assertEqual(res_inside["x0"], 150)
        self.assertEqual(res_inside["y0"], 450)
        self.assertEqual(res_inside["x1"], 250)
        self.assertEqual(res_inside["y1"], 480)

        # Case 2: Box strictly in halo zone (outside user scan region)
        # x is between 70 and 90, which is in halo (68..100) but outside user scan region [100..300]
        rel_poly_halo = [(5, 82), (25, 82), (25, 112), (5, 112)]
        display_poly_halo = [[p[0] + crop_x0, p[1] + crop_y0] for p in rel_poly_halo]
        item_halo = [display_poly_halo, "HaloNoise", 0.95]
        # Should be completely filtered out by Sutherland-Hodgman clipping against scan_region
        res_halo = normalize_rapidocr_item(item_halo, scan_region)
        self.assertIsNone(res_halo)

        # Case 3: Box straddling the border (e.g. x goes from 80 to 150)
        # Display x goes from 80+68=148 to 150+68=218 (which is inside),
        # but let's test straddling left border: rel x goes from 20 (display x = 88) to 60 (display x = 128)
        rel_poly_straddle = [(20, 82), (60, 82), (60, 112), (20, 112)]
        display_poly_straddle = [[p[0] + crop_x0, p[1] + crop_y0] for p in rel_poly_straddle]
        item_straddle = [display_poly_straddle, "Straddle", 0.95]
        res_straddle = normalize_rapidocr_item(item_straddle, scan_region)
        self.assertIsNotNone(res_straddle)
        # Clipped to scan_region.x0 = 100
        self.assertEqual(res_straddle["x0"], 100)
        self.assertEqual(res_straddle["x1"], 128)

    def test_fast_timeline_stream_segments_and_selects_stable_frame(self):
        import numpy as np

        # Create 6 synthetic frames
        # Frame 0, 1, 2 have one mask (all black in scan_region)
        # Frame 3, 4, 5 have another mask (white text in scan_region)
        frames = []
        for i in range(6):
            f = np.zeros((100, 200, 3), dtype=np.uint8)
            if i >= 3:
                # White bar simulating text
                f[30:50, 40:160] = 255
            frames.append(f)

        def frame_stream():
            for idx, f in enumerate(frames):
                yield idx, f

        detected_crops = []

        def detect(crop_img):
            detected_crops.append(crop_img)
            return [([(40, 30), (160, 30), (160, 50), (40, 50)], "FastStreamText", 0.9)]

        scan_region = {"x0": 20, "y0": 20, "x1": 180, "y1": 80}
        meta = metadata(width=200, height=100, duration_seconds=0.75, frame_count=6)

        timeline = build_fast_timeline_stream(frame_stream(), detect, meta, scan_region)
        self.assertEqual(timeline["profile"], "fast")
        self.assertTrue(len(timeline["segments"]) >= 1)
        self.assertTrue(len(detected_crops) >= 1)

    def test_fast_timeline_stream_exact_equivalence_to_khung_on_dinh(self):
        """Test exact representative index equivalence between online scorer and legacy khung_on_dinh."""
        import numpy as np

        test_cases = [
            ("all-zeros", [0.0] * 6),
            ("ties", [0.0, 0.2, 0.2, 0.2, 0.2]),
            ("single-frame", [0.0]),
            ("two-frames", [0.0, 0.3]),
            ("alternating", [0.0, 0.8, 0.1, 0.7, 0.05, 0.9]),
            ("cut-at-first-transition", [0.0, 0.9, 0.1, 0.1]),
            ("cut-at-last-transition", [0.0, 0.1, 0.1, 0.9]),
            ("multiple-cuts", [0.0, 0.2, 0.8, 0.1, 0.1, 0.9, 0.05, 0.05]),
        ]

        for name, deltas in test_cases:
            with self.subTest(case=name):
                n = len(deltas)
                # Compute legacy intervals and representative frames using khung_on_dinh:
                legacy_intervals = []
                start = 0
                for i in range(1, n):
                    if deltas[i] > NG_DOI and i > start:
                        legacy_intervals.append((start, i))
                        start = i
                if n > 0:
                    legacy_intervals.append((start, n))

                expected_indices = [
                    khung_on_dinh(deltas, a, b) for a, b in legacy_intervals
                ]

                # Run streaming fast timeline with mock frames and detect callback recording frame index:
                chosen_indices = []

                def detect_fn(crop_img):
                    # We stamp index into pixel value:
                    idx = int(crop_img[0, 0, 0])
                    chosen_indices.append(idx)
                    return [([(10, 10), (30, 10), (30, 20), (10, 20)], f"text-{idx}", 0.9)]

                def mock_stream():
                    for i in range(n):
                        f = np.zeros((40, 40, 3), dtype=np.uint8)
                        f[0, 0, 0] = i  # stamp index
                        yield i, f

                # We monkey-patch jaccard during this run to return deltas[i]:
                orig_jaccard = sys.modules["visual_timeline"].jaccard
                try:
                    sys.modules["visual_timeline"].jaccard = lambda m, prev, np_mod: deltas[idx_counter[0]]
                    idx_counter = [0]

                    def tracking_stream():
                        for idx, frame in mock_stream():
                            idx_counter[0] = idx
                            yield idx, frame

                    meta = metadata(width=40, height=40, duration_seconds=n / 8.0, frame_count=n)
                    scan = {"x0": 0, "y0": 0, "x1": 40, "y1": 40}
                    timeline = build_fast_timeline_stream(tracking_stream(), detect_fn, meta, scan)
                finally:
                    sys.modules["visual_timeline"].jaccard = orig_jaccard

                self.assertEqual(
                    chosen_indices,
                    expected_indices,
                    f"Mismatch in case '{name}': online got {chosen_indices}, expected {expected_indices}",
                )
                self.assertEqual(
                    [(s["startFrame"], s["endFrameExclusive"]) for s in timeline["segments"]],
                    legacy_intervals,
                )

    def test_fast_timeline_stream_bounded_memory_retention(self):
        """Weakref test ensuring peak retained frame buffers <= 4 across sequences."""
        import gc
        import weakref
        import numpy as np

        for count in (80, 800):
            with self.subTest(count=count):
                refs = []
                peak = 0

                def mock_stream():
                    nonlocal peak
                    for i in range(count):
                        f = np.zeros((100, 100, 3), dtype=np.uint8)
                        refs.append(weakref.ref(f))
                        yield i, f
                        alive = sum(r() is not None for r in refs)
                        if alive > peak:
                            peak = alive

                meta = metadata(width=100, height=100, duration_seconds=count / 8.0, frame_count=count)
                scan = {"x0": 10, "y0": 10, "x1": 90, "y1": 90}
                timeline = build_fast_timeline_stream(
                    mock_stream(),
                    lambda crop: [],
                    meta,
                    scan,
                )
                gc.collect()
                self.assertLessEqual(
                    peak,
                    4,
                    f"Peak retained full frames {peak} exceeded maximum budget of 4 for count={count}",
                )
                retained_after = sum(r() is not None for r in refs)
                self.assertEqual(retained_after, 0, "Frames must be released after stream completion")


if __name__ == "__main__":
    unittest.main()
