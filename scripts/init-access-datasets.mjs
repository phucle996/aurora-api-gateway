// Script nạp dataset GeoIP & ASN thực tế vào Aurora WAF
const CONTROLLER_URL = process.env.CONTROLLER_URL || 'http://localhost:8080';
const TOKEN = process.env.AUTH_TOKEN || '71b268cadc82c2ecfff176c7dfd5c4ac77a0e6a3cd0ae3a7d87b1b9bb686b994';

const sampleDataset = {
  name: 'Global GeoIP & ASN Directory',
  networks: [
    // Vietnam (VN) - VNPT & Viettel
    { cidr: '14.160.0.0/11', country: 'VN', asn: 'AS45899' },
    { cidr: '27.64.0.0/12', country: 'VN', asn: 'AS7552' },
    { cidr: '113.160.0.0/11', country: 'VN', asn: 'AS45899' },
    { cidr: '171.224.0.0/11', country: 'VN', asn: 'AS7552' },
    { cidr: '1.52.0.0/14', country: 'VN', asn: 'AS45899' },

    // United States (US) - Cloudflare & Google
    { cidr: '104.16.0.0/12', country: 'US', asn: 'AS13335' },
    { cidr: '162.158.0.0/15', country: 'US', asn: 'AS13335' },
    { cidr: '172.64.0.0/13', country: 'US', asn: 'AS13335' },
    { cidr: '8.8.8.0/24', country: 'US', asn: 'AS15169' },
    { cidr: '8.8.4.0/24', country: 'US', asn: 'AS15169' },
    { cidr: '142.250.0.0/15', country: 'US', asn: 'AS15169' },

    // Japan (JP) - KDDI, NTT, Sakura
    { cidr: '133.0.0.0/10', country: 'JP', asn: 'AS2516' },
    { cidr: '153.120.0.0/13', country: 'JP', asn: 'AS4713' },
    { cidr: '163.43.0.0/16', country: 'JP', asn: 'AS9370' },
  ],
};

async function main() {
  console.log(`Connecting to controller at ${CONTROLLER_URL}...`);
  
  // 1. Fetch current status to get release_id
  const statusRes = await fetch(`${CONTROLLER_URL}/api/v1/access/status`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!statusRes.ok) {
    throw new Error(`Failed to fetch status: ${statusRes.status} ${await statusRes.text()}`);
  }
  const status = await statusRes.json();
  console.log(`Current active release: #${status.release_id}`);

  // 2. Check if dataset already exists
  const listRes = await fetch(`${CONTROLLER_URL}/api/v1/access`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!listRes.ok) {
    throw new Error(`Failed to list objects: ${listRes.status} ${await listRes.text()}`);
  }
  const objects = await listRes.json();
  const existing = objects.find(o => o.kind === 'dataset' && o.document?.name === sampleDataset.name);

  const command = {
    id: existing ? existing.id : 0,
    kind: 'dataset',
    expected_version: existing ? existing.version : 0,
    expected_release: status.release_id,
    delete: false,
    document: sampleDataset,
  };

  console.log(existing ? `Updating existing dataset (id: ${existing.id})...` : 'Creating new dataset...');
  const changeRes = await fetch(`${CONTROLLER_URL}/api/v1/access/changes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
      'Idempotency-Key': `init-dataset-${Date.now()}`,
    },
    body: JSON.stringify(command),
  });

  if (!changeRes.ok) {
    throw new Error(`Failed to apply dataset: ${changeRes.status} ${await changeRes.text()}`);
  }
  const result = await changeRes.json();
  console.log(`Dataset successfully applied! Object ID: ${result.id}, Version: ${result.version}, New Release: #${result.release_id}`);

  // 3. Verify catalog
  const catRes = await fetch(`${CONTROLLER_URL}/api/v1/access/catalog`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (catRes.ok) {
    const catalog = await catRes.json();
    console.log('Updated Catalog:', JSON.stringify(catalog, null, 2));
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
