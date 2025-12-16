import orjson

# Simulate exact structure
data = {
    'job_id': 'test123',
    'status': 'completed',
    'proof': {
        'privacy_enhancements': {
            'witness_blinding': False,
            'multi_polynomial': False,
            'constant_time': False,
            '_test_marker': 'TEST'
        },
        'statement_hash': 123456789012345678901234567890  # Large int
    }
}

print("=== Before orjson ===")
print(f"witness_blinding: {data['proof']['privacy_enhancements']['witness_blinding']} (type: {type(data['proof']['privacy_enhancements']['witness_blinding'])})")

print("\n=== After orjson.dumps ===")
json_bytes = orjson.dumps(data, option=orjson.OPT_INDENT_2)
print(json_bytes.decode())

print("\n=== After orjson.loads ===")
parsed = orjson.loads(json_bytes)
print(f"witness_blinding: {parsed['proof']['privacy_enhancements']['witness_blinding']} (type: {type(parsed['proof']['privacy_enhancements']['witness_blinding'])})")

# Now test with default (no option)
print("\n=== With default orjson (no OPT_INDENT_2) ===")
json_bytes2 = orjson.dumps(data)
parsed2 = orjson.loads(json_bytes2)
print(f"witness_blinding: {parsed2['proof']['privacy_enhancements']['witness_blinding']} (type: {type(parsed2['proof']['privacy_enhancements']['witness_blinding'])})")
