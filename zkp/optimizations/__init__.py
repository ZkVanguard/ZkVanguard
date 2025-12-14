#!/usr/bin/env python3
"""
🚀 ZK SYSTEM OPTIMIZATIONS MODULE
=================================
CUDA GPU acceleration for the ZK system

This module provides CUDA-accelerated implementations
that extend the core ZK system for high performance.
"""

try:
    from .cuda_acceleration import (
        CUDAAcceleratedZKStark,
        CUDAAcceleratedField,
        CUDAOptimizer,
        get_optimized_zk_system,
        get_cuda_status,
        cuda_optimizer
    )
    
    CUDA_AVAILABLE = True
    
    __all__ = [
        "CUDAAcceleratedZKStark",
        "CUDAAcceleratedField", 
        "CUDAOptimizer",
        "get_optimized_zk_system",
        "get_cuda_status",
        "cuda_optimizer",
        "CUDA_AVAILABLE"
    ]
    
except ImportError as e:
    CUDA_AVAILABLE = False
    __all__ = ["CUDA_AVAILABLE"]
    print(f"⚠️ CUDA optimizations unavailable: {e}")
