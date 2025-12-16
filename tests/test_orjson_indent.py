import orjson

# Test exact structure
proof_data = {
    'privacy_enhancements': {
        'witness_blinding': False,
        'multi_polynomial': False,
        'double_commitment': False,
        'constant_time': False
    }
}

print("=== Original Data ===")
print(proof_data)
print(f"Type of witness_blinding: {type(proof_data['privacy_enhancements']['witness_blinding'])}")

print("\n=== After orjson.dumps with OPT_INDENT_2 ===")
json_bytes = orjson.dumps(proof_data, option=orjson.OPT_INDENT_2)
print(json_bytes.decode())

print("\n=== After orjson.loads ===")
parsed = orjson.loads(json_bytes)
print(parsed)
print(f"Type of witness_blinding: {type(parsed['privacy_enhancements']['witness_blinding'])}")
print(f"Value: {parsed['privacy_enhancements']['witness_blinding']}")

# Also test with nested structure
print("\n=== Test with Response-like structure ===")
response_data = {
    'job_id': 'test123',
    'status': 'completed',
    'proof': proof_data
}

json_bytes2 = orjson.dumps(response_data, option=orjson.OPT_INDENT_2)
print(json_bytes2.decode())

parsed2 = orjson.loads(json_bytes2)
pe = parsed2['proof']['privacy_enhancements']
print(f"\nAfter parsing nested:")
print(f"witness_blinding = {pe['witness_blinding']} (type: {type(pe['witness_blinding'])})")
