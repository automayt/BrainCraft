//! The board document: items, connectors and the operations on them.
//!
//! Everything here is plain data in world coordinates, independent of the UI,
//! so it can be saved, loaded and tested headlessly.

use std::collections::BTreeSet;

use egui::{Color32, Pos2, Rect, Vec2, pos2, vec2};
use serde::{Deserialize, Serialize};

use crate::geom;

pub type Id = u64;

/// File format version written into saved boards.
pub const FORMAT_VERSION: u32 = 1;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Kind {
    Sticky,
    Rect,
    Ellipse,
    Text,
    Frame,
    Pen,
}

impl Kind {
    pub fn label(self) -> &'static str {
        match self {
            Kind::Sticky => "Sticky note",
            Kind::Rect => "Rectangle",
            Kind::Ellipse => "Ellipse",
            Kind::Text => "Text",
            Kind::Frame => "Frame",
            Kind::Pen => "Drawing",
        }
    }

    /// Size used when an item is placed with a single click.
    pub fn default_size(self) -> Vec2 {
        match self {
            Kind::Sticky => vec2(200.0, 200.0),
            Kind::Rect => vec2(220.0, 140.0),
            Kind::Ellipse => vec2(180.0, 180.0),
            Kind::Text => vec2(260.0, 48.0),
            Kind::Frame => vec2(800.0, 600.0),
            Kind::Pen => vec2(1.0, 1.0),
        }
    }

    pub fn default_color(self) -> Color32 {
        match self {
            Kind::Sticky => palette::FILLS[0].1,
            Kind::Rect | Kind::Ellipse => palette::FILLS[6].1,
            Kind::Frame => Color32::WHITE,
            Kind::Text | Kind::Pen => palette::INKS[0].1,
        }
    }

    pub fn default_font_size(self) -> f32 {
        match self {
            Kind::Text => 28.0,
            Kind::Frame => 18.0,
            _ => 22.0,
        }
    }

    /// Whether the item's colour is an ink (text/stroke) colour rather than a fill.
    pub fn uses_ink(self) -> bool {
        matches!(self, Kind::Text | Kind::Pen)
    }

    /// Whether the item carries editable text.
    pub fn has_text(self) -> bool {
        !matches!(self, Kind::Pen)
    }
}

pub mod palette {
    use egui::Color32;

    /// Fill colours for sticky notes, shapes and frames.
    pub const FILLS: [(&str, Color32); 10] = [
        ("Yellow", Color32::from_rgb(255, 249, 177)),
        ("Orange", Color32::from_rgb(255, 205, 130)),
        ("Red", Color32::from_rgb(255, 170, 165)),
        ("Pink", Color32::from_rgb(246, 185, 230)),
        ("Violet", Color32::from_rgb(205, 188, 255)),
        ("Blue", Color32::from_rgb(170, 210, 250)),
        ("Cyan", Color32::from_rgb(170, 235, 232)),
        ("Green", Color32::from_rgb(205, 235, 165)),
        ("Gray", Color32::from_rgb(226, 226, 230)),
        ("White", Color32::WHITE),
    ];

    /// Ink colours for text, drawings and connectors.
    pub const INKS: [(&str, Color32); 7] = [
        ("Black", Color32::from_rgb(30, 30, 36)),
        ("Gray", Color32::from_rgb(120, 120, 130)),
        ("Red", Color32::from_rgb(220, 50, 50)),
        ("Orange", Color32::from_rgb(232, 120, 20)),
        ("Green", Color32::from_rgb(30, 150, 70)),
        ("Blue", Color32::from_rgb(40, 100, 220)),
        ("Purple", Color32::from_rgb(130, 60, 200)),
    ];

