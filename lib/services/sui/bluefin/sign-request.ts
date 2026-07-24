/**
 * BlueFin Pro request signing — pure primitives.
 *
 * All signed requests to BlueFin Pro's trade API share the same pattern:
 *   1. Transform typed fields → BlueFin's UI-format JSON object with a
 *      `type` discriminator (per @bluefin-exchange/pro-sdk conventions)
 *   2. Pretty-print with 2-space indent (SDK matches — deviation breaks
 *      signature validation server-side)
 *   3. Sign the UTF-8 bytes with signPersonalMessage
 *
 * We don't use the SDK's request-signer directly because BluefinClient
 * fails to initialize in Vercel serverless (FAILED_TO_INITIALIZE_CLIENT,
 * observed 2026-05-30/31 incident). Raw signing via @mysten/sui keypair
 * works fine — this file is the minimum surface.
 *
 * Each exported signer takes typed fields + a keypair-like signer,
 * returns the base64 signature. No I/O, no globals, testable.
 */
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

/** Anything that can signPersonalMessage — Ed25519Keypair, or a test double. */
export type BluefinSigner = Pick<Ed25519Keypair, 'signPersonalMessage'>;

// ─── Type discriminators (per BlueFin Pro SDK's ClientPayloadType) ────────
const TYPE_ORDER = 'Bluefin Pro Order';
const TYPE_MARGIN_ADJUST = 'Bluefin Pro Margin Adjustment';
const TYPE_WITHDRAW = 'Bluefin Pro Withdrawal';
const TYPE_LEVERAGE = 'Bluefin Pro Leverage Adjustment';

async function signUi(signer: BluefinSigner, ui: Record<string, unknown>): Promise<string> {
  const json = JSON.stringify(ui, null, 2);
  const bytes = new TextEncoder().encode(json);
  const { signature } = await signer.signPersonalMessage(bytes);
  return signature;
}

// ─── Order request ─────────────────────────────────────────────────────────

export interface OrderSignedFields {
  idsId: string;
  accountAddress: string;
  symbol: string;
  priceE9: string;
  quantityE9: string;
  leverageE9: string;
  side: string;
  isIsolated: boolean;
  expiresAtMillis: number;
  salt: string;
  signedAtMillis: number;
}

export async function signOrderRequest(
  signer: BluefinSigner,
  fields: OrderSignedFields,
): Promise<string> {
  return signUi(signer, {
    type: TYPE_ORDER,
    ids: fields.idsId,
    account: fields.accountAddress,
    market: fields.symbol,
    price: fields.priceE9,
    quantity: fields.quantityE9,
    leverage: fields.leverageE9,
    side: fields.side.toString(),
    positionType: fields.isIsolated ? 'ISOLATED' : 'CROSS',
    expiration: fields.expiresAtMillis.toString(),
    salt: fields.salt,
    signedAt: fields.signedAtMillis.toString(),
  });
}

// ─── Margin adjustment (dust exit path candidate) ──────────────────────────

export interface MarginAdjustSignedFields {
  idsId: string;
  accountAddress: string;
  symbol: string;
  add: boolean; // true = ADD, false = SUBTRACT
  quantityE9: string;
  salt: string;
  signedAtMillis: number;
}

export async function signMarginAdjustRequest(
  signer: BluefinSigner,
  fields: MarginAdjustSignedFields,
): Promise<string> {
  return signUi(signer, {
    type: TYPE_MARGIN_ADJUST,
    ids: fields.idsId,
    account: fields.accountAddress,
    market: fields.symbol,
    add: fields.add,
    amount: fields.quantityE9,
    salt: fields.salt,
    signedAt: fields.signedAtMillis.toString(),
  });
}

// ─── Withdraw request ──────────────────────────────────────────────────────

export interface WithdrawSignedFields {
  idsId: string;
  accountAddress: string;
  assetSymbol: string;
  amountE9: string;
  salt: string;
  signedAtMillis: number;
}

export async function signWithdrawRequest(
  signer: BluefinSigner,
  fields: WithdrawSignedFields,
): Promise<string> {
  return signUi(signer, {
    type: TYPE_WITHDRAW,
    ids: fields.idsId,
    account: fields.accountAddress,
    asset: fields.assetSymbol,
    amount: fields.amountE9,
    salt: fields.salt,
    signedAt: fields.signedAtMillis.toString(),
  });
}

// ─── Leverage adjustment ───────────────────────────────────────────────────

export interface LeverageSignedFields {
  idsId: string;
  accountAddress: string;
  symbol: string;
  leverageE9: string;
  salt: string;
  signedAtMillis: number;
}

export async function signLeverageRequest(
  signer: BluefinSigner,
  fields: LeverageSignedFields,
): Promise<string> {
  return signUi(signer, {
    type: TYPE_LEVERAGE,
    ids: fields.idsId,
    account: fields.accountAddress,
    market: fields.symbol,
    leverage: fields.leverageE9,
    salt: fields.salt,
    signedAt: fields.signedAtMillis.toString(),
  });
}
