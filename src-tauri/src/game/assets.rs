//! Asset index'i (`assets/indexes/<id>.json`) ve nesneleri (`assets/objects/<hh>/<hash>`).

use std::collections::HashSet;
use std::path::Path;

use serde_json::Value;

use super::{AssetIndexRef, FileSpec, RESOURCES};

pub fn index_spec(mc_dir: &Path, r: &AssetIndexRef) -> Option<FileSpec> {
    crate::util::is_safe_name(&r.id).then(|| FileSpec {
        path: mc_dir
            .join("assets")
            .join("indexes")
            .join(format!("{}.json", r.id)),
        url: r.url.clone(),
        sha1: Some(r.sha1.clone()),
        size: r.size,
    })
}

/// Index'teki nesneler (aynı hash bir kez); hash'i 40 haneli hex olmayanlar atlanır.
pub fn objects(mc_dir: &Path, index: &Value) -> Vec<FileSpec> {
    let dir = mc_dir.join("assets").join("objects");
    let mut seen = HashSet::new();
    index
        .get("objects")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .filter_map(|(_, o)| {
            let hash = o.get("hash")?.as_str()?;
            if hash.len() != 40
                || !hash.chars().all(|c| c.is_ascii_hexdigit())
                || !seen.insert(hash)
            {
                return None;
            }
            let prefix = &hash[..2];
            Some(FileSpec {
                path: dir.join(prefix).join(hash),
                url: format!("{RESOURCES}/{prefix}/{hash}"),
                sha1: Some(hash.to_string()),
                size: o.get("size").and_then(Value::as_u64),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn lists_unique_objects() {
        let h = "a".repeat(40);
        let index = json!({"objects": {
            "minecraft/sounds/a.ogg": {"hash": h, "size": 3},
            "minecraft/sounds/b.ogg": {"hash": h, "size": 3},
            "bad": {"hash": "../x", "size": 1}
        }});
        let list = objects(Path::new("/mc"), &index);
        assert_eq!(list.len(), 1);
        assert_eq!(
            list[0].url,
            format!("https://resources.download.minecraft.net/aa/{h}")
        );
        assert!(list[0].path.ends_with(format!("assets/objects/aa/{h}")));
    }
}
