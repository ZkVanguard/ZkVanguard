#!/usr/bin/env python3
"""Test if ZK system can be imported"""

try:
    from zkp.core.zk_system import AuthenticZKStark
    print("✓ ZK System loaded successfully")
    print(f"✓ AuthenticZKStark class available: {AuthenticZKStark}")
except Exception as e:
    print(f"✗ Failed to load ZK system: {e}")
    import traceback
    traceback.print_exc()
