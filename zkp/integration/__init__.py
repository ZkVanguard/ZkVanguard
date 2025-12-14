#!/usr/bin/env python3
"""
🔗 ZK SYSTEM INTEGRATION MODULE
==============================
High-level API and factory for ZK system management

This module provides the integration layer that connects
the core ZK system with CUDA optimizations.
"""

from .zk_system_hub import (
    ZKSystemFactory,
    ZKSystemManager, 
    create_zk_system,
    create_proof_manager,
    get_system_status,
    zk_factory
)

__all__ = [
    "ZKSystemFactory",
    "ZKSystemManager",
    "create_zk_system", 
    "create_proof_manager",
    "get_system_status",
    "zk_factory"
]
