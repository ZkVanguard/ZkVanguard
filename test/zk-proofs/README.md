# Development Tools

This directory contains development and testing utilities.

## 📁 Contents

### ZK-STARK Testing & Validation
- **test_zk_system.py** - Main ZK proof system integration test
- **test_real_world_zk.py** - Real-world ZK-STARK scenario tests
- **test_zk_import.py** - ZK module import validation
- **test_api_proof.py** - API endpoint testing for proof generation
- **inspect_proof.py** - Proof inspection and analysis tool
- **sample_proof.json** - Sample ZK-STARK proof (77KB)

## 🧪 Running Tests

### ZK System Tests
```bash
# Run full ZK system test
python tools/test_zk_system.py

# Test real-world scenarios
python tools/test_real_world_zk.py

# Validate imports
python tools/test_zk_import.py
```

### API Tests
```bash
# Test proof generation API
python tools/test_api_proof.py
```

### Proof Inspection
```bash
# Inspect a proof file
python tools/inspect_proof.py tools/sample_proof.json

# Analyze proof components
python tools/inspect_proof.py --verbose tools/sample_proof.json
```

## 📊 Sample Proof

The `sample_proof.json` file contains a real ZK-STARK proof with:
- 521-bit post-quantum security
- 32 query responses with Merkle paths
- 256 authentication hashes
- Full FRI (Fast Reed-Solomon IOP) commitment

See [PROOF_EVIDENCE.md](../docs/PROOF_EVIDENCE.md) for detailed analysis.

## 🔧 Requirements

```bash
pip install numpy sympy
```

## 📝 Notes

- All tests use the real ZK-STARK implementation in `zkp/`
- Tests validate cryptographic properties and privacy guarantees
- Sample proof demonstrates actual production capabilities
