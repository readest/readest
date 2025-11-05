import { useEffect, useState } from 'react';
import { BookMetadata } from '@/libs/document';
import {
  validateAndNormalizeDate,
  validateAndNormalizeLanguage,
  validateAndNormalizeSubjects,
  validateISBN,
  ValidationResult,
} from '@/utils/validation';
import { MetadataSource } from './SourceSelector';
import { searchMetadata } from '@/libs/metadata';
import { formatAuthors, formatTitle, getPrimaryLanguage } from '@/utils/book';

export const useMetadataEdit = (metadata: BookMetadata | null) => {
  const [editedMeta, setEditedMeta] = useState<BookMetadata>({} as BookMetadata);
  const [fieldSources, setFieldSources] = useState<Record<string, string>>({});
  const [lockedFields, setLockedFields] = useState<Record<string, boolean>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [searchLoading, setSearchLoading] = useState(false);
  const [showSourceSelection, setShowSourceSelection] = useState(false);
  const [availableSources, setAvailableSources] = useState<MetadataSource[]>([]);

  const lockableFields = [
    'title',
    'author',
    'publisher',
    'published',
    'language',
    'identifier',
    'subject',
    'description',
    'subtitle',
    'series',
    'seriesIndex',
    'seriesTotal',
    'coverImageUrl',
  ];

  useEffect(() => {
    if (metadata) {
      setEditedMeta({ ...metadata });
    }
  }, [metadata]);

  useEffect(() => {
    const initialLockedFields: Record<string, boolean> = {};
    lockableFields.forEach((field) => {
      initialLockedFields[field] = false;
    });
    setLockedFields(initialLockedFields);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFieldChange = (field: string, value: string | undefined) => {
    if (lockedFields[field]) {
      return;
    }

    setEditedMeta((prevMeta) => {
      const newMeta = { ...prevMeta } as { [key: string]: unknown };
      switch (field) {
        case 'subject':
          newMeta['subject'] = value ? value.split(/,|;|，|、/).map((s) => s.trim()) : [];
          break;
        default:
          newMeta[field] = value;
      }
      return newMeta as BookMetadata;
    });

    if (value !== undefined) {
      handleFieldValidation(field, value);
    }

    if (fieldSources[field]) {
      setFieldSources((prevSources) => {
        const newSources = { ...prevSources };
        delete newSources[field];
        return newSources;
      });
    }
  };

  const handleFieldValidation = (field: string, value: string) => {
    if (lockedFields[field]) {
      return true;
    }

    let validationResult: ValidationResult<unknown>;
    switch (field) {
      case 'title':
      case 'author':
        if (!value.trim()) {
          console.warn(`Field ${field} cannot be empty`);
          setFieldErrors((prev) => ({ ...prev, [field]: 'This field is required' }));
          return false;
        }
        break;

      case 'published':
        if (value.trim()) {
          validationResult = validateAndNormalizeDate(value);
          if (!validationResult.isValid) {
            console.warn(`Invalid date for field ${field}:`, validationResult.error);
            setFieldErrors((prev) => ({ ...prev, [field]: validationResult.error || '' }));
            return false;
          }
        }
        break;

      case 'language':
        if (value.trim()) {
          validationResult = validateAndNormalizeLanguage(value);
          if (!validationResult.isValid) {
            console.warn(`Invalid language for field ${field}:`, validationResult.error);
            setFieldErrors((prev) => ({ ...prev, [field]: validationResult.error || '' }));
            return false;
          }
        }
        break;

      case 'subject':
        if (value.trim()) {
          validationResult = validateAndNormalizeSubjects(value);
          if (!validationResult.isValid) {
            console.warn(`Invalid subjects for field ${field}:`, validationResult.error);
            setFieldErrors((prev) => ({ ...prev, [field]: validationResult.error || '' }));
            return false;
          }
        }
        break;
    }

    setFieldErrors((prev) => {
      const newErrors = { ...prev };
      delete newErrors[field];
      return newErrors;
    });

    return true;
  };

  const handleToggleFieldLock = (field: string) => {
    setLockedFields((prev) => ({
      ...prev,
      [field]: !prev[field],
    }));
  };

  const handleLockAll = () => {
    const allLocked: Record<string, boolean> = {};
    lockableFields.forEach((field) => {
      allLocked[field] = true;
    });
    setLockedFields(allLocked);
  };

  const handleUnlockAll = () => {
    const allUnlocked: Record<string, boolean> = {};
    lockableFields.forEach((field) => {
      allUnlocked[field] = false;
    });
    setLockedFields(allUnlocked);
  };

  const handleAutoRetrieve = async () => {
    setSearchLoading(true);
    try {
      const isbnValidation = validateISBN(editedMeta.identifier || '');
      const results = await searchMetadata({
        title: formatTitle(editedMeta.title),
        author: formatAuthors(editedMeta.author),
        isbn: isbnValidation.isValid ? editedMeta.identifier : undefined,
        language: getPrimaryLanguage(editedMeta.language),
      });
      const metadataSources = results.map((result) => ({
        sourceName: result.providerName,
        sourceLabel: result.providerLabel,
        confidence: result.confidence,
        data: result.metadata as BookMetadata,
      }));
      setAvailableSources(metadataSources);
      setShowSourceSelection(true);
    } catch (error) {
      console.error('Failed to retrieve metadata:', error);
    } finally {
      setSearchLoading(false);
    }
  };

  const handleSourceSelection = (selectedSource: MetadataSource) => {
    const newMeta = { ...editedMeta } as { [key: string]: unknown };
    const newSources = { ...fieldSources };

    Object.entries(selectedSource.data).forEach(([key, value]) => {
      if (lockedFields[key] || !value) {
        return;
      }
      switch (key) {
        default:
          newMeta[key] = value;
      }
      newSources[key] = `${selectedSource.sourceName}-${selectedSource.confidence}`;
    });

    setEditedMeta(newMeta as BookMetadata);
    setFieldSources(newSources);
    setShowSourceSelection(false);
  };

  const handleCloseSourceSelection = () => {
    setShowSourceSelection(false);
  };

  const resetToOriginal = () => {
    if (metadata) {
      setEditedMeta({ ...metadata });
    }
    setFieldSources({});
    setShowSourceSelection(false);
    handleUnlockAll();
  };

  return {
    editedMeta,
    fieldSources,
    lockedFields,
    fieldErrors,
    searchLoading,
    showSourceSelection,
    availableSources,
    handleFieldChange,
    handleFieldValidation,
    handleToggleFieldLock,
    handleLockAll,
    handleUnlockAll,
    handleAutoRetrieve,
    handleSourceSelection,
    handleCloseSourceSelection,
    resetToOriginal,
  };
};
