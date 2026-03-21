
// Basic AES-GCM wrapper for browser environment
// Uses window.crypto.subtle

export async function generateKey(): Promise<CryptoKey> {
  return window.crypto.subtle.generateKey(
    {
      name: "AES-GCM",
      length: 256
    },
    true,
    ["encrypt", "decrypt"]
  );
}

export async function exportKey(key: CryptoKey): Promise<string> {
  const exported = await window.crypto.subtle.exportKey("jwk", key);
  return JSON.stringify(exported);
}

export async function importKey(jwkStr: string): Promise<CryptoKey> {
  const jwk = JSON.parse(jwkStr);
  return window.crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "AES-GCM" },
    true,
    ["encrypt", "decrypt"]
  );
}

export async function encryptData(text: string, key: CryptoKey): Promise<{ iv: string; data: string }> {
  const encoder = new TextEncoder();
  const encoded = encoder.encode(text);
  
  // IV must be 12 bytes for GCM
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  
  const encrypted = await window.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv
    },
    key,
    encoded
  );

  return {
    iv: arrayBufferToBase64(iv.buffer as ArrayBuffer),
    data: arrayBufferToBase64(encrypted)
  };
}

export async function decryptData(encryptedData: string, ivStr: string, key: CryptoKey): Promise<string> {
  const encrypted = base64ToArrayBuffer(encryptedData);
  const iv = base64ToArrayBuffer(ivStr);

  const decrypted = await window.crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: iv
    },
    key,
    encrypted
  );

  const decoder = new TextDecoder();
  return decoder.decode(decrypted);
}

// Helpers
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary_string = window.atob(base64);
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes.buffer;
}
