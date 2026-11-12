use std::{env, path::PathBuf, process::Command};
fn git(args: &[&str]) -> Option<String> {
    let output = Command::new("git")
        .current_dir(env::var_os("CARGO_MANIFEST_DIR")?)
        .args(args)
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_owned())
}
fn main() {
    let commit = git(&["rev-parse", "HEAD"]).unwrap_or_else(|| "unknown".into());
    println!("cargo:rustc-env=WORKBENCH_GIT_COMMIT={commit}");
    for name in [
        Some("HEAD".to_owned()),
        Some("index".to_owned()),
        Some("packed-refs".to_owned()),
        git(&["symbolic-ref", "-q", "HEAD"]),
    ]
    .into_iter()
    .flatten()
    {
        if let Some(path) = git(&["rev-parse", "--path-format=absolute", "--git-path", &name]) {
            println!("cargo:rerun-if-changed={path}");
        }
    }
    if let Some(root) = git(&["rev-parse", "--show-toplevel"]) {
        println!(
            "cargo:rerun-if-changed={}",
            PathBuf::from(root).join("src").display()
        );
    }
    let dirty = git(&["status", "--porcelain", "--untracked-files=no"])
        .is_some_and(|status| !status.is_empty());
    println!("cargo:rustc-env=WORKBENCH_GIT_DIRTY={dirty}");
    tauri_build::build()
}
