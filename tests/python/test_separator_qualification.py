import unittest
from scripts.separator_qualification import CandidateSummary, LicenseReview, evaluate_release_pair

APPROVED = LicenseReview(
    code_spdx="MIT",
    weight_license_name="Reviewed redistribution grant",
    weight_license_url="https://example.invalid/license-evidence-used-only-in-unit-test",
    weight_redistribution_approved=True,
)

class QualificationGateTests(unittest.TestCase):
    def test_accepts_pair_when_speed_quality_and_licenses_pass(self):
        compact = CandidateSummary(
            candidate_id="compact",
            license_review=APPROVED,
            fast_median_seconds=7.0,
            balanced_median_seconds=10.0,
            balanced_no_intelligible_dialogue_ratio=0.80,
            balanced_severe_damage_ratio=0.10,
            quality_leakage_improvement_db=0.0,
            quality_blind_win_ratio=0.0,
        )
        quality = CandidateSummary(
            candidate_id="hq",
            license_review=APPROVED,
            fast_median_seconds=0.0,
            balanced_median_seconds=0.0,
            balanced_no_intelligible_dialogue_ratio=0.0,
            balanced_severe_damage_ratio=0.08,
            quality_leakage_improvement_db=2.2,
            quality_blind_win_ratio=0.68,
        )
        decision = evaluate_release_pair(compact, quality)
        self.assertTrue(decision.accepted)
        self.assertEqual(decision.fast_balanced_candidate_id, "compact")
        self.assertEqual(decision.quality_candidate_id, "hq")

    def test_rejects_ambiguous_weight_rights_even_when_metrics_pass(self):
        unapproved = LicenseReview("MIT", "Unknown", "", False)
        compact = CandidateSummary("compact", unapproved, 7.0, 10.0, 0.9, 0.02, 0.0, 0.0)
        quality = CandidateSummary("hq", APPROVED, 0.0, 0.0, 0.0, 0.02, 3.0, 0.8)
        self.assertFalse(evaluate_release_pair(compact, quality).accepted)

    def test_rejects_fast_when_it_is_not_twenty_five_percent_faster(self):
        compact = CandidateSummary("compact", APPROVED, 7.6, 10.0, 0.9, 0.02, 0.0, 0.0)
        quality = CandidateSummary("hq", APPROVED, 0.0, 0.0, 0.0, 0.02, 3.0, 0.8)
        self.assertFalse(evaluate_release_pair(compact, quality).accepted)

if __name__ == "__main__":
    unittest.main()
