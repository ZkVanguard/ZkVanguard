"""
Unit tests + cross-language golden-hash pin for hedge_canonical.

The golden hashes MUST match `test/unit/hedge-zk-binding.test.ts`
byte-for-byte. If either side changes, the depositor's on-chain
commitment stops being reproducible and every private hedge silently
breaks.
"""

import pytest

from zkp.core.hedge_canonical import (
    ALLOWED_ASSETS,
    ASSET_CODE,
    HEDGE_CANONICAL_VERSION,
    HedgeBindingError,
    SIDE_CODE,
    assert_hedge_binding,
    compute_commitment_hash,
    compute_inputs_hash,
    serialize_canonical,
)


def base_inputs(**overrides):
    """Deterministic hedge that MUST hash to the golden constants below."""
    d = {
        "chain": "sui",
        "portfolioId": 42,
        "timestampMs": 1_752_000_000_000,  # 2025-07-08T20:00:00Z (floored)
        "asset": "BTC",
        "side": "LONG",
        "sizeUnits": 1_000,                # 0.001 BTC in milli-units
        "leverageX": 3,
        "entryPriceUsdcCents": 7_300_000_00,   # $73,000.00
        "notionalValueUsdcCents": 21_900_00,   # $219.00 (0.001 BTC * $73k * 3x lev? no, notional = size*price at 1x)
        "leverageCap": 4,
        "notionalCapUsdcCents": 1_000_000_00,  # $1,000,000 cap
        "salt": "a" * 64,
    }
    d.update(overrides)
    return d


def _statement_for(inputs, leverage_cap=None, notional_cap=None):
    ih = compute_inputs_hash(inputs)
    ch = compute_commitment_hash(inputs, ih)
    return {
        "claim": f"zkv-hedge-v{HEDGE_CANONICAL_VERSION}",
        "public_inputs": [
            ch,
            ih,
            notional_cap if notional_cap is not None else inputs["notionalCapUsdcCents"],
            leverage_cap if leverage_cap is not None else inputs["leverageCap"],
        ],
    }


class TestCanonicalSerialization:
    def test_serialize_is_sorted_key_compact_json(self):
        s = serialize_canonical(base_inputs())
        assert s.startswith("{") and s.endswith("}")
        assert " " not in s  # compact — no whitespace
        # Sorted keys: 'asset' comes before 'chain' before 'entryPriceUsdcCents' etc.
        assert s.index('"asset"') < s.index('"chain"') < s.index('"entryPriceUsdcCents"')

    def test_normalize_uppercases_asset_and_side(self):
        s = serialize_canonical(base_inputs(asset="btc", side="long"))
        assert '"asset":"BTC"' in s
        assert '"side":"LONG"' in s

    def test_normalize_floors_timestamp_to_seconds(self):
        s = serialize_canonical(base_inputs(timestampMs=1_752_000_000_123))
        assert '"timestampMs":1752000000000' in s

    def test_inputs_hash_is_hex_64_chars(self):
        h = compute_inputs_hash(base_inputs())
        assert len(h) == 64
        assert all(c in "0123456789abcdef" for c in h)


class TestBindingAcceptsHealthy:
    def test_healthy_hedge_passes(self):
        i = base_inputs()
        stmt = _statement_for(i)
        wit = {"canonical": i}
        n = assert_hedge_binding(stmt, wit)
        assert n["asset"] == "BTC"
        assert n["side"] == "LONG"


class TestBindingRejectsInvariantViolations:
    def test_rejects_unsupported_asset(self):
        # Dummy hashes — enum check fires before hash comparison.
        i = base_inputs(asset="DOGE")
        stmt = {
            "claim": f"zkv-hedge-v{HEDGE_CANONICAL_VERSION}",
            "public_inputs": ["0" * 64, "0" * 64,
                              i["notionalCapUsdcCents"], i["leverageCap"]],
        }
        with pytest.raises(HedgeBindingError, match="asset .* not in allow-list"):
            assert_hedge_binding(stmt, {"canonical": i})

    def test_rejects_unsupported_side(self):
        i = base_inputs(side="MAYBE")
        stmt = {
            "claim": f"zkv-hedge-v{HEDGE_CANONICAL_VERSION}",
            "public_inputs": ["0" * 64, "0" * 64,
                              i["notionalCapUsdcCents"], i["leverageCap"]],
        }
        with pytest.raises(HedgeBindingError, match="side .* not in allow-list"):
            assert_hedge_binding(stmt, {"canonical": i})

    def test_rejects_leverage_above_cap(self):
        i = base_inputs(leverageX=5, leverageCap=4)
        with pytest.raises(HedgeBindingError, match=r"leverageX \(5\) outside \[1, 4\]"):
            assert_hedge_binding(_statement_for(i), {"canonical": i})

    def test_rejects_leverage_zero(self):
        i = base_inputs(leverageX=0)
        with pytest.raises(HedgeBindingError, match=r"leverageX \(0\) outside"):
            assert_hedge_binding(_statement_for(i), {"canonical": i})

    def test_rejects_notional_above_cap(self):
        i = base_inputs(notionalValueUsdcCents=2_000_000_00, notionalCapUsdcCents=1_000_000_00)
        with pytest.raises(HedgeBindingError, match="notional .* exceeds cap"):
            assert_hedge_binding(_statement_for(i), {"canonical": i})

    def test_rejects_zero_notional(self):
        i = base_inputs(notionalValueUsdcCents=0)
        with pytest.raises(HedgeBindingError, match="notionalValueUsdcCents must be positive"):
            assert_hedge_binding(_statement_for(i), {"canonical": i})

    def test_rejects_short_salt(self):
        i = base_inputs(salt="ab" * 8)  # only 16 bytes, need 32
        with pytest.raises(HedgeBindingError):
            assert_hedge_binding(_statement_for(i), {"canonical": i})


