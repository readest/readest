import { PlanType } from '@/types/quota';

export type IAPStatus =
  | 'active'
  | 'expired'
  | 'cancelled'
  | 'in_grace_period'
  | 'revoked'
  | 'pending';

export interface VerifiedIAP {
  platform: 'ios' | 'android';
  status: IAPStatus;
  customerEmail: string;
  orderId: string;
  planName: string;
  planType: PlanType;
  productId: string;
  amount?: number;
  currency?: string;

  /**
   * @deprecated Use `orderId` instead.
   */
  subscriptionId?: string;
}

export enum IAPError {
  INVALID_INPUT = 'Invalid input data',
  NOT_AUTHENTICATED = 'Not authenticated',
  TRANSACTION_NOT_FOUND = 'Transaction not found',
  TRANSACTION_BELONGS_TO_ANOTHER_USER = 'This transaction does not belong to the authenticated user',
  TRANSACTION_SERVICE_UNAVAILABLE = 'Transaction service is currently unavailable. Please contact support.',
  TRANSACTION_CANNOT_BE_VERIFIED = 'The transaction could not be verified.',
  RESTORE_FAILED = 'Failed to restore purchases. Please try again later.',
  UNKNOWN_ERROR = 'Unknown error',
}
