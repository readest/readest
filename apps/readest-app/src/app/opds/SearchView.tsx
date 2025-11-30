'use client';

import { useState, FormEvent } from 'react';
import { IoSearch } from 'react-icons/io5';
import { OPDSSearch } from '@/types/opds';

interface SearchViewProps {
  search: OPDSSearch;
  baseURL: string;
  onNavigate: (url: string) => void;
  resolveURL: (url: string, base: string) => string;
}

export function SearchView({ search, baseURL, onNavigate, resolveURL }: SearchViewProps) {
  const [formData, setFormData] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    search.params?.forEach((param) => {
      initial[param.name] = param.value || '';
    });
    return initial;
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();

    const map = new Map<string | null, Map<string | null, string>>();

    for (const param of search.params || []) {
      const value = formData[param.name] || '';
      const ns = param.ns ?? null;

      if (map.has(ns)) {
        map.get(ns)!.set(param.name, value);
      } else {
        map.set(ns, new Map([[param.name, value]]));
      }
    }

    const searchURL = search.search(map);
    const resolvedURL = resolveURL(searchURL, baseURL);
    onNavigate(resolvedURL);
  };

  const handleInputChange = (name: string, value: string) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const getParamLabel = (name: string): string => {
    const labels: Record<string, string> = {
      searchTerms: 'Search',
      query: 'Query',
      title: 'Title',
      author: 'Author',
      publisher: 'Publisher',
      language: 'Language',
      subject: 'Subject',
    };
    return labels[name] || name;
  };

  return (
    <div className='container mx-auto max-w-2xl px-4 py-12'>
      <div className='mb-8 text-center'>
        <h1 className='mb-2 text-3xl font-bold'>{search.metadata?.title || 'Search'}</h1>
        {search.metadata?.description && (
          <p className='text-base-content/70'>{search.metadata.description}</p>
        )}
      </div>

      <form onSubmit={handleSubmit} className='space-y-4'>
        {(search.params || []).map((param) => (
          <div key={`${param.ns || 'default'}-${param.name}`} className='form-control'>
            <label className='label'>
              <span className='label-text font-medium'>
                {getParamLabel(param.name)}
                {param.required && <span className='text-error ml-1'>*</span>}
              </span>
            </label>
            <input
              type={param.name === 'searchTerms' || param.name === 'query' ? 'search' : 'text'}
              value={formData[param.name] || ''}
              onChange={(e) => handleInputChange(param.name, e.target.value)}
              required={param.required}
              placeholder={`Enter ${getParamLabel(param.name).toLowerCase()}`}
              className='input input-bordered w-full'
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus={
                param.name === 'searchTerms' ||
                param.name === 'query' ||
                search.params[0]?.name === param.name
              }
            />
          </div>
        ))}

        <div className='pt-4'>
          <button type='submit' className='btn btn-primary w-full'>
            <IoSearch className='h-5 w-5' />
            Search
          </button>
        </div>
      </form>
    </div>
  );
}
