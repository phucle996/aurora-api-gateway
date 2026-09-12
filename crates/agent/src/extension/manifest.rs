use crate::spec::extensions::ExtensionInstanceSpec;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::OnceLock;

const CATALOG_JSON: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../control-plane/internal/extensionmanifest/catalog.json"
));

#[derive(Debug, Clone, Deserialize)]
pub struct InstalledManifest {
    pub key: String,
    pub version: u32,
    pub renderer: String,
}

struct Catalog {
    digest: String,
    manifests: HashMap<(String, u32), InstalledManifest>,
}

fn catalog() -> Result<&'static Catalog, String> {
    static CATALOG: OnceLock<Result<Catalog, String>> = OnceLock::new();
    CATALOG
        .get_or_init(|| {
            let manifests: Vec<InstalledManifest> = serde_json::from_str(CATALOG_JSON)
                .map_err(|error| format!("decode packaged extension catalog: {error}"))?;
            let mut indexed = HashMap::with_capacity(manifests.len());
            for manifest in manifests {
                if manifest.key.trim().is_empty()
                    || manifest.version == 0
                    || manifest.renderer.trim().is_empty()
                {
                    return Err(
                        "packaged extension catalog contains an invalid manifest".to_string()
                    );
                }
                let identity = (manifest.key.clone(), manifest.version);
                if indexed.insert(identity.clone(), manifest).is_some() {
                    return Err(format!(
                        "packaged extension catalog contains duplicate {}@{}",
                        identity.0, identity.1
                    ));
                }
            }
            let mut hasher = Sha256::new();
            hasher.update(CATALOG_JSON.as_bytes());
            Ok(Catalog {
                digest: hex::encode(hasher.finalize()),
                manifests: indexed,
            })
        })
        .as_ref()
        .map_err(Clone::clone)
}

pub fn catalog_digest() -> Result<String, String> {
    Ok(catalog()?.digest.clone())
}

pub fn resolve(instance: &ExtensionInstanceSpec) -> Result<InstalledManifest, String> {
    if instance.instance_id.trim().is_empty()
        || instance.key.trim().is_empty()
        || instance.version == 0
        || instance.config_json.trim().is_empty()
    {
        return Err("extension instance envelope is incomplete".to_string());
    }

    let catalog = catalog()?;
    if instance.manifest_digest != catalog.digest {
        return Err(format!(
            "extension instance {} requires catalog digest {}, agent has {}",
            instance.instance_id, instance.manifest_digest, catalog.digest
        ));
    }
    catalog
        .manifests
        .get(&(instance.key.clone(), instance.version))
        .cloned()
        .ok_or_else(|| {
            format!(
                "extension instance {} references unavailable manifest {}@{}",
                instance.instance_id, instance.key, instance.version
            )
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_packaged_manifest_only_when_digest_matches() {
        let digest = catalog_digest().expect("catalog digest");
        let instance = ExtensionInstanceSpec {
            instance_id: "ip-restriction".to_string(),
            key: "builtin/ip-restriction".to_string(),
            version: 1,
            manifest_digest: digest,
            config_json: r#"{"whitelist":[],"blacklist":[],"rules":[]}"#.to_string(),
        };
        assert_eq!(resolve(&instance).unwrap().renderer, "access-policy");
    }
}