    pub const TEXT_ON_FILL: Color32 = Color32::from_rgb(30, 30, 36);
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Item {
    pub id: Id,
    pub kind: Kind,
    pub rect: Rect,
    pub color: Color32,
    #[serde(default)]
    pub text: String,
    #[serde(default = "default_font_size")]
    pub font_size: f32,
    /// Stroke points for [`Kind::Pen`] items, in world coordinates.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub points: Vec<Pos2>,
    #[serde(default = "default_stroke_width")]
    pub stroke_width: f32,
}

fn default_font_size() -> f32 {
    22.0
}

fn default_stroke_width() -> f32 {
    4.0
}

impl Item {
    pub fn new(kind: Kind, rect: Rect) -> Self {
        Self {
            id: 0,
            kind,
            rect,
            color: kind.default_color(),
            text: String::new(),
            font_size: kind.default_font_size(),
            points: Vec::new(),
            stroke_width: default_stroke_width(),
        }
    }

    /// A freehand drawing through `points`.
    pub fn pen(points: Vec<Pos2>, color: Color32, stroke_width: f32) -> Self {
        let rect = geom::bounds_of(&points)
            .unwrap_or(Rect::NOTHING)
            .expand(stroke_width / 2.0);
        Self {
            color,
            points,
            stroke_width,
            ..Self::new(Kind::Pen, rect)
        }
    }

    /// Whether the world point `p` hits this item. `tolerance` is in world units.
    pub fn hit(&self, p: Pos2, tolerance: f32) -> bool {
        match self.kind {
            Kind::Ellipse => geom::ellipse_contains(self.rect.expand(tolerance), p),
            Kind::Pen => {
                let reach = self.stroke_width / 2.0 + tolerance;
                if !self.rect.expand(reach).contains(p) {
                    return false;
                }
                match self.points.as_slice() {
                    [] => false,
                    [only] => only.distance(p) <= reach,
                    pts => pts
                        .windows(2)
                        .any(|w| geom::dist_to_segment(p, w[0], w[1]) <= reach),
                }
            }
            _ => self.rect.expand(tolerance).contains(p),
        }
    }

    /// Where a connector aimed at `toward` should attach to this item.
    pub fn anchor_towards(&self, toward: Pos2) -> Pos2 {
        match self.kind {
            Kind::Ellipse => geom::ellipse_border_point(self.rect, toward),
            _ => geom::rect_border_point(self.rect, toward),
        }
    }

    pub fn translate(&mut self, delta: Vec2) {
        self.rect = self.rect.translate(delta);
        for p in &mut self.points {
            *p += delta;
        }
    }

