import type { AivatarContent, AivatarMemory, AivatarSaveState, ItemDefinition } from "../types";
import type { DesktopVendingProductId } from "./desktopTypes";
import { applyConsumableEffect } from "../game/simulation";

export type { DesktopVendingProductId } from "./desktopTypes";
export interface DesktopVendingPurchaseRequest { requestId: string; productId: DesktopVendingProductId }
export type DesktopVendingFailure = "invalid-request" | "invalid-product" | "unavailable"
  | "insufficient-funds" | "busy" | "closing" | "slot-changed" | "desktop-inactive";
export interface DesktopVendingPurchaseReceipt extends DesktopVendingPurchaseRequest {
  ok: boolean;
  reason?: DesktopVendingFailure;
  price?: number;
}
export interface VendingProductOffer {
  id: DesktopVendingProductId;
  name: string;
  price: number;
  available: boolean;
}
export type VendingSoundCue = "press" | "dispense" | "pickup"
  | "consume_cookie" | "consume_cola" | "consume_coffee" | "stop";
export type DesktopVendingProduct = VendingProductOffer;
export type DesktopVendingSoundCue = VendingSoundCue;

const PRODUCT_IDS: readonly DesktopVendingProductId[] = ["cookie", "cola", "coffee"];
const isProductId = (id: unknown): id is DesktopVendingProductId =>
  PRODUCT_IDS.includes(id as DesktopVendingProductId);

const resolveProduct = (content: Pick<AivatarContent, "shop" | "itemDefinitions">, id: DesktopVendingProductId) => {
  const offer = content.shop.items.find((item) => item.id === id);
  const consumable = content.itemDefinitions.find((item) => item.id === id);
  const kind = id === "cookie" ? "food" : "drink";
  if (!offer || !consumable || offer.kind !== kind || consumable.kind !== kind
    || !Number.isFinite(offer.price) || offer.price <= 0 || offer.price > Number.MAX_SAFE_INTEGER
    || !consumable.effect
    || !Object.values(consumable.effect).every((value) => Number.isFinite(value) && value >= 0 && value <= 100)) return null;
  return { offer, consumable };
};

/** Price follows the live shop; recovery follows the live item definition. */
export const desktopVendingProducts = (
  content: Pick<AivatarContent, "shop" | "itemDefinitions">,
  unlocked: (item: ItemDefinition) => boolean = () => true,
): VendingProductOffer[] => PRODUCT_IDS.map((id) => {
  const product = resolveProduct(content, id);
  return {
    id, name: product?.offer.name ?? id,
    price: product?.offer.price ?? 0,
    available: Boolean(product && unlocked(product.offer)),
  };
});

interface PurchaseContext {
  save: AivatarSaveState;
  content: Pick<AivatarContent, "shop" | "itemDefinitions">;
  ownerSlotId: string | null;
  activeSlotId: string | null;
  closing: boolean;
  busy: boolean;
  desktopActive: boolean;
  canPurchase: (save: AivatarSaveState, item: ItemDefinition) => boolean;
  recordMemory: (memory: AivatarMemory | undefined, offer: ItemDefinition,
    consumable: ItemDefinition, requestId: string) => AivatarMemory;
}

/** One instance belongs to the App save owner, never to a renderer or frame. */
export const createDesktopVendingTransactions = () => {
  // Retain receipts for this owner's lifetime. Evicting a successful request
  // would make a late/repeated callback capable of charging it again.
  const receipts = new Map<string, { slotId: string; receipt: DesktopVendingPurchaseReceipt }>();
  return {
    purchase(request: DesktopVendingPurchaseRequest, context: PurchaseContext) {
      const finish = (receipt: DesktopVendingPurchaseReceipt, save = context.save, applied = false) =>
        ({ receipt, save, applied });
      const reject = (reason: DesktopVendingFailure) => finish({ ...request, ok: false, reason });
      if (!request || typeof request.requestId !== "string"
        || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(request.requestId)) return reject("invalid-request");
      if (!isProductId(request.productId)) return reject("invalid-product");
      if (context.closing) return reject("closing");
      if (!context.ownerSlotId || context.ownerSlotId !== context.activeSlotId) return reject("slot-changed");
      if (!context.desktopActive) return reject("desktop-inactive");
      const previous = receipts.get(request.requestId);
      if (previous) {
        if (previous.slotId !== context.ownerSlotId) return reject("slot-changed");
        if (previous.receipt.productId !== request.productId) return reject("invalid-request");
        return finish(previous.receipt);
      }
      const rememberFailure = (reason: DesktopVendingFailure) => {
        const result = reject(reason);
        receipts.set(request.requestId, { slotId: context.ownerSlotId!, receipt: result.receipt });
        return result;
      };
      if (context.busy) return rememberFailure("busy");
      const product = resolveProduct(context.content, request.productId);
      if (!product) return rememberFailure("unavailable");
      const { offer, consumable } = product;
      if (!Number.isFinite(context.save.wallet.bits) || context.save.wallet.bits < offer.price) {
        return rememberFailure("insufficient-funds");
      }
      if (!context.canPurchase(context.save, offer)) return rememberFailure("unavailable");
      const next: AivatarSaveState = {
        ...context.save,
        wallet: { ...context.save.wallet, bits: context.save.wallet.bits - offer.price },
        petStats: applyConsumableEffect(context.save.petStats, consumable.effect),
        purchasedItemIds: [...new Set([...context.save.purchasedItemIds, offer.id])],
        memory: context.recordMemory(context.save.memory, offer, consumable, request.requestId),
        // This purchase is immediately consumed: no inventory or storage hop.
      };
      const receipt: DesktopVendingPurchaseReceipt = { ...request, ok: true, price: offer.price };
      receipts.set(request.requestId, { slotId: context.ownerSlotId, receipt });
      return finish(receipt, next, true);
    },
  };
};
