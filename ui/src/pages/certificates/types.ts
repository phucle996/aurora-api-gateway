import type { CertificateItem } from '../../lib/api/certificates';

export type { CertificateItem };

export interface CertificateFormState {
  name: string;
  snisInput: string;
  cert_pem: string;
  key_pem: string;
  mtls_enabled: boolean;
  client_ca_pem: string;
  verify_depth: number;
  enabled: boolean;
  description: string;
}

export const DEFAULT_CERTIFICATE_FORM: CertificateFormState = {
  name: '',
  snisInput: '',
  cert_pem: '',
  key_pem: '',
  mtls_enabled: false,
  client_ca_pem: '',
  verify_depth: 1,
  enabled: true,
  description: '',
};
