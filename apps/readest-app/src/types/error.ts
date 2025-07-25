export enum IAPError {
  INVALID_INPUT = 'Invalid input data',
  NOT_AUTHENTICATED = 'Not authenticated',
  TRANSACTION_NOT_FOUND = 'Transaction not found',
  TRANSACTION_BELONGS_TO_ANOTHER_USER = 'This transaction does not belong to the authenticated user',
  TRANSACTION_SERVICE_UNAVAILABLE = 'Transaction service is currently unavailable. Please contact support.',
  RESTORE_FAILED = 'Failed to restore purchases. Please try again later.',
  UNKNOWN_ERROR = 'Unknown error',
}
