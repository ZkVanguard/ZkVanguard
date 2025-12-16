import orjson

# Test orjson with booleans
data = {
    'witness_blinding': False,
    'multi_polynomial': False,
    'test_true': True,
    'test_number': 42
}

print("=== Testing orjson ===")
print(f"Original data: {data}")

# Serialize with orjson
json_bytes = orjson.dumps(data)
print(f"\nSerialized bytes: {json_bytes}")
print(f"Decoded string: {json_bytes.decode()}")

# Deserialize
parsed = orjson.loads(json_bytes)
print(f"\nParsed data: {parsed}")
print(f"witness_blinding type: {type(parsed['witness_blinding'])}")
print(f"witness_blinding value: {parsed['witness_blinding']}")
