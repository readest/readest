import type { ConvertInput } from './convertToEpub';

export interface ConversionWorkerRequest {
  type: 'convert';
  payload: ConvertInput;
}

export interface ConversionWorkerSuccess {
  type: 'success';
  payload: {
    epubBuffer: ArrayBuffer;
    name: string;
    title: string;
    author: string;
  };
}

export interface ConversionWorkerError {
  type: 'error';
  payload: {
    message: string;
    code?: string;
  };
}

export type ConversionWorkerResponse = ConversionWorkerSuccess | ConversionWorkerError;
