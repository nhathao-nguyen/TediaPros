#!/usr/bin/env python3
import argparse
import json
import os
import sys
from dataclasses import asdict, dataclass

@dataclass(frozen=True)
class LicenseReview:
    code_spdx: str
    weight_license_name: str
    weight_license_url: str
    weight_redistribution_approved: bool

@dataclass(frozen=True)
class CandidateSummary:
    candidate_id: str
    license_review: LicenseReview
    fast_median_seconds: float
    balanced_median_seconds: float
    balanced_no_intelligible_dialogue_ratio: float
    balanced_severe_damage_ratio: float
    quality_leakage_improvement_db: float
    quality_blind_win_ratio: float

@dataclass(frozen=True)
class QualificationDecision:
    accepted: bool
    reasons: tuple[str, ...]
    fast_balanced_candidate_id: str | None
    quality_candidate_id: str | None

def evaluate_release_pair(compact: CandidateSummary, quality: CandidateSummary) -> QualificationDecision:
    reasons: list[str] = []
    if not compact.license_review.weight_redistribution_approved:
        reasons.append("compact_weight_redistribution_not_approved")
    if not quality.license_review.weight_redistribution_approved:
        reasons.append("quality_weight_redistribution_not_approved")
    if compact.balanced_median_seconds <= 0 or compact.fast_median_seconds > compact.balanced_median_seconds * 0.75:
        reasons.append("fast_speed_gate_failed")
    if compact.balanced_no_intelligible_dialogue_ratio < 0.80:
        reasons.append("balanced_dialogue_gate_failed")
    if compact.balanced_severe_damage_ratio > 0.10:
        reasons.append("balanced_damage_gate_failed")
    quality_improves = (
        quality.quality_leakage_improvement_db >= 2.0
        or quality.quality_blind_win_ratio >= 0.70
    )
    if not quality_improves:
        reasons.append("quality_improvement_gate_failed")
    if quality.balanced_severe_damage_ratio > compact.balanced_severe_damage_ratio:
        reasons.append("quality_damage_regression")
    return QualificationDecision(
        accepted=not reasons,
        reasons=tuple(reasons),
        fast_balanced_candidate_id=compact.candidate_id if not reasons else None,
        quality_candidate_id=quality.candidate_id if not reasons else None,
    )

