"""
Canonical serialization + hashing of risk-analysis inputs — Python side.

MUST produce byte-identical output to the TypeScript implementation in
`zk/prover/riskCanonical.ts`. Together they let the STARK prover
cryptographically bind a claimed `totalRisk` to the exact inputs that
produced it: before generating a proof, the Python server asserts that

    sha256(canonical_json(witness_inputs)) == statement.public_inputs[0]

and that the base + fused risk formulas reproduce the claimed
`totalRisk`. If any check fails, the prover refuses to generate a proof.

Precision conventions (must match TS):
  - USDC-denominated values → integer cents ($1 = 100)
  - Ratios / percentages    → basis points (100% = 10000)
  - Scores                  → integers 0..100
  - Asset symbols           → uppercase ASCII
  - Sentiment               → integer code from SENTIMENT_CODE
  - Timestamps              → ms epoch, floored to nearest 1000 ms
"""

import hashlib
import json
import math
import struct
from typing import Any, Dict, List, Optional


RISK_CANONICAL_VERSION = 1


def _js_round(x: float) -> int:
    """
    Match JavaScript's Math.round (round half toward +∞) so byte-identical
    hashes come out on both sides. Python's built-in round() uses banker's
    rounding (round half to even), so `round(62.5)` = 62 ≠ 62.5→63 in JS.
    Every rounding step in this module MUST use this helper.
    """
    return math.floor(x + 0.5)

SENTIMENT_CODE = {
    "bearish": 0,
    "neutral": 1,
    "bullish": 2,
}


class RiskBindingError(ValueError):
    """
    Raised when a risk proof request fails a binding check — either the
    canonical hash of the witness doesn't match the statement's declared
    input hash, the base-risk formula doesn't reproduce the claimed
    base score, or the fusion formula doesn't reproduce the total score.
    A honest prover cannot proceed past these checks.
    """


def _normalize(inputs: Dict[str, Any]) -> Dict[str, Any]:
    """Apply the same normalization TS does: uppercase assets, lower chain, round bps/cents,
    floor timestamp to seconds, sort exposures by asset symbol."""
    exposures = list(inputs.get("exposures") or [])
    norm_exposures: List[Dict[str, Any]] = []
    for e in exposures:
        norm_exposures.append(
            {
                "asset": str(e["asset"]).upper(),
                "exposureBps": _js_round(float(e["exposureBps"])),
                "contributionBps": _js_round(float(e["contributionBps"])),
            }
        )
    norm_exposures.sort(key=lambda x: x["asset"])

    ai_raw = inputs.get("aiRiskScore", None)
    ai_val: Optional[int] = None if ai_raw is None else _js_round(float(ai_raw))

    return {
        "version": RISK_CANONICAL_VERSION,
        "portfolioId": int(inputs["portfolioId"]),
        "chain": str(inputs["chain"]).lower(),
        "timestampMs": int(inputs["timestampMs"]) // 1000 * 1000,
        "portfolioValueUsdc": _js_round(float(inputs["portfolioValueUsdc"])),
        "volatilityBps": _js_round(float(inputs["volatilityBps"])),
        "exposures": norm_exposures,
        "sentimentCode": int(inputs["sentimentCode"]),
        "baseRiskScore": _js_round(float(inputs["baseRiskScore"])),
        "aiRiskScore": ai_val,
        "totalRisk": _js_round(float(inputs["totalRisk"])),
        "threshold": _js_round(float(inputs["threshold"])),
    }


def serialize_canonical(inputs: Dict[str, Any]) -> str:
    """
    JSON encode with sorted keys and compact separators — byte-identical
    to the TS `serializeCanonical`. This is the string SHA256 hashes.
    """
    normalized = _normalize(inputs)
    return json.dumps(normalized, sort_keys=True, separators=(",", ":"))


def compute_inputs_hash(inputs: Dict[str, Any]) -> str:
    """SHA256 hex of the canonical serialization. Matches TS `computeInputsHash`."""
    return hashlib.sha256(serialize_canonical(inputs).encode("utf-8")).hexdigest()


def compute_output_hash(total_risk: int) -> str:
    """SHA256 hex of the u32-BE totalRisk. Matches TS `computeOutputHash`."""
    tr = _js_round(float(total_risk)) & 0xFFFFFFFF
    return hashlib.sha256(struct.pack(">I", tr)).hexdigest()


def compute_commitment_hash(
    inputs: Dict[str, Any], inputs_hash_hex: str, output_hash_hex: str
) -> str:
    """
    32-byte SHA256 the prover ed25519-signs. Field order MUST match TS:

      SHA256(
        version_u32BE     ||
        portfolioId_u32BE ||
        timestampMs_u64BE ||
        totalRisk_u32BE   ||
        threshold_u32BE   ||
        inputsHash_32B    ||
        outputHash_32B
      )
    """
    normalized = _normalize(inputs)
    parts = b"".join(
        [
            struct.pack(">I", RISK_CANONICAL_VERSION),
            struct.pack(">I", normalized["portfolioId"] & 0xFFFFFFFF),
            struct.pack(">Q", normalized["timestampMs"] & 0xFFFFFFFFFFFFFFFF),
            struct.pack(">I", normalized["totalRisk"] & 0xFFFFFFFF),
            struct.pack(">I", normalized["threshold"] & 0xFFFFFFFF),
            bytes.fromhex(inputs_hash_hex),
            bytes.fromhex(output_hash_hex),
        ]
    )
    return hashlib.sha256(parts).hexdigest()


