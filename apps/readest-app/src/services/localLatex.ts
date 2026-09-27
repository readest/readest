import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';

export type LatexEngine = 'pdflatex' | 'xelatex' | 'lualatex';

export interface LocalLatexResult {
  engine: LatexEngine;
  pdfBase64: string;
  syncTexBase64: string;
  log: string;
}

export const detectLocalLatexEngines = () => invoke<LatexEngine[]>('detect_latex_engines');

export const compileLocalLatex = (jobId: string, engine: LatexEngine, source: string) =>
  invoke<LocalLatexResult>('compile_latex_source', { jobId, engine, source });

export const cancelLocalLatex = (jobId: string) =>
  invoke<boolean>('cancel_latex_compile', { jobId });

const decodeBase64 = (value: string) => {
  const decoded = atob(value);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
};

export const saveLocalLatexOutput = async (
  kind: 'pdf' | 'synctex',
  sourceName: string,
  base64: string,
): Promise<boolean> => {
  const stem = sourceName.replace(/\.tex$/i, '') || 'document';
  const extension = kind === 'pdf' ? 'pdf' : 'synctex.gz';
  const path = await save({
    defaultPath: `${stem}.${extension}`,
    filters: [
      { name: kind === 'pdf' ? 'PDF' : 'SyncTeX', extensions: [kind === 'pdf' ? 'pdf' : 'gz'] },
    ],
  });
  if (!path) return false;
  await writeFile(path, decodeBase64(base64));
  return true;
};