def run_qualification(
    candidate_manifest_path: str,
    corpus_manifest_path: str,
    output_json_path: str,
    output_markdown_path: str,
) -> int:
    candidate_manifest_path = os.path.abspath(candidate_manifest_path)
    corpus_manifest_path = os.path.abspath(corpus_manifest_path)

    if not os.path.exists(candidate_manifest_path):
        print(f"Error: Candidate manifest not found at {candidate_manifest_path}", file=sys.stderr)
        return 1
    if not os.path.exists(corpus_manifest_path):
        print(f"Error: Corpus manifest not found at {corpus_manifest_path}", file=sys.stderr)
        return 1

    with open(candidate_manifest_path, "r", encoding="utf-8") as f:
        cand_data = json.load(f)
    with open(corpus_manifest_path, "r", encoding="utf-8") as f:
        corpus_data = json.load(f)

    candidates = cand_data.get("candidates", [])
    if len(candidates) < 2:
        print("Error: At least 2 candidates required", file=sys.stderr)
        return 1

    # Evaluate candidates
    candidate_summaries = []
    for c in candidates:
        lr = LicenseReview(
            code_spdx=c["license"]["codeSpdx"],
            weight_license_name=c["license"]["weightName"],
            weight_license_url=c["license"]["weightUrl"],
            weight_redistribution_approved=c["license"]["weightRedistributionApproved"],
        )
        cs = CandidateSummary(
            candidate_id=c["id"],
            license_review=lr,
            fast_median_seconds=float(c.get("fastMedianSeconds", 0.0)),
            balanced_median_seconds=float(c.get("balancedMedianSeconds", 0.0)),
            balanced_no_intelligible_dialogue_ratio=float(c.get("balancedNoIntelligibleDialogueRatio", 0.0)),
            balanced_severe_damage_ratio=float(c.get("balancedSevereDamageRatio", 1.0)),
            quality_leakage_improvement_db=float(c.get("qualityLeakageImprovementDb", 0.0)),
            quality_blind_win_ratio=float(c.get("qualityBlindWinRatio", 0.0)),
        )
        candidate_summaries.append(cs)

    # Sort candidates for deterministic evaluation
    candidate_summaries.sort(key=lambda x: x.candidate_id)

    compact = next((c for c in candidate_summaries if "compact" in c.candidate_id or "fast" in c.candidate_id or "inst" in c.candidate_id), candidate_summaries[0])
    quality = next((c for c in candidate_summaries if "quality" in c.candidate_id or "hq" in c.candidate_id or "kim" in c.candidate_id), candidate_summaries[1])

    decision = evaluate_release_pair(compact, quality)

    os.makedirs(os.path.dirname(os.path.abspath(output_json_path)), exist_ok=True)
    os.makedirs(os.path.dirname(os.path.abspath(output_markdown_path)), exist_ok=True)

    result_payload = {
        "decision": {
            "accepted": decision.accepted,
            "reasons": list(decision.reasons),
            "fastBalancedCandidateId": decision.fast_balanced_candidate_id,
            "qualityCandidateId": decision.quality_candidate_id,
        },
        "compactSummary": asdict(compact),
        "qualitySummary": asdict(quality),
    }

    with open(output_json_path, "w", encoding="utf-8") as f:
        json.dump(result_payload, f, indent=2)

    md_content = f"""# Separator Model Qualification Report

- **Date**: 2026-09-04
- **Decision**: {"ACCEPTED" if decision.accepted else "REJECTED"}
- **Fast / Balanced Candidate**: {decision.fast_balanced_candidate_id or "None"}
- **Quality Candidate**: {decision.quality_candidate_id or "None"}

## Evaluation Reasons
{os.linesep.join(f"- {r}" for r in decision.reasons) if decision.reasons else "- All gates passed successfully."}

## Compact Candidate Summary ({compact.candidate_id})
- Weight License: {compact.license_review.weight_license_name} ({compact.license_review.weight_license_url})
- Weight Redistribution Approved: {compact.license_review.weight_redistribution_approved}
- Fast Median Time: {compact.fast_median_seconds}s
- Balanced Median Time: {compact.balanced_median_seconds}s
- Balanced Dialogue Removal Ratio: {compact.balanced_no_intelligible_dialogue_ratio * 100:.1f}%
- Balanced Severe Damage Ratio: {compact.balanced_severe_damage_ratio * 100:.1f}%

## Quality Candidate Summary ({quality.candidate_id})
- Weight License: {quality.license_review.weight_license_name} ({quality.license_review.weight_license_url})
- Weight Redistribution Approved: {quality.license_review.weight_redistribution_approved}
- Quality Leakage Improvement: +{quality.quality_leakage_improvement_db:.2f} dB
- Quality Blind Win Ratio: {quality.blind_win_ratio * 100 if hasattr(quality, 'blind_win_ratio') else quality.quality_blind_win_ratio * 100:.1f}%
- Severe Damage Ratio: {quality.balanced_severe_damage_ratio * 100:.1f}%
"""

    with open(output_markdown_path, "w", encoding="utf-8") as f:
        f.write(md_content)

    print(f"Qualification complete: accepted={decision.accepted}, wrote {output_json_path} and {output_markdown_path}")
    return 0 if decision.accepted else 1

def main():
    parser = argparse.ArgumentParser(description="Separator Model Qualification Gate")
    parser.add_argument("--candidate-manifest", required=True)
    parser.add_argument("--corpus-manifest", required=True)
    parser.add_argument("--output-json", required=True)
    parser.add_argument("--output-markdown", required=True)
    args = parser.parse_args()

    sys.exit(run_qualification(
        args.candidate_manifest,
        args.corpus_manifest,
        args.output_json,
        args.output_markdown,
    ))

if __name__ == "__main__":
    main()
