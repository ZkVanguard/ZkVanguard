"""
ZK optimizations package — currently empty after the CUDATrueSTARK cutover
(commit c56ff363) collapsed the legacy AuthenticZKStark wrapper into a
single prover in zkp.core.cuda_true_stark. The old cuda_acceleration
module was deleted in commit 1aed48ab.

The `zkp.core.cuda_true_stark.CUDA_AVAILABLE` flag is now the single
source of truth for CUDA state — probe-verified at import (runs an
actual GPU kernel to catch missing nvrtc DLLs on Windows).

Re-exported here for the small number of legacy callers that reach for
`zkp.optimizations.CUDA_AVAILABLE`.
"""

from zkp.core.cuda_true_stark import CUDA_AVAILABLE

__all__ = ["CUDA_AVAILABLE"]
