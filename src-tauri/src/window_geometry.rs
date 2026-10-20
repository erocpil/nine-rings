//! Persist the user's normal main-window size between desktop launches.
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::{LogicalSize, Size, WebviewWindow};

const FILE_NAME: &str = "window-geometry.json";
const MIN_WIDTH: f64 = 800.0;
const MIN_HEIGHT: f64 = 540.0;
const SCREEN_MARGIN: f64 = 24.0;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
struct WindowGeometry {
    width: f64,
    height: f64,
}

impl WindowGeometry {
    fn valid(self) -> bool {
        self.width.is_finite()
            && self.height.is_finite()
            && self.width >= MIN_WIDTH
            && self.height >= MIN_HEIGHT
    }

    fn fit(self, max_width: f64, max_height: f64) -> Self {
        Self {
            width: self.width.clamp(MIN_WIDTH, max_width.max(MIN_WIDTH)),
            height: self.height.clamp(MIN_HEIGHT, max_height.max(MIN_HEIGHT)),
        }
    }
}

fn geometry_path(app_data_dir: &Path) -> std::path::PathBuf {
    app_data_dir.join(FILE_NAME)
}

fn read_geometry(app_data_dir: &Path) -> Option<WindowGeometry> {
    let geometry: WindowGeometry =
        serde_json::from_slice(&std::fs::read(geometry_path(app_data_dir)).ok()?).ok()?;
    geometry.valid().then_some(geometry)
}

fn write_geometry(app_data_dir: &Path, geometry: WindowGeometry) -> std::io::Result<()> {
    if !geometry.valid() {
        return Ok(());
    }
    let path = geometry_path(app_data_dir);
    let temporary = app_data_dir.join(format!("window-geometry-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        use std::io::Write;
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        serde_json::to_writer(&mut file, &geometry).map_err(std::io::Error::other)?;
        file.write_all(b"\n")?;
        file.sync_all()?;
        drop(file);
        replace_file(&temporary, &path)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result
}

#[cfg(not(target_os = "windows"))]
fn replace_file(temporary: &Path, destination: &Path) -> std::io::Result<()> {
    std::fs::rename(temporary, destination)
}

#[cfg(target_os = "windows")]
fn replace_file(temporary: &Path, destination: &Path) -> std::io::Result<()> {
    if destination.exists() {
        std::fs::remove_file(destination)?;
    }
    std::fs::rename(temporary, destination)
}

/// Restore only the normal (non-maximized) size. Tauri's configured 1020×640
/// remains the fallback for first launch or invalid stored data.
pub fn restore(window: &WebviewWindow, app_data_dir: &Path) {
    let Some(geometry) = read_geometry(app_data_dir) else {
        return;
    };
    let scale = window.scale_factor().unwrap_or(1.0).max(0.1);
    let (max_width, max_height) = window
        .current_monitor()
        .ok()
        .flatten()
        .map(|monitor| {
            let work_area = monitor.work_area();
            (
                work_area.size.width as f64 / scale - SCREEN_MARGIN,
                work_area.size.height as f64 / scale - SCREEN_MARGIN,
            )
        })
        .unwrap_or((geometry.width, geometry.height));
    let geometry = geometry.fit(max_width, max_height);
    if let Err(error) = window.set_size(Size::Logical(LogicalSize::new(
        geometry.width,
        geometry.height,
    ))) {
        log::warn!("failed to restore main window size: {error}");
        return;
    }
    if let Err(error) = window.center() {
        log::debug!("failed to center restored main window: {error}");
    }
    log::info!(
        "restored main window size: {:.0}×{:.0} logical px",
        geometry.width,
        geometry.height
    );
}

/// Save ordinary resizes, but never replace the normal size with temporary
/// maximized, fullscreen, or full-height presentation geometry.
pub fn save_if_normal(window: &WebviewWindow, app_data_dir: &Path) {
    if window.is_fullscreen().unwrap_or(true)
        || window.is_minimized().unwrap_or(false)
        || window.is_maximized().unwrap_or(false)
    {
        return;
    }
    #[cfg(target_os = "macos")]
    if crate::macos_window::is_temporarily_expanded(window).unwrap_or(true) {
        return;
    }

    let scale = window.scale_factor().unwrap_or(1.0).max(0.1);
    let Ok(size) = window.inner_size() else {
        return;
    };
    let geometry = WindowGeometry {
        width: size.width as f64 / scale,
        height: size.height as f64 / scale,
    };
    if geometry.valid() {
        if let Err(error) = write_geometry(app_data_dir, geometry) {
            log::warn!("failed to persist main window size: {error}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stores_and_restores_a_valid_window_size() {
        let directory = std::env::temp_dir().join(format!("nr-window-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let geometry = WindowGeometry {
            width: 1360.0,
            height: 880.0,
        };
        write_geometry(&directory, geometry).unwrap();
        assert_eq!(read_geometry(&directory), Some(geometry));
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn rejects_invalid_sizes_and_clamps_to_available_work_area() {
        assert!(!WindowGeometry {
            width: f64::NAN,
            height: 640.0,
        }
        .valid());
        assert!(!WindowGeometry {
            width: 799.0,
            height: 640.0,
        }
        .valid());
        assert_eq!(
            WindowGeometry {
                width: 1800.0,
                height: 1000.0,
            }
            .fit(1400.0, 900.0),
            WindowGeometry {
                width: 1400.0,
                height: 900.0,
            }
        );
    }
}
