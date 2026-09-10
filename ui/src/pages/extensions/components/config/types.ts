import { ExtensionItem } from '../../types';

export interface SchemaField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'boolean' | 'password' | 'textarea_code' | 'list_string' | 'select' | 'key_value_map';
  description?: string;
  required?: boolean;
  options?: { label: string; value: any }[];
}

export interface ExtensionRenderContext {
  title?: string;
  description?: string;
  layout_type?: 'form' | 'table';
  fields?: SchemaField[];
  table_columns?: { key: string; label: string }[];
  row_fields?: SchemaField[];
}

export interface ExtensionConfigModalProps {
  extension: ExtensionItem | null;
  onClose: () => void;
  onSave: (id: string, configJSON: string) => Promise<boolean>;
  onToggleStatus?: (id: string, enabled: boolean) => void;
}
