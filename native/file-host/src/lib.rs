//! Shared scoped filesystem host for Nine Rings and File Workbench.
//! Applications provide their own data directory; file rules and IPC stay identical.
mod local_file_transfer;
pub mod local_files;
