import { invoke } from '@tauri-apps/api/core';

export interface IAPProduct {
  id: string;
  title: string;
  description: string;
  price: string;
  priceCurrencyCode?: string;
  priceAmountMicros: number;
  productType?: 'consumable' | 'non_consumable' | 'subscription';
}

interface IAPPurchaseBase {
  productId: string;
  purchaseDate: string;
}

interface IOSPurchase {
  platform: 'ios';
  transactionId?: string;
  originalTransactionId?: string;
  packageName?: never;
  orderId?: never;
  purchaseToken?: never;
}

interface AndroidPurchase {
  platform: 'android';
  packageName?: string;
  orderId?: string;
  purchaseToken?: string;
  transactionId?: never;
  originalTransactionId?: never;
}

export type IAPPurchase = IAPPurchaseBase & (IOSPurchase | AndroidPurchase);

interface IAPIsAvailableResponse {
  available: boolean;
}

interface InitializeRequest {
  publicKey?: string;
}

interface InitializeResponse {
  success: boolean;
}

interface FetchProductsRequest {
  productIds: string[];
}

interface FetchProductsResponse {
  products: IAPProduct[];
}

interface PurchaseProductRequest {
  productId: string;
}

interface PurchaseProductResponse {
  purchase: IAPPurchase;
}

interface RestorePurchasesResponse {
  purchases: IAPPurchase[];
}

export class IAPService {
  static async isAvailable(): Promise<boolean> {
    const result = await invoke<IAPIsAvailableResponse>('plugin:native-bridge|iap_is_available');
    return result.available;
  }

  async initialize(): Promise<boolean> {
    const result = await invoke<InitializeResponse>('plugin:native-bridge|iap_initialize', {
      payload: {} as InitializeRequest,
    });
    return result.success;
  }

  async fetchProducts(productIds: string[]): Promise<IAPProduct[]> {
    try {
      const response = await invoke<FetchProductsResponse>(
        'plugin:native-bridge|iap_fetch_products',
        {
          payload: { productIds } as FetchProductsRequest,
        },
      );
      return response.products;
    } catch (error) {
      console.error('Failed to fetch products:', error);
      throw error;
    }
  }

  async purchaseProduct(productId: string): Promise<IAPPurchase> {
    try {
      const response = await invoke<PurchaseProductResponse>(
        'plugin:native-bridge|iap_purchase_product',
        {
          payload: { productId } as PurchaseProductRequest,
        },
      );
      return response.purchase;
    } catch (error) {
      console.error('Failed to purchase product:', error);
      throw error;
    }
  }

  async restorePurchases(): Promise<IAPPurchase[]> {
    try {
      const response = await invoke<RestorePurchasesResponse>(
        'plugin:native-bridge|iap_restore_purchases',
      );
      return response.purchases;
    } catch (error) {
      console.error('Failed to restore purchases:', error);
      throw error;
    }
  }
}