    pub fn set_rect(&mut self, rect: Rect) {
        let old = self.rect;
        for p in &mut self.points {
            *p = geom::remap(*p, old, rect);
        }
        self.rect = rect;
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Connector {
    pub id: Id,
    pub from: Id,
    pub to: Id,
    pub color: Color32,
}

impl Connector {
    pub fn new(from: Id, to: Id) -> Self {
        Self {
            id: 0,
            from,
            to,
            color: palette::INKS[1].1,
        }
    }
}

/// What a point on the board hits.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Hit {
    Item(Id),
    Connector(Id),
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Board {
    #[serde(default)]
    pub version: u32,
    /// Items in paint order: later items are drawn on top.
    pub items: Vec<Item>,
    pub connectors: Vec<Connector>,
    pub next_id: Id,
}

impl Default for Board {
    fn default() -> Self {
        Self {
            version: FORMAT_VERSION,
            items: Vec::new(),
            connectors: Vec::new(),
            next_id: 1,
        }
    }
}

impl Board {
    fn alloc_id(&mut self) -> Id {
        let id = self.next_id;
        self.next_id += 1;
        id
    }

    /// Adds an item on top of everything else and returns its new id.
    pub fn add_item(&mut self, mut item: Item) -> Id {
        item.id = self.alloc_id();
        let id = item.id;
        self.items.push(item);
        id
    }

    /// Connects two distinct, existing items. Returns `None` for a self-loop,
    /// a missing endpoint, or a duplicate of an existing connector.
    pub fn connect(&mut self, from: Id, to: Id) -> Option<Id> {
        if from == to || self.item(from).is_none() || self.item(to).is_none() {
            return None;
        }
        if self.connectors.iter().any(|c| c.from == from && c.to == to) {
            return None;
        }
        let mut c = Connector::new(from, to);
        c.id = self.alloc_id();
        let id = c.id;
        self.connectors.push(c);
        Some(id)
    }

    pub fn item(&self, id: Id) -> Option<&Item> {
        self.items.iter().find(|i| i.id == id)
    }

    pub fn item_mut(&mut self, id: Id) -> Option<&mut Item> {
        self.items.iter_mut().find(|i| i.id == id)
    }

    pub fn connector(&self, id: Id) -> Option<&Connector> {
        self.connectors.iter().find(|c| c.id == id)
    }

    pub fn connector_mut(&mut self, id: Id) -> Option<&mut Connector> {
        self.connectors.iter_mut().find(|c| c.id == id)
    }

    /// End points of a connector in world space, clipped to its items' outlines.
    pub fn connector_endpoints(&self, c: &Connector) -> Option<(Pos2, Pos2)> {
        let a = self.item(c.from)?;
        let b = self.item(c.to)?;
        Some((
            a.anchor_towards(b.rect.center()),
            b.anchor_towards(a.rect.center()),
        ))
    }

    /// Removes the given items and connectors, plus any connector left dangling.
    pub fn remove(&mut self, items: &BTreeSet<Id>, connectors: &BTreeSet<Id>) {
        self.items.retain(|i| !items.contains(&i.id));
        self.connectors.retain(|c| {
            !connectors.contains(&c.id) && !items.contains(&c.from) && !items.contains(&c.to)
        });
    }

    /// Topmost thing under `p`. Frames sit beneath everything else, so they are
    /// only hit where nothing else is.
    pub fn hit_test(&self, p: Pos2, tolerance: f32) -> Option<Hit> {
        if let Some(i) = self
            .items
            .iter()
            .rev()
            .find(|i| i.kind != Kind::Frame && i.hit(p, tolerance))
        {
            return Some(Hit::Item(i.id));
        }
        if let Some(c) = self.connectors.iter().rev().find(|c| {
            self.connector_endpoints(c)
                .is_some_and(|(a, b)| geom::dist_to_segment(p, a, b) <= tolerance + 3.0)
        }) {
            return Some(Hit::Connector(c.id));
        }
        self.items
            .iter()
            .rev()
            .find(|i| {
                i.kind == Kind::Frame && (i.hit(p, tolerance) || frame_title_rect(i).contains(p))
            })
            .map(|i| Hit::Item(i.id))
    }

    /// Items whose bounds lie entirely within `area`.
    pub fn items_within(&self, area: Rect) -> BTreeSet<Id> {
        self.items
            .iter()
            .filter(|i| area.contains_rect(i.rect))
            .map(|i| i.id)
            .collect()
    }

    /// `ids` plus everything inside any frame among them, so frames carry their contents.
    pub fn with_frame_contents(&self, ids: &BTreeSet<Id>) -> BTreeSet<Id> {
        let mut out = ids.clone();
        for frame in self
            .items
            .iter()
            .filter(|i| i.kind == Kind::Frame && ids.contains(&i.id))
        {
            out.extend(self.items_within(frame.rect));
        }
        out
    }

    pub fn translate(&mut self, ids: &BTreeSet<Id>, delta: Vec2) {
        for item in self.items.iter_mut().filter(|i| ids.contains(&i.id)) {
            item.translate(delta);
        }
    }

    /// Union of the bounds of the given items, or of all items when `ids` is `None`.
    pub fn bounds(&self, ids: Option<&BTreeSet<Id>>) -> Option<Rect> {
        self.items
            .iter()
            .filter(|i| ids.is_none_or(|s| s.contains(&i.id)))
            .map(|i| match i.kind {
                Kind::Frame => i.rect.union(frame_title_rect(i)),
                _ => i.rect,
            })
            .reduce(|a, b| a.union(b))
    }

    pub fn bring_to_front(&mut self, ids: &BTreeSet<Id>) {
        let (picked, rest): (Vec<_>, Vec<_>) =
            self.items.drain(..).partition(|i| ids.contains(&i.id));
        self.items = rest;
        self.items.extend(picked);
    }

    pub fn send_to_back(&mut self, ids: &BTreeSet<Id>) {
        let (mut picked, rest): (Vec<_>, Vec<_>) =
            self.items.drain(..).partition(|i| ids.contains(&i.id));
        picked.extend(rest);
        self.items = picked;
    }

    /// Copies the given items (and connectors between them), placed at `offset`.
    /// Returns the ids of the new items.
    pub fn paste(
        &mut self,
        items: &[Item],
        connectors: &[Connector],
        offset: Vec2,
    ) -> BTreeSet<Id> {
        let mut mapping = std::collections::HashMap::new();
        let mut new_ids = BTreeSet::new();
        for item in items {
            let mut copy = item.clone();
            copy.translate(offset);
            let id = self.add_item(copy);
            mapping.insert(item.id, id);
            new_ids.insert(id);
        }
        for c in connectors {
            if let (Some(&from), Some(&to)) = (mapping.get(&c.from), mapping.get(&c.to))
                && let Some(id) = self.connect(from, to)
                && let Some(new) = self.connector_mut(id)
            {
                new.color = c.color;
            }
        }
        new_ids
    }

    /// The given items and the connectors that run between two of them,
    /// in paint order, ready for [`Board::paste`].
    pub fn copy(&self, ids: &BTreeSet<Id>) -> (Vec<Item>, Vec<Connector>) {
        let items = self
            .items
            .iter()
            .filter(|i| ids.contains(&i.id))
            .cloned()
            .collect();
        let connectors = self
            .connectors
            .iter()
            .filter(|c| ids.contains(&c.from) && ids.contains(&c.to))
            .cloned()
            .collect();
        (items, connectors)
    }

    pub fn duplicate(&mut self, ids: &BTreeSet<Id>, offset: Vec2) -> BTreeSet<Id> {
        let (items, connectors) = self.copy(ids);
        self.paste(&items, &connectors, offset)
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).expect("board serialises")
    }

    pub fn from_json(json: &str) -> Result<Self, serde_json::Error> {
        let mut board: Board = serde_json::from_str(json)?;
        // Never hand out an id that is already taken, whatever the file says.
        let max_id = board
            .items
            .iter()
            .map(|i| i.id)
            .chain(board.connectors.iter().map(|c| c.id))
            .max()
            .unwrap_or(0);
        board.next_id = board.next_id.max(max_id + 1);
        board.version = FORMAT_VERSION;
        Ok(board)
    }

    /// The board shown on first launch.
    pub fn welcome() -> Self {
        let mut b = Board::default();
        let mut frame = Item::new(
            Kind::Frame,
            Rect::from_min_size(pos2(-60.0, -40.0), vec2(1180.0, 640.0)),
        );
        frame.text = "Welcome to BrainCraft".into();
        b.add_item(frame);

        let mut title = Item::new(
            Kind::Text,
            Rect::from_min_size(pos2(0.0, 0.0), vec2(700.0, 48.0)),
        );
        title.text = "Brainstorm on an infinite canvas".into();
        title.font_size = 34.0;
        b.add_item(title);

        let notes = [
            ("Pick a tool on the left, or press N for a sticky note", 0),
            ("Double-click anything to edit its text", 5),
            ("Drag the blue dot to connect ideas", 7),
            ("Scroll to pan, Ctrl + scroll to zoom", 3),
        ];
        let mut ids = Vec::new();
        for (n, (text, color)) in notes.iter().enumerate() {
            let mut s = Item::new(
                Kind::Sticky,
                Rect::from_min_size(pos2(n as f32 * 260.0, 110.0), vec2(220.0, 220.0)),
            );
            s.text = (*text).into();
            s.color = palette::FILLS[*color].1;
            ids.push(b.add_item(s));
        }
        for w in ids.windows(2) {
            b.connect(w[0], w[1]);
        }

        let mut idea = Item::new(
            Kind::Ellipse,
            Rect::from_min_size(pos2(380.0, 400.0), vec2(260.0, 150.0)),
        );
        idea.text = "Your next big idea".into();
        idea.color = palette::FILLS[4].1;
        let idea = b.add_item(idea);
        b.connect(ids[1], idea);
        b
    }
}

/// The clickable title strip drawn above a frame, in world units.
pub fn frame_title_rect(frame: &Item) -> Rect {
    let h = frame.font_size * 1.6;
    Rect::from_min_max(
        pos2(frame.rect.min.x, frame.rect.min.y - h),
        pos2(frame.rect.max.x, frame.rect.min.y),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sticky_at(x: f32, y: f32) -> Item {
        Item::new(
            Kind::Sticky,
            Rect::from_min_size(pos2(x, y), vec2(100.0, 100.0)),
        )
    }

    fn set(ids: &[Id]) -> BTreeSet<Id> {
        ids.iter().copied().collect()
    }

    #[test]
    fn ids_are_unique_and_increasing() {
        let mut b = Board::default();
        let a = b.add_item(sticky_at(0.0, 0.0));
        let c = b.add_item(sticky_at(200.0, 0.0));
        let k = b.connect(a, c).unwrap();
        assert!(a < c && c < k);
    }

    #[test]
    fn connect_rejects_bad_links() {
        let mut b = Board::default();
        let a = b.add_item(sticky_at(0.0, 0.0));
        let c = b.add_item(sticky_at(200.0, 0.0));
        assert!(b.connect(a, a).is_none());
        assert!(b.connect(a, 999).is_none());
        assert!(b.connect(a, c).is_some());
        assert!(b.connect(a, c).is_none(), "duplicate");
    }

    #[test]
    fn removing_items_drops_their_connectors() {
        let mut b = Board::default();
        let a = b.add_item(sticky_at(0.0, 0.0));
        let c = b.add_item(sticky_at(200.0, 0.0));
        let d = b.add_item(sticky_at(400.0, 0.0));
        b.connect(a, c);
        b.connect(c, d);
        b.remove(&set(&[a]), &BTreeSet::new());
        assert_eq!(b.items.len(), 2);
        assert_eq!(b.connectors.len(), 1);
        assert_eq!(b.connectors[0].from, c);
    }

    #[test]
    fn hit_test_prefers_top_item_and_puts_frames_last() {
        let mut b = Board::default();
        let frame = b.add_item(Item::new(
            Kind::Frame,
            Rect::from_min_size(pos2(-50.0, -50.0), vec2(500.0, 500.0)),
        ));
        let low = b.add_item(sticky_at(0.0, 0.0));
        let high = b.add_item(sticky_at(50.0, 50.0));
        assert_eq!(b.hit_test(pos2(75.0, 75.0), 0.0), Some(Hit::Item(high)));
        assert_eq!(b.hit_test(pos2(10.0, 10.0), 0.0), Some(Hit::Item(low)));
        assert_eq!(b.hit_test(pos2(300.0, 300.0), 0.0), Some(Hit::Item(frame)));
        assert_eq!(
            b.hit_test(pos2(0.0, -60.0), 0.0),
            Some(Hit::Item(frame)),
            "frame title"
        );
        assert_eq!(b.hit_test(pos2(1000.0, 0.0), 0.0), None);
        // Moving the frame to the front must not let it cover its contents.
        b.bring_to_front(&set(&[frame]));
        assert_eq!(b.hit_test(pos2(10.0, 10.0), 0.0), Some(Hit::Item(low)));
    }

    #[test]
    fn hit_test_finds_connectors_between_items() {
        let mut b = Board::default();
        let a = b.add_item(sticky_at(0.0, 0.0));
        let c = b.add_item(sticky_at(400.0, 0.0));
        let k = b.connect(a, c).unwrap();
        assert_eq!(b.hit_test(pos2(250.0, 52.0), 0.0), Some(Hit::Connector(k)));
        let (p, q) = b.connector_endpoints(b.connector(k).unwrap()).unwrap();
        assert_eq!(p, pos2(100.0, 50.0));
        assert_eq!(q, pos2(400.0, 50.0));
    }

    #[test]
    fn ellipse_and_pen_hits() {
        let e = Item::new(
            Kind::Ellipse,
            Rect::from_min_size(pos2(0.0, 0.0), vec2(100.0, 100.0)),
        );
        assert!(e.hit(pos2(50.0, 50.0), 0.0));
        assert!(!e.hit(pos2(3.0, 3.0), 0.0));
        let p = Item::pen(vec![pos2(0.0, 0.0), pos2(100.0, 0.0)], Color32::BLACK, 4.0);
        assert!(p.hit(pos2(50.0, 3.0), 2.0));
        assert!(!p.hit(pos2(50.0, 20.0), 2.0));
    }

    #[test]
    fn frames_carry_their_contents() {
        let mut b = Board::default();
        let frame = b.add_item(Item::new(
            Kind::Frame,
            Rect::from_min_size(pos2(0.0, 0.0), vec2(500.0, 500.0)),
        ));
        let inside = b.add_item(sticky_at(10.0, 10.0));
        let outside = b.add_item(sticky_at(600.0, 0.0));
        let moving = b.with_frame_contents(&set(&[frame]));
        assert_eq!(moving, set(&[frame, inside]));
        b.translate(&moving, vec2(10.0, 20.0));
        assert_eq!(b.item(inside).unwrap().rect.min, pos2(20.0, 30.0));
        assert_eq!(b.item(outside).unwrap().rect.min, pos2(600.0, 0.0));
    }

    #[test]
    fn resizing_a_drawing_scales_its_points() {
        let mut p = Item::pen(vec![pos2(0.0, 0.0), pos2(10.0, 10.0)], Color32::BLACK, 0.0);
        p.set_rect(Rect::from_min_size(pos2(0.0, 0.0), vec2(20.0, 40.0)));
        assert_eq!(p.points, vec![pos2(0.0, 0.0), pos2(20.0, 40.0)]);
    }

    #[test]
    fn z_order() {
        let mut b = Board::default();
        let a = b.add_item(sticky_at(0.0, 0.0));
        let c = b.add_item(sticky_at(0.0, 0.0));
        let d = b.add_item(sticky_at(0.0, 0.0));
        b.bring_to_front(&set(&[a]));
        assert_eq!(
            b.items.iter().map(|i| i.id).collect::<Vec<_>>(),
            vec![c, d, a]
        );
        b.send_to_back(&set(&[d]));
        assert_eq!(
            b.items.iter().map(|i| i.id).collect::<Vec<_>>(),
            vec![d, c, a]
        );
    }

    #[test]
    fn duplicate_copies_internal_connectors_only() {
        let mut b = Board::default();
        let a = b.add_item(sticky_at(0.0, 0.0));
        let c = b.add_item(sticky_at(200.0, 0.0));
        let d = b.add_item(sticky_at(400.0, 0.0));
        b.connect(a, c);
        b.connect(c, d);
        let new = b.duplicate(&set(&[a, c]), vec2(0.0, 300.0));
        assert_eq!(new.len(), 2);
        assert_eq!(b.items.len(), 5);
        assert_eq!(b.connectors.len(), 3);
        let copy = b.connectors.last().unwrap();
        assert!(new.contains(&copy.from) && new.contains(&copy.to));
        assert_eq!(b.item(copy.from).unwrap().rect.min, pos2(0.0, 300.0));
    }

    #[test]
    fn json_round_trip_and_id_repair() {
        let b = Board::welcome();
        let loaded = Board::from_json(&b.to_json()).unwrap();
        assert_eq!(loaded, b);

        let mut broken = b.clone();
        broken.next_id = 1;
        let repaired = Board::from_json(&broken.to_json()).unwrap();
        assert_eq!(repaired.next_id, b.next_id);
    }

    #[test]
    fn welcome_board_is_connected() {
        let b = Board::welcome();
        assert!(b.items.len() >= 6);
        for c in &b.connectors {
            assert!(b.connector_endpoints(c).is_some());
        }
    }
}
