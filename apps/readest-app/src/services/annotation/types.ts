import { BookConfig } from '@/types/book';
import { AppService } from '@/types/system';

import { AnnotationProviderName } from './providers';

export interface AnnotationImportProvider {
  name: string;
  /** Check whether this provider is applicable on the current platform. */
  isAvailable: (appService: AppService) => boolean;
  /** Import annotations for a book, merging with the current config. */
  importAnnotations: (
    appService: AppService,
    identifier: string,
    config: BookConfig,
  ) => Promise<BookConfig>;
}

export interface UseAnnotationImportOptions {
  provider?: AnnotationProviderName;
}
