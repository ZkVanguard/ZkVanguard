/**
 * Contract lock for BlueFin request signers.
 *
 * Signature stability matters: if the UI-format JSON drifts (extra
 * field, changed casing, different indent), BlueFin's server-side
 * signature validation fails silently — same failure class as the
 * step-size drop bug from 2026-05-30/31. These tests capture the exact
 * bytes each signer produces so a "cosmetic" refactor can't accidentally
 * change the wire format.
 *
 * Uses a fake signer that records the bytes passed to signPersonalMessage
 * — no real crypto needed.
 */
import { describe, it, expect } from '@jest/globals';
import {
  signOrderRequest,
  signMarginAdjustRequest,
  signWithdrawRequest,
  signLeverageRequest,
  type BluefinSigner,
} from '@/lib/services/sui/bluefin/sign-request';

function fakeSigner(): { signer: BluefinSigner; capturedJson: () => string } {
  let captured = '';
  return {
    signer: {
      async signPersonalMessage(bytes: Uint8Array) {
        captured = new TextDecoder().decode(bytes);
        return { signature: 'fake-sig', bytes: Buffer.from(bytes).toString('base64') };
      },
    },
    capturedJson: () => captured,
  };
}

describe('bluefin request signers — wire-format contract', () => {
  it('signOrderRequest produces the exact SDK-shape UI object', async () => {
    const { signer, capturedJson } = fakeSigner();
    const sig = await signOrderRequest(signer, {
      idsId: 'ids-1',
      accountAddress: '0xabc',
      symbol: 'ETH-PERP',
      priceE9: '0',
      quantityE9: '10000000',
      leverageE9: '3000000000',
      side: 'SHORT',
      isIsolated: true,
      expiresAtMillis: 1_800_000_000_000,
      salt: 'salt-1',
      signedAtMillis: 1_800_000_000_000,
    });
    expect(sig).toBe('fake-sig');
    const parsed = JSON.parse(capturedJson());
    expect(parsed).toEqual({
      type: 'Bluefin Pro Order',
      ids: 'ids-1',
      account: '0xabc',
      market: 'ETH-PERP',
      price: '0',
      quantity: '10000000',
      leverage: '3000000000',
      side: 'SHORT',
      positionType: 'ISOLATED',
      expiration: '1800000000000',
      salt: 'salt-1',
      signedAt: '1800000000000',
    });
    // Pretty-print (2-space indent) matters for signature validation.
    expect(capturedJson().includes('\n  "type"')).toBe(true);
  });

  it('signMarginAdjustRequest — SUBTRACT for isolated dust exit', async () => {
    const { signer, capturedJson } = fakeSigner();
    await signMarginAdjustRequest(signer, {
      idsId: 'ids-1', accountAddress: '0xabc', symbol: 'ETH-PERP',
      add: false, quantityE9: '11500000000',
      salt: 'salt-2', signedAtMillis: 1_800_000_000_000,
    });
    const parsed = JSON.parse(capturedJson());
    expect(parsed.type).toBe('Bluefin Pro Margin Adjustment');
    expect(parsed.add).toBe(false);
    expect(parsed.amount).toBe('11500000000');
    expect(parsed.market).toBe('ETH-PERP');
  });

  it('signWithdrawRequest uses the withdrawal type discriminator', async () => {
    const { signer, capturedJson } = fakeSigner();
    await signWithdrawRequest(signer, {
      idsId: 'ids-1', accountAddress: '0xabc',
      assetSymbol: 'USDC', amountE9: '1000000000',
      salt: 'salt-3', signedAtMillis: 1_800_000_000_000,
    });
    const parsed = JSON.parse(capturedJson());
    expect(parsed.type).toBe('Bluefin Pro Withdrawal');
    expect(parsed.asset).toBe('USDC');
    expect(parsed.amount).toBe('1000000000');
  });

  it('signLeverageRequest uses the leverage type discriminator', async () => {
    const { signer, capturedJson } = fakeSigner();
    await signLeverageRequest(signer, {
      idsId: 'ids-1', accountAddress: '0xabc', symbol: 'BTC-PERP',
      leverageE9: '5000000000',
      salt: 'salt-4', signedAtMillis: 1_800_000_000_000,
    });
    const parsed = JSON.parse(capturedJson());
    expect(parsed.type).toBe('Bluefin Pro Leverage Adjustment');
    expect(parsed.leverage).toBe('5000000000');
  });

  it('CROSS position type maps correctly (regression guard for isIsolated=false)', async () => {
    const { signer, capturedJson } = fakeSigner();
    await signOrderRequest(signer, {
      idsId: 'ids-1', accountAddress: '0xabc', symbol: 'ETH-PERP',
      priceE9: '0', quantityE9: '10000000', leverageE9: '3000000000',
      side: 'LONG', isIsolated: false, expiresAtMillis: 1_800_000_000_000,
      salt: 'salt-5', signedAtMillis: 1_800_000_000_000,
    });
    expect(JSON.parse(capturedJson()).positionType).toBe('CROSS');
  });
});
