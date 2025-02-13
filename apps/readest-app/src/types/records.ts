export interface DBBook {
  user_id: string;
  book_hash: string;
  format: string;
  title: string;
  author: string;
  group_id?: string;
  group_name?: string;
  tags?: string[];
  progress?: [number, number];

  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
  uploaded_at?: string | null;
}

export interface DBBookConfig {
  user_id: string;
  book_hash: string;
  location?: string;
  progress?: string;
  search_config?: string;
  view_settings?: string;

  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
}

export interface DBBookNote {
  user_id: string;
  book_hash: string;
  id: string;
  type: string;
  cfi: string;
  text?: string;
  style?: string;
  color?: string;
  note: string;

  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
}
