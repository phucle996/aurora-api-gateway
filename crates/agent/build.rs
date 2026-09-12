fn main() -> Result<(), Box<dyn std::error::Error>> {
    if std::env::var("PROTOC").is_err()
        && let Ok(home) = std::env::var("HOME")
    {
        let user_protoc = format!("{}/.local/bin/protoc", home);
        if std::path::Path::new(&user_protoc).exists() {
            // Set PROTOC for tonic_build
            unsafe {
                std::env::set_var("PROTOC", &user_protoc);
            }
        }
    }

    println!("cargo:rerun-if-changed=../../proto/sync/v1");
    // The catalog is shared with the Go controller and embedded by
    // extension::manifest. Cargo cannot infer this dynamically assembled path,
    // so declare it explicitly to prevent a stale agent catalog digest.
    println!("cargo:rerun-if-changed=../../control-plane/internal/extensionmanifest/catalog.json");
    println!("cargo:rerun-if-changed=build.rs");

    tonic_build::configure()
        .build_server(false)
        .compile_protos(
            &[
                "../../proto/sync/v1/heartbeat.proto",
                "../../proto/sync/v1/spec.proto",
            ],
            &["../../proto"],
        )?;
    Ok(())
}