def compute_base_risk_score(
    volatility_bps: float, exposures: List[Dict[str, Any]]
) -> int:
    """
    Byte-match TS `computeBaseRiskScore`:
      volFrac    = volatilityBps / 10000        # 0.25
      contribSum = Σ contributionBps / 100       # percentage points
      raw        = volFrac * 50 + contribSum
      baseRisk   = clamp(round(raw), 0, 100)
    """
    vol_frac = float(volatility_bps) / 10_000.0
    contrib_sum = sum(float(e["contributionBps"]) / 100.0 for e in exposures)
    raw = vol_frac * 50.0 + contrib_sum
    return max(0, min(100, _js_round(raw)))


def fuse_risk_scores(base_risk_score: int, ai_risk_score: Optional[int]) -> int:
    """Byte-match TS `fuseRiskScores`."""
    if ai_risk_score is None:
        return _js_round(float(base_risk_score))
    return max(
        0,
        min(
            100,
            _js_round((float(base_risk_score) + float(ai_risk_score)) / 2.0),
        ),
    )


def assert_risk_binding(
    statement: Dict[str, Any], witness: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Full binding check for a risk proof. Called by the FastAPI server
    before invoking the STARK prover.

    Requires that the statement is a v1 zkv-risk statement:
      statement.claim         == "zkv-risk-v1"
      statement.public_inputs == [inputs_hash, output_hash, total_risk, threshold]

    And that the witness contains a `canonical` dict with the full
    CanonicalRiskInputs shape.

    Raises RiskBindingError on any mismatch. Returns the normalized
    canonical dict for downstream logging / attestation.
    """
    claim = str(statement.get("claim") or "")
    expected_claim = f"zkv-risk-v{RISK_CANONICAL_VERSION}"
    if claim != expected_claim:
        raise RiskBindingError(
            f"risk-binding: claim mismatch — expected '{expected_claim}', got '{claim}'"
        )

    public_inputs = statement.get("public_inputs") or []
    if not isinstance(public_inputs, list) or len(public_inputs) < 4:
        raise RiskBindingError(
            "risk-binding: public_inputs must be [inputs_hash, output_hash, total_risk, threshold]"
        )

    stmt_inputs_hash = str(public_inputs[0]).lower()
    stmt_output_hash = str(public_inputs[1]).lower()
    try:
        stmt_total_risk = int(public_inputs[2])
        stmt_threshold = int(public_inputs[3])
    except (TypeError, ValueError) as e:
        raise RiskBindingError(
            f"risk-binding: totalRisk / threshold must be integer-castable — {e}"
        )

    canonical = witness.get("canonical")
    if not isinstance(canonical, dict):
        raise RiskBindingError(
            "risk-binding: witness.canonical is required and must be a dict"
        )

    # 1) input-hash binding
    recomputed_inputs_hash = compute_inputs_hash(canonical)
    if recomputed_inputs_hash != stmt_inputs_hash:
        raise RiskBindingError(
            "risk-binding: inputs_hash mismatch — the witness does NOT hash to the claimed inputsHash."
            f" recomputed={recomputed_inputs_hash} claimed={stmt_inputs_hash}"
        )

    normalized = _normalize(canonical)

    # 2) output-hash binding (must match claimed totalRisk)
    recomputed_output_hash = compute_output_hash(normalized["totalRisk"])
    if recomputed_output_hash != stmt_output_hash:
        raise RiskBindingError(
            "risk-binding: output_hash mismatch — witness.totalRisk doesn't match the claimed outputHash."
            f" recomputed={recomputed_output_hash} claimed={stmt_output_hash}"
        )

    # 3) statement vs witness totalRisk
    if stmt_total_risk != normalized["totalRisk"]:
        raise RiskBindingError(
            f"risk-binding: statement.totalRisk ({stmt_total_risk}) != witness.totalRisk ({normalized['totalRisk']})"
        )

    # 4) base-risk formula reproducibility
    recomputed_base = compute_base_risk_score(
        normalized["volatilityBps"], normalized["exposures"]
    )
    if recomputed_base != normalized["baseRiskScore"]:
        raise RiskBindingError(
            f"risk-binding: baseRiskScore mismatch — formula yields {recomputed_base}, witness claims {normalized['baseRiskScore']}"
        )

    # 5) fusion formula reproducibility
    expected_total = fuse_risk_scores(
        normalized["baseRiskScore"], normalized["aiRiskScore"]
    )
    if expected_total != normalized["totalRisk"]:
        raise RiskBindingError(
            f"risk-binding: totalRisk mismatch — fuse(base={normalized['baseRiskScore']}, ai={normalized['aiRiskScore']})={expected_total},"
            f" witness claims {normalized['totalRisk']}"
        )

    # 6) threshold satisfied
    if stmt_threshold < 0 or stmt_threshold > 100:
        raise RiskBindingError(
            f"risk-binding: threshold must be 0..100, got {stmt_threshold}"
        )
    if normalized["totalRisk"] > stmt_threshold:
        raise RiskBindingError(
            f"risk-binding: totalRisk ({normalized['totalRisk']}) exceeds threshold ({stmt_threshold})"
        )

    return normalized
