//! Small geometry helpers shared by the board model and the canvas.

use egui::{Pos2, Rect, Vec2};

/// Rectangle spanned by two arbitrary corner points.
pub fn rect_from_points(a: Pos2, b: Pos2) -> Rect {
    Rect::from_two_pos(a, b)
}

/// Shortest distance from `p` to the segment `a`–`b`.
pub fn dist_to_segment(p: Pos2, a: Pos2, b: Pos2) -> f32 {
    let ab = b - a;
    let len_sq = ab.length_sq();
    if len_sq <= f32::EPSILON {
        return p.distance(a);
    }
    let t = ((p - a).dot(ab) / len_sq).clamp(0.0, 1.0);
    p.distance(a + ab * t)
}

/// Point where the ray from the centre of `rect` towards `toward` leaves the rectangle.
pub fn rect_border_point(rect: Rect, toward: Pos2) -> Pos2 {
    let c = rect.center();
    let d = toward - c;
    if d.length_sq() <= f32::EPSILON {
        return c;
    }
    let half = rect.size() / 2.0;
    let tx = if d.x.abs() > f32::EPSILON {
        half.x / d.x.abs()
    } else {
        f32::INFINITY
    };
    let ty = if d.y.abs() > f32::EPSILON {
        half.y / d.y.abs()
    } else {
        f32::INFINITY
    };
    c + d * tx.min(ty)
}

/// Point where the ray from the centre of the ellipse inscribed in `rect` towards `toward` leaves it.
pub fn ellipse_border_point(rect: Rect, toward: Pos2) -> Pos2 {
    let c = rect.center();
    let d = toward - c;
    if d.length_sq() <= f32::EPSILON {
        return c;
    }
    let r = rect.size() / 2.0;
    let k = ((d.x / r.x).powi(2) + (d.y / r.y).powi(2)).sqrt();
    c + d / k
}

/// Whether `p` lies inside the ellipse inscribed in `rect`.
pub fn ellipse_contains(rect: Rect, p: Pos2) -> bool {
    let c = rect.center();
    let r = rect.size() / 2.0;
    if r.x <= 0.0 || r.y <= 0.0 {
        return false;
    }
    let d = p - c;
    (d.x / r.x).powi(2) + (d.y / r.y).powi(2) <= 1.0
}

/// Bounding box of a list of points, or `None` when empty.
pub fn bounds_of(points: &[Pos2]) -> Option<Rect> {
    let mut it = points.iter();
    let first = *it.next()?;
    Some(it.fold(Rect::from_min_max(first, first), |r, p| {
        r.union(Rect::from_min_max(*p, *p))
    }))
}

/// Map `p` from `from` into `to`, preserving its relative position.
pub fn remap(p: Pos2, from: Rect, to: Rect) -> Pos2 {
    let sx = if from.width() > f32::EPSILON {
        to.width() / from.width()
    } else {
        1.0
    };
    let sy = if from.height() > f32::EPSILON {
        to.height() / from.height()
    } else {
        1.0
    };
    to.min + Vec2::new((p.x - from.min.x) * sx, (p.y - from.min.y) * sy)
}

#[cfg(test)]
mod tests {
    use super::*;
    use egui::pos2;

    #[test]
    fn segment_distance() {
        let a = pos2(0.0, 0.0);
        let b = pos2(10.0, 0.0);
        assert_eq!(dist_to_segment(pos2(5.0, 3.0), a, b), 3.0);
        assert_eq!(dist_to_segment(pos2(-4.0, 3.0), a, b), 5.0);
        assert_eq!(dist_to_segment(pos2(1.0, 1.0), a, a), 2f32.sqrt());
    }

    #[test]
    fn rect_border() {
        let r = Rect::from_min_max(pos2(0.0, 0.0), pos2(100.0, 50.0));
        assert_eq!(rect_border_point(r, pos2(200.0, 25.0)), pos2(100.0, 25.0));
        assert_eq!(rect_border_point(r, pos2(50.0, -100.0)), pos2(50.0, 0.0));
    }

    #[test]
    fn ellipse_border_and_contains() {
        let r = Rect::from_min_max(pos2(0.0, 0.0), pos2(100.0, 50.0));
        let p = ellipse_border_point(r, pos2(500.0, 25.0));
        assert!((p.x - 100.0).abs() < 1e-4 && (p.y - 25.0).abs() < 1e-4);
        assert!(ellipse_contains(r, pos2(50.0, 25.0)));
        assert!(!ellipse_contains(r, pos2(2.0, 2.0)));
    }

    #[test]
    fn remap_scales() {
        let from = Rect::from_min_max(pos2(0.0, 0.0), pos2(10.0, 10.0));
        let to = Rect::from_min_max(pos2(100.0, 100.0), pos2(120.0, 140.0));
        assert_eq!(remap(pos2(5.0, 5.0), from, to), pos2(110.0, 120.0));
    }
}