class TestBindingRejectsHashTamper:
    def test_rejects_wrong_inputs_hash(self):
        i = base_inputs()
        stmt = _statement_for(i)
        stmt["public_inputs"][1] = "0" * 64
        with pytest.raises(HedgeBindingError, match="inputs_hash mismatch"):
            assert_hedge_binding(stmt, {"canonical": i})

    def test_rejects_wrong_commitment_hash(self):
        i = base_inputs()
        stmt = _statement_for(i)
        stmt["public_inputs"][0] = "0" * 64
        with pytest.raises(HedgeBindingError, match="commitment_hash mismatch"):
            assert_hedge_binding(stmt, {"canonical": i})

    def test_rejects_leverage_cap_downgrade(self):
        # Attacker: witness had cap=4 but claims cap=2 in statement.
        i = base_inputs(leverageX=3, leverageCap=4)
        stmt = _statement_for(i, leverage_cap=2)
        with pytest.raises(HedgeBindingError, match="leverageCap .* != statement.leverage_cap"):
            assert_hedge_binding(stmt, {"canonical": i})

    def test_rejects_notional_cap_downgrade(self):
        i = base_inputs()
        stmt = _statement_for(i, notional_cap=1)
        with pytest.raises(HedgeBindingError, match="notionalCapUsdcCents .* != statement.notional_cap_cents"):
            assert_hedge_binding(stmt, {"canonical": i})


class TestBindingRejectsClaimAndShape:
    def test_rejects_wrong_claim_tag(self):
        i = base_inputs()
        stmt = _statement_for(i)
        stmt["claim"] = "zkv-risk-v1"
        with pytest.raises(HedgeBindingError, match="claim mismatch"):
            assert_hedge_binding(stmt, {"canonical": i})

    def test_rejects_short_public_inputs(self):
        i = base_inputs()
        stmt = _statement_for(i)
        stmt["public_inputs"] = stmt["public_inputs"][:2]
        with pytest.raises(HedgeBindingError, match="public_inputs must be"):
            assert_hedge_binding(stmt, {"canonical": i})

    def test_rejects_missing_canonical(self):
        i = base_inputs()
        stmt = _statement_for(i)
        with pytest.raises(HedgeBindingError, match="witness.canonical is required"):
            assert_hedge_binding(stmt, {})


class TestCrossLangGolden:
    """
    Pinned hex the TS side MUST reproduce byte-for-byte. If either
    number changes, the STARK binding is silently broken on-chain until
    re-signed. Same constants live in
    `test/unit/hedge-zk-binding.test.ts`.
    """

    EXPECTED_INPUTS_HASH = (
        "4c84f1101ecd46fd7709ea54bdd359927cd9c42c22322ef995426d4530e44eb4"
    )
    EXPECTED_COMMITMENT_HASH = (
        "e67c08703e4338b9b416af922fadbf3c482e801fe9d8a5f24996d8bc8be73ca2"
    )

    def test_inputs_hash_golden(self):
        h = compute_inputs_hash(base_inputs())
        assert h == self.EXPECTED_INPUTS_HASH, (
            "cross-lang hash drift — TS + Python no longer produce the same bytes.\n"
            f"  expected: {self.EXPECTED_INPUTS_HASH}\n"
            f"  got:      {h}\n"
            f"canonical: {serialize_canonical(base_inputs())}"
        )

    def test_commitment_hash_golden(self):
        i = base_inputs()
        ih = compute_inputs_hash(i)
        ch = compute_commitment_hash(i, ih)
        assert ch == self.EXPECTED_COMMITMENT_HASH, (
            "cross-lang commitment drift.\n"
            f"  expected: {self.EXPECTED_COMMITMENT_HASH}\n"
            f"  got:      {ch}"
        )
