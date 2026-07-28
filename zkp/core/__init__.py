#!/usr/bin/env python3
"""
🔒 ZK SYSTEM CORE MODULE
========================
CUDA-Accelerated True STARK Implementation

This module provides the unified interface to the ZK-STARK system,
using CUDATrueSTARK — the whitepaper-aligned prover:

- AIR (Algebraic Intermediate Representation) for constraint encoding
- FRI over a multiplicative coset with per-layer folding-consistency
  check (v, s = f(x), f(-x); f_next(x²) = (v+s)/2 + α·(v-s)/(2x))
- 20-bit grinding PoW bound to the full commitment transcript
- Goldilocks prime (2^64 − 2^32 + 1) — Polygon zkEVM / Plonky2 field
- CUDA acceleration where available (probe-verified at import)
"""

# Import from the CUDA-accelerated True STARK implementation
from .cuda_true_stark import (
    CUDATrueSTARK,
    CUDAFiniteField,
    Polynomial,
    MerkleTree,
    AIR,
    FRI,
    STARKConfig,
    create_stark_prover,
    CUDA_AVAILABLE
)

# Backward-compatible aliases
AuthenticZKStark = CUDATrueSTARK
TrueZKStark = CUDATrueSTARK
AuthenticFiniteField = CUDAFiniteField
AuthenticMerkleTree = MerkleTree

__all__ = [
    # Primary implementation
    "CUDATrueSTARK",
    "CUDAFiniteField",
    "Polynomial",
    "MerkleTree",
    "AIR",
    "FRI",
    "STARKConfig",
    "create_stark_prover",
    "CUDA_AVAILABLE",
    
    # Backward-compatible aliases
    "AuthenticZKStark",
    "TrueZKStark",
    "AuthenticFiniteField", 
    "AuthenticMerkleTree",
]

# System metadata
CORE_VERSION = "5.1.0-CUDA-STARK"
SECURITY_LEVEL = 512  # target parameter; whitepaper effective soundness = 2^-180
PRIME_FIELD = "GOLDILOCKS"
IMPLEMENTATION_TYPE = "CUDA-True-STARK-Production"
PROTOCOL = "AIR + FRI (multiplicative coset, per-layer folding check)"
