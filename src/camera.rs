//! Mapping between world (board) coordinates and screen coordinates.

use egui::{Pos2, Rect, Vec2, vec2};

pub const MIN_ZOOM: f32 = 0.05;
pub const MAX_ZOOM: f32 = 8.0;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Camera {
    /// Screen position of the world origin.
    pub pan: Vec2,
    pub zoom: f32,
}

impl Default for Camera {
    fn default() -> Self {
        Self {
            pan: vec2(80.0, 80.0),
            zoom: 1.0,
        }
    }
}

impl Camera {
    pub fn to_screen(&self, p: Pos2) -> Pos2 {
        (p.to_vec2() * self.zoom + self.pan).to_pos2()
    }

    pub fn to_world(&self, p: Pos2) -> Pos2 {
        ((p.to_vec2() - self.pan) / self.zoom).to_pos2()
    }

    pub fn rect_to_screen(&self, r: Rect) -> Rect {
        Rect::from_min_max(self.to_screen(r.min), self.to_screen(r.max))
    }

    pub fn rect_to_world(&self, r: Rect) -> Rect {
        Rect::from_min_max(self.to_world(r.min), self.to_world(r.max))
    }

    /// Multiplies the zoom by `factor`, keeping the world point under `anchor` fixed on screen.
    pub fn zoom_at(&mut self, anchor: Pos2, factor: f32) {
        let world = self.to_world(anchor);
        self.zoom = (self.zoom * factor).clamp(MIN_ZOOM, MAX_ZOOM);
        self.pan = anchor.to_vec2() - world.to_vec2() * self.zoom;
    }

    /// Centres `world` in `viewport`, zoomed to fit with a margin (never above 100%).
    pub fn fit(&mut self, world: Rect, viewport: Rect) {
        let margin = 60.0;
        let avail = (viewport.size() - Vec2::splat(2.0 * margin)).max(Vec2::splat(1.0));
        let size = world.size().max(Vec2::splat(1.0));
        self.zoom = (avail.x / size.x)
            .min(avail.y / size.y)
            .clamp(MIN_ZOOM, 1.0);
        self.center_on(world.center(), viewport);
    }

    pub fn center_on(&mut self, world: Pos2, viewport: Rect) {
        self.pan = viewport.center().to_vec2() - world.to_vec2() * self.zoom;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use egui::pos2;

    #[test]
    fn round_trip() {
        let c = Camera {
            pan: vec2(10.0, -20.0),
            zoom: 2.5,
        };
        let p = pos2(123.0, -45.0);
        let back = c.to_world(c.to_screen(p));
        assert!((back - p).length() < 1e-3);
    }

    #[test]
    fn zoom_keeps_anchor_fixed() {
        let mut c = Camera::default();
        let anchor = pos2(300.0, 200.0);
        let before = c.to_world(anchor);
        c.zoom_at(anchor, 3.0);
        assert!((c.to_world(anchor) - before).length() < 1e-3);
        assert_eq!(c.zoom, 3.0);
        c.zoom_at(anchor, 1000.0);
        assert_eq!(c.zoom, MAX_ZOOM);
    }

    #[test]
    fn fit_centres_content() {
        let mut c = Camera::default();
        let world = Rect::from_min_max(pos2(1000.0, 1000.0), pos2(1200.0, 1100.0));
        let viewport = Rect::from_min_max(pos2(0.0, 0.0), pos2(800.0, 600.0));
        c.fit(world, viewport);
        assert_eq!(c.zoom, 1.0);
        assert!((c.to_screen(world.center()) - viewport.center()).length() < 1e-3);
    }
}
