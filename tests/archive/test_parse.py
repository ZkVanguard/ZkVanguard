test_obj = {
    "statement_hash": "44620813622430180211862061922014157571665447624715181525936334993318593500646",
    "challenge": "12345678901234567890",
    "nested": {
        "value": "99999999999999999999"
    }
}

def parse_string_ints_to_int(obj):
    """Recursively convert string integers back to int"""
    if isinstance(obj, str):
        # Try to parse as integer if it looks like a large number
        if obj.isdigit() or (obj.startswith('-') and obj[1:].isdigit()):
            try:
                return int(obj)
            except (ValueError, OverflowError):
                return obj
        return obj
    elif isinstance(obj, dict):
        return {k: parse_string_ints_to_int(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [parse_string_ints_to_int(item) for item in obj]
    return obj

print("Before:", test_obj)
print("Types:", {k: type(v).__name__ for k, v in test_obj.items()})

parsed = parse_string_ints_to_int(test_obj)
print("\nAfter:", parsed)
print("Types:", {k: type(v).__name__ for k, v in parsed.items()})
print("Nested type:", type(parsed["nested"]["value"]).__name__)
