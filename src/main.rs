#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() -> eframe::Result {
    let path = std::env::args_os().nth(1).map(std::path::PathBuf::from);
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_title("BrainCraft")
            .with_inner_size([1400.0, 900.0])
            .with_min_inner_size([640.0, 420.0]),
        // Set BRAINCRAFT_RENDERER=glow to use OpenGL where wgpu has no adapter.
        renderer: match std::env::var("BRAINCRAFT_RENDERER").as_deref() {
            Ok("glow") => eframe::Renderer::Glow,
            _ => eframe::Renderer::default(),
        },
        ..Default::default()
    };
    eframe::run_native(
        "BrainCraft",
        options,
        Box::new(|cc| Ok(Box::new(braincraft::BrainCraftApp::new(cc, path)))),
    )
}
