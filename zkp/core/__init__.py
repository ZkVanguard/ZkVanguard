#!/usr/bin/env python3
"""
🔒 ZK SYSTEM CORE MODULE
========================
The single authoritative ZK-STARK implementation

This module contains the only official ZK system implementation.
All other modules extend or use this core system.
"""

from .true_stark import (
    TrueZKStark,
    FiniteField as AuthenticFiniteField,
    MerkleTree as AuthenticMerkleTree,
    AIR,
    FRI,
    Polynomial
)
from .stark_compat import STARKCompatibilityWrapper as AuthenticZKStark

__all__ = [
    "AuthenticZKStark",  # API-compatible STARK wrapper
    "TrueZKStark",       # Direct STARK implementation
    "AuthenticFiniteField", 
    "AuthenticMerkleTree",
    "AIR",
    "FRI",
    "Polynomial"
]

# System metadata
CORE_VERSION = "4.0.0-STARK"
SECURITY_LEVEL = 521
PRIME_FIELD = "NIST_P_521"
IMPLEMENTATION_TYPE = "True-STARK-Production"
PROTOCOL = "AIR + FRI"
