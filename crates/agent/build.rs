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
