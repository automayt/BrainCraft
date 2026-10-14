//! The BrainCraft window: toolbars, the infinite canvas and its interactions.

use std::collections::BTreeSet;
use std::path::PathBuf;

use egui::{
    Align2, Color32, CornerRadius, CursorIcon, FontId, Key, KeyboardShortcut, Modifiers,
    PointerButton, Pos2, Rect, Sense, Shape, Stroke, StrokeKind, Vec2, pos2, vec2,
};

use crate::board::{Board, Connector, Hit, Id, Item, Kind, frame_title_rect, palette};
use crate::camera::Camera;
use crate::history::History;

const ACCENT: Color32 = Color32::from_rgb(66, 98, 255);
const CANVAS_BG: Color32 = Color32::from_rgb(245, 245, 247);
const GRID_DOT: Color32 = Color32::from_rgb(208, 208, 214);
const HANDLE: f32 = 8.0;
const CONNECT_HANDLE_GAP: f32 = 18.0;
const TEXT_PAD: f32 = 14.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tool {
    Select,
    Hand,
    Sticky,
    Rect,
    Ellipse,
    Text,
    Frame,
    Connector,
    Pen,
}

impl Tool {
    const ALL: [Tool; 9] = [
        Tool::Select,
        Tool::Hand,
        Tool::Sticky,
        Tool::Text,
        Tool::Rect,
        Tool::Ellipse,
        Tool::Connector,
        Tool::Pen,
        Tool::Frame,
    ];

    fn icon(self) -> &'static str {
        match self {
            Tool::Select => "⬉",
            Tool::Hand => "✋",
            Tool::Sticky => "", // painted, see `tool_bar`
            Tool::Rect => "⬜",
            Tool::Ellipse => "⭕",
            Tool::Text => "T",
            Tool::Frame => "⛶",
            Tool::Connector => "↗",
            Tool::Pen => "✏",
        }
    }

    fn name(self) -> &'static str {
        match self {
            Tool::Select => "Select",
            Tool::Hand => "Hand",
            Tool::Sticky => "Sticky note",
            Tool::Rect => "Rectangle",
            Tool::Ellipse => "Ellipse",
            Tool::Text => "Text",
            Tool::Frame => "Frame",
            Tool::Connector => "Connector",
            Tool::Pen => "Pen",
        }
    }

    fn key(self) -> Key {
        match self {
            Tool::Select => Key::V,
            Tool::Hand => Key::H,
            Tool::Sticky => Key::N,
            Tool::Rect => Key::R,
            Tool::Ellipse => Key::O,
            Tool::Text => Key::T,
            Tool::Frame => Key::F,
            Tool::Connector => Key::L,
            Tool::Pen => Key::P,
        }
    }

    /// The kind of item this tool places, if it is a creation tool.
    fn creates(self) -> Option<Kind> {
        match self {
            Tool::Sticky => Some(Kind::Sticky),
            Tool::Rect => Some(Kind::Rect),
            Tool::Ellipse => Some(Kind::Ellipse),
            Tool::Text => Some(Kind::Text),
            Tool::Frame => Some(Kind::Frame),
            _ => None,
        }
    }
}

/// A corner of the selection box, used for resizing.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Corner {
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
}

impl Corner {
    const ALL: [Corner; 4] = [
        Corner::TopLeft,
        Corner::TopRight,
        Corner::BottomLeft,
        Corner::BottomRight,
    ];

    fn of(self, r: Rect) -> Pos2 {
        match self {
            Corner::TopLeft => r.left_top(),
            Corner::TopRight => r.right_top(),
            Corner::BottomLeft => r.left_bottom(),
            Corner::BottomRight => r.right_bottom(),
        }
    }

    fn opposite(self) -> Corner {
        match self {
            Corner::TopLeft => Corner::BottomRight,
            Corner::TopRight => Corner::BottomLeft,
            Corner::BottomLeft => Corner::TopRight,
            Corner::BottomRight => Corner::TopLeft,
        }
    }

    fn cursor(self) -> CursorIcon {
        match self {
            Corner::TopLeft | Corner::BottomRight => CursorIcon::ResizeNwSe,
            Corner::TopRight | Corner::BottomLeft => CursorIcon::ResizeNeSw,
        }
    }
}

/// An in-progress pointer gesture on the canvas. Gestures that edit the board
/// carry the board as it was when they started, for the undo history.
enum Drag {
    None,
    Pan,
    Move {
        ids: BTreeSet<Id>,
        last: Pos2,
        before: Board,
    },
    Resize {
        id: Id,
        anchor: Pos2,
        before: Board,
    },
    Marquee {
        start: Pos2,
        additive: bool,
    },
    Create {
        kind: Kind,
        start: Pos2,
    },
    Draw {
        points: Vec<Pos2>,
    },
    Connect {
        from: Id,
    },
}

enum ConnectTarget {
    Item(Id),
    Empty,
    Nothing,
}

/// Text editing in progress on one item.
struct Editing {
    id: Id,
    before: Board,
    focus_requested: bool,
}

pub struct BrainCraftApp {
    board: Board,
    history: History,
    camera: Camera,
    tool: Tool,
    selection: BTreeSet<Id>,
    selected_connector: Option<Id>,
    drag: Drag,
    editing: Option<Editing>,
    clipboard: (Vec<Item>, Vec<Connector>),
    pen_color: Color32,
    pen_width: f32,
    path: String,
    status: String,
    dirty: bool,
    fit_pending: bool,
    show_help: bool,
    space_down: bool,
}

impl BrainCraftApp {
    pub fn new(cc: &eframe::CreationContext<'_>, path: Option<PathBuf>) -> Self {
        cc.egui_ctx.set_theme(egui::Theme::Light);
        let mut app = Self {
            board: Board::welcome(),
            history: History::default(),
            camera: Camera::default(),
            tool: Tool::Select,
            selection: BTreeSet::new(),
            selected_connector: None,
            drag: Drag::None,
            editing: None,
            clipboard: (Vec::new(), Vec::new()),
            pen_color: palette::INKS[0].1,
            pen_width: 4.0,
            path: "board.braincraft.json".into(),
            status: String::new(),
            dirty: false,
            fit_pending: true,
            show_help: false,
            space_down: false,
        };
        if let Some(path) = path {
            app.path = path.display().to_string();
            if path.exists() {
                app.open();
            } else {
                app.board = Board::default();
                app.status = format!("New board — will save to {}", app.path);
            }
        }
        app
    }

    // ----- document operations -------------------------------------------------

    fn finish_editing(&mut self) {
        if let Some(edit) = self.editing.take() {
            self.commit(edit.before);
        }
    }

    /// Records an undo step from `before` to the current board.
    fn commit(&mut self, before: Board) {
        if self.history.commit(before, &self.board) {
            self.dirty = true;
        }
    }

    fn edit_board(&mut self, f: impl FnOnce(&mut Board, &mut BTreeSet<Id>)) {
        self.finish_editing();
        let before = self.board.clone();
        f(&mut self.board, &mut self.selection);
        self.commit(before);
    }

    fn reset_view_state(&mut self) {
        self.selection.clear();
        self.selected_connector = None;
        self.editing = None;
        self.drag = Drag::None;
        self.history.clear();
        self.dirty = false;
        self.fit_pending = true;
    }

    fn new_board(&mut self) {
        self.board = Board::default();
        self.reset_view_state();
        self.camera = Camera::default();
        self.fit_pending = false;
        self.status = "New board".into();
    }

    fn open(&mut self) {
        match std::fs::read_to_string(&self.path)
            .map_err(|e| e.to_string())
            .and_then(|s| Board::from_json(&s).map_err(|e| e.to_string()))
        {
            Ok(board) => {
                self.board = board;
                self.reset_view_state();
                self.status = format!("Opened {}", self.path);
            }
            Err(e) => self.status = format!("Could not open {}: {e}", self.path),
        }
    }

    fn save(&mut self) {
        self.finish_editing();
        match std::fs::write(&self.path, self.board.to_json()) {
            Ok(()) => {
                self.dirty = false;
                self.status = format!("Saved {}", self.path);
            }
            Err(e) => self.status = format!("Could not save {}: {e}", self.path),
        }
    }

    fn undo(&mut self) {
        self.finish_editing();
        if self.history.undo(&mut self.board) {
            self.after_history_jump();
        }
    }

    fn redo(&mut self) {
        self.finish_editing();
        if self.history.redo(&mut self.board) {
            self.after_history_jump();
        }
    }

    fn after_history_jump(&mut self) {
        let board = &self.board;
        self.selection.retain(|id| board.item(*id).is_some());
        if self
            .selected_connector
            .is_some_and(|c| board.connector(c).is_none())
        {
            self.selected_connector = None;
        }
        self.dirty = true;
    }

    fn delete_selection(&mut self) {
        let connectors: BTreeSet<Id> = self.selected_connector.take().into_iter().collect();
        self.edit_board(|b, sel| {
            b.remove(sel, &connectors);
            sel.clear();
        });
    }

    fn duplicate_selection(&mut self) {
        self.edit_board(|b, sel| *sel = b.duplicate(sel, vec2(30.0, 30.0)));
    }

    fn copy_selection(&mut self) {
        if !self.selection.is_empty() {
            self.clipboard = self.board.copy(&self.selection);
            self.status = format!("Copied {} item(s)", self.clipboard.0.len());
        }
    }

    fn paste(&mut self, at: Option<Pos2>) {
        let (items, connectors) = self.clipboard.clone();
        let Some(bounds) = items.iter().map(|i| i.rect).reduce(|a, b| a.union(b)) else {
            return;
        };
        let offset = match at {
            Some(p) => p - bounds.center(),
            None => vec2(30.0, 30.0),
        };
        self.edit_board(|b, sel| *sel = b.paste(&items, &connectors, offset));
        self.selected_connector = None;
        if at.is_none() {
            // Repeated pastes cascade instead of stacking exactly.
            for item in &mut self.clipboard.0 {
                item.translate(offset);
            }
        }
    }

    fn select_all(&mut self) {
        self.finish_editing();
        self.selection = self.board.items.iter().map(|i| i.id).collect();
        self.selected_connector = None;
        self.tool = Tool::Select;
    }

    fn start_editing(&mut self, id: Id) {
        self.finish_editing();
        if self.board.item(id).is_some_and(|i| i.kind.has_text()) {
            self.selection = BTreeSet::from([id]);
            self.selected_connector = None;
            self.editing = Some(Editing {
                id,
                before: self.board.clone(),
                focus_requested: false,
            });
        }
    }

    /// Places a new item and starts editing its text.
    fn create_item(&mut self, kind: Kind, rect: Rect) {
        self.finish_editing();
        let before = self.board.clone();
        let mut item = Item::new(kind, rect);
        if kind == Kind::Frame {
            item.text = format!(
                "Frame {}",
                self.board
                    .items
                    .iter()
                    .filter(|i| i.kind == Kind::Frame)
                    .count()
                    + 1
            );
        }
        let id = self.board.add_item(item);
        if kind == Kind::Frame {
            // A new frame goes beneath what it was drawn around.
            self.board.send_to_back(&BTreeSet::from([id]));
        }
        self.commit(before.clone());
        self.selection = BTreeSet::from([id]);
        self.selected_connector = None;
        self.tool = Tool::Select;
        if kind != Kind::Frame {
            // The creation is already one undo step; typing is folded into it.
            self.editing = Some(Editing {
                id,
                before: self.board.clone(),
                focus_requested: false,
            });
        }
    }

    fn set_color(&mut self, color: Color32) {
        if let Some(c) = self.selected_connector {
            self.edit_board(|b, _| {
                if let Some(c) = b.connector_mut(c) {
                    c.color = color;
                }
            });
            return;
        }
        self.edit_board(|b, sel| {
            for item in b.items.iter_mut().filter(|i| sel.contains(&i.id)) {
                item.color = color;
            }
        });
    }

    fn scale_font(&mut self, factor: f32) {
        self.edit_board(|b, sel| {
            for item in b.items.iter_mut().filter(|i| sel.contains(&i.id)) {
                item.font_size = (item.font_size * factor).clamp(6.0, 400.0);
            }
        });
    }

    fn zoom_by(&mut self, factor: f32, viewport: Rect) {
        self.camera.zoom_at(viewport.center(), factor);
    }

    fn fit_view(&mut self, viewport: Rect) {
        let target = if self.selection.is_empty() {
            self.board.bounds(None)
        } else {
            self.board.bounds(Some(&self.selection))
        };
        match target {
            Some(r) => self.camera.fit(r, viewport),
            None => self.camera = Camera::default(),
        }
    }

    // ----- UI --------------------------------------------------------------------

    fn top_bar(&mut self, ui: &mut egui::Ui, viewport: Rect) {
        ui.horizontal(|ui| {
            ui.label(
                egui::RichText::new("BrainCraft")
                    .strong()
                    .size(18.0)
                    .color(ACCENT),
            );
            ui.separator();
            if ui.button("New").clicked() {
                self.new_board();
            }
            if ui
                .button("Open")
                .on_hover_text("Open the board at the path on the right")
                .clicked()
            {
                self.open();
            }
            let save = ui
                .button(if self.dirty { "Save •" } else { "Save" })
                .on_hover_text("Ctrl+S");
            if save.clicked() {
                self.save();
            }
            ui.add(
                egui::TextEdit::singleline(&mut self.path)
                    .desired_width(220.0)
                    .hint_text("board path"),
            );
            ui.separator();
            if ui
                .add_enabled(self.history.can_undo(), egui::Button::new("⟲"))
                .on_hover_text("Undo (Ctrl+Z)")
                .clicked()
            {
                self.undo();
            }
            if ui
                .add_enabled(self.history.can_redo(), egui::Button::new("⟳"))
                .on_hover_text("Redo (Ctrl+Shift+Z)")
                .clicked()
            {
                self.redo();
            }
            ui.separator();
            if ui.button("−").on_hover_text("Zoom out").clicked() {
                self.zoom_by(1.0 / 1.25, viewport);
            }
            if ui
                .button(format!("{:.0}%", self.camera.zoom * 100.0))
                .on_hover_text("Reset to 100%")
                .clicked()
            {
                let factor = 1.0 / self.camera.zoom;
                self.zoom_by(factor, viewport);
            }
            if ui.button("+").on_hover_text("Zoom in").clicked() {
                self.zoom_by(1.25, viewport);
            }
            if ui
                .button("Fit")
                .on_hover_text("Zoom to fit the board or selection (Shift+1)")
                .clicked()
            {
                self.fit_view(viewport);
            }
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                if ui.button("?").on_hover_text("Keyboard shortcuts").clicked() {
                    self.show_help = !self.show_help;
                }
                ui.label(egui::RichText::new(&self.status).weak());
            });
        });
    }

    fn tool_bar(&mut self, ui: &mut egui::Ui) {
        ui.vertical_centered(|ui| {
            ui.add_space(8.0);
            for tool in Tool::ALL {
                let text = egui::RichText::new(tool.icon()).size(20.0);
                let button =
                    egui::Button::selectable(self.tool == tool, text).min_size(vec2(40.0, 40.0));
                let hint = format!("{} ({})", tool.name(), tool.key().name());
                let resp = ui.add(button);
                if tool == Tool::Sticky {
                    let r = Rect::from_center_size(resp.rect.center(), vec2(18.0, 18.0));
                    ui.painter().rect(
                        r,
                        2.0,
                        palette::FILLS[0].1,
                        Stroke::new(1.0, Color32::from_gray(120)),
                        StrokeKind::Inside,
                    );
                }
                if resp.on_hover_text(hint).clicked() {
                    self.finish_editing();
                    self.tool = tool;
                }
                if tool == Tool::Hand {
                    ui.separator();
                }
            }
            if self.tool == Tool::Pen {
                ui.separator();
                for (name, color) in palette::INKS {
                    let (rect, resp) = ui.allocate_exact_size(vec2(22.0, 22.0), Sense::click());
                    ui.painter().circle_filled(rect.center(), 9.0, color);
                    if self.pen_color == color {
                        ui.painter()
                            .circle_stroke(rect.center(), 11.0, Stroke::new(2.0, ACCENT));
                    }
                    if resp.on_hover_text(name).clicked() {
                        self.pen_color = color;
                    }
                }
                ui.add(
                    egui::Slider::new(&mut self.pen_width, 1.0..=24.0)
                        .vertical()
                        .show_value(false),
                )
                .on_hover_text("Stroke width");
            }
        });
    }

    fn handle_shortcuts(
        &mut self,
        ctx: &egui::Context,
        viewport: Rect,
        pointer_world: Option<Pos2>,
    ) {
        let typing = ctx.egui_wants_keyboard_input();
        if self.editing.is_some() && ctx.input(|i| i.key_pressed(Key::Escape)) {
            self.finish_editing();
            return;
        }
        self.space_down = !typing && ctx.input(|i| i.key_down(Key::Space));
        let shortcut = |m: Modifiers, k: Key| {
            ctx.input_mut(|i| i.consume_shortcut(&KeyboardShortcut::new(m, k)))
        };

        if shortcut(Modifiers::COMMAND, Key::S) {
            self.save();
        }
        if typing {
            return;
        }
        if shortcut(Modifiers::COMMAND | Modifiers::SHIFT, Key::Z)
            || shortcut(Modifiers::COMMAND, Key::Y)
        {
            self.redo();
        } else if shortcut(Modifiers::COMMAND, Key::Z) {
            self.undo();
        }
        if shortcut(Modifiers::COMMAND, Key::A) {
            self.select_all();
        }
        if shortcut(Modifiers::COMMAND, Key::D) {
            self.duplicate_selection();
        }
        if shortcut(Modifiers::SHIFT, Key::Num1) {
            self.fit_view(viewport);
        }
        let (copy, cut, paste) = ctx.input(|i| {
            let mut out = (false, false, false);
            for e in &i.events {
                match e {
                    egui::Event::Copy => out.0 = true,
                    egui::Event::Cut => out.1 = true,
                    egui::Event::Paste(_) => out.2 = true,
                    _ => {}
                }
            }
            out
        });
        if copy || cut {
            self.copy_selection();
        }
        if cut {
            self.delete_selection();
        }
        if paste {
            self.paste(pointer_world);
        }

        let (delete, escape, enter, nudge) = ctx.input(|i| {
            let step = if i.modifiers.shift { 10.0 } else { 1.0 };
            let mut nudge = Vec2::ZERO;
            if i.key_pressed(Key::ArrowLeft) {
                nudge.x -= step;
            }
            if i.key_pressed(Key::ArrowRight) {
                nudge.x += step;
            }
            if i.key_pressed(Key::ArrowUp) {
                nudge.y -= step;
            }
            if i.key_pressed(Key::ArrowDown) {
                nudge.y += step;
            }
            (
                i.key_pressed(Key::Delete) || i.key_pressed(Key::Backspace),
                i.key_pressed(Key::Escape),
                i.key_pressed(Key::Enter),
                nudge,
            )
        });
        if delete {
            self.delete_selection();
        }
        if escape {
            self.selection.clear();
            self.selected_connector = None;
            self.tool = Tool::Select;
            self.drag = Drag::None;
        }
        if enter && self.selection.len() == 1 {
            let id = *self.selection.first().unwrap();
            self.start_editing(id);
        }
        if nudge != Vec2::ZERO && !self.selection.is_empty() {
            self.edit_board(|b, sel| {
                let ids = b.with_frame_contents(sel);
                b.translate(&ids, nudge);
            });
        }
        let modifiers = ctx.input(|i| i.modifiers);
        if !modifiers.command && !modifiers.alt {
            for tool in Tool::ALL {
                if ctx.input(|i| i.key_pressed(tool.key())) {
                    self.tool = tool;
                }
            }
        }
    }

    fn canvas(&mut self, ui: &mut egui::Ui) {
        let ctx = ui.ctx().clone();
        let (viewport, response) =
            ui.allocate_exact_size(ui.available_size(), Sense::click_and_drag());
        if self.fit_pending {
            self.fit_pending = false;
            self.fit_view(viewport);
        }

        let minimap_rect = Rect::from_min_size(
            viewport.right_bottom() - vec2(212.0, 152.0),
            vec2(200.0, 140.0),
        );
        let minimap = ui.interact(
            minimap_rect,
            ui.id().with("minimap"),
            Sense::click_and_drag(),
        );

        let pointer = ctx
            .input(|i| i.pointer.hover_pos())
            .filter(|p| viewport.contains(*p));
        let pointer_world = pointer.map(|p| self.camera.to_world(p));
        self.handle_shortcuts(&ctx, viewport, pointer_world);

        // Scroll pans; Ctrl+scroll and pinch zoom around the pointer.
        if response.contains_pointer() || minimap.contains_pointer() {
            let (scroll, zoom) = ctx.input(|i| (i.smooth_scroll_delta(), i.zoom_delta()));
            if let Some(p) = pointer
                && zoom != 1.0
            {
                self.camera.zoom_at(p, zoom);
            }
            self.camera.pan += scroll;
        }

        self.handle_canvas_pointer(&ctx, &response, viewport);
        self.context_menu(&response);

        let painter = ui.painter_at(viewport);
        self.paint_background(&painter, viewport);
        self.paint_board(&painter);
        self.paint_overlays(&painter, &ctx);
        self.text_editor(ui);
        self.minimap(&painter, &minimap, minimap_rect, viewport);
        self.selection_toolbar(&ctx, viewport);
        if self.show_help {
            self.help_window(&ctx);
        }
    }

    /// The selection box of a single resizable item, in screen space.
    fn resizable_rect(&self) -> Option<(Id, Rect)> {
        if self.selection.len() != 1 || self.editing.is_some() {
            return None;
        }
        let id = *self.selection.first()?;
        let item = self.board.item(id)?;
        Some((id, self.camera.rect_to_screen(item.rect)))
    }

    fn corner_under(&self, p: Pos2) -> Option<(Id, Corner)> {
        let (id, r) = self.resizable_rect()?;
        Corner::ALL
            .into_iter()
            .find(|c| c.of(r).distance(p) <= HANDLE + 2.0)
            .map(|c| (id, c))
    }

    /// Screen position of the "drag to connect" handle on a single selected item.
    fn connect_handle(&self) -> Option<(Id, Pos2)> {
        let (id, r) = self.resizable_rect()?;
        (self.board.item(id)?.kind != Kind::Pen)
            .then(|| (id, r.right_center() + vec2(CONNECT_HANDLE_GAP, 0.0)))
    }

    /// What dropping a connector dragged out of `from` at `world` would link to.
    /// Frames count as empty canvas, so notes inside a frame can grow a mind map.
    fn connect_target(&self, world: Pos2, from: Id) -> ConnectTarget {
        match self.board.hit_test(world, 4.0 / self.camera.zoom) {
            Some(Hit::Item(id)) if id == from => ConnectTarget::Nothing,
            Some(Hit::Item(id)) if self.board.item(id).is_some_and(|i| i.kind == Kind::Frame) => {
                ConnectTarget::Empty
            }
            Some(Hit::Item(id)) => ConnectTarget::Item(id),
            Some(Hit::Connector(_)) => ConnectTarget::Nothing,
            None => ConnectTarget::Empty,
        }
    }

    fn hit(&self, screen: Pos2) -> Option<Hit> {
        self.board
            .hit_test(self.camera.to_world(screen), 4.0 / self.camera.zoom)
    }

    fn handle_canvas_pointer(
        &mut self,
        ctx: &egui::Context,
        response: &egui::Response,
        viewport: Rect,
    ) {
        let hover = response.hover_pos();
        let pan_gesture = self.tool == Tool::Hand || self.space_down;

        // Cursor feedback.
        if let Some(p) = hover {
            let icon = match &self.drag {
                Drag::Pan => CursorIcon::Grabbing,
                Drag::Move { .. } => CursorIcon::Grabbing,
                Drag::Resize { .. } => CursorIcon::Crosshair,
                _ if pan_gesture => CursorIcon::Grab,
                _ if self.tool.creates().is_some() || self.tool == Tool::Pen => {
                    CursorIcon::Crosshair
                }
                _ if self.tool == Tool::Select => match self.corner_under(p) {
                    Some((_, c)) => c.cursor(),
                    None if self
                        .connect_handle()
                        .is_some_and(|(_, h)| h.distance(p) < 10.0) =>
                    {
                        CursorIcon::PointingHand
                    }
                    None if self.hit(p).is_some() => CursorIcon::Move,
                    None => CursorIcon::Default,
                },
                _ => CursorIcon::Default,
            };
            ctx.set_cursor_icon(icon);
        }

        // Middle-button (or hand-tool) panning.
        if response.dragged_by(PointerButton::Middle) || matches!(self.drag, Drag::Pan) {
            self.camera.pan += response.drag_delta();
        }
        if response.drag_started_by(PointerButton::Middle) {
            self.drag = Drag::Pan;
        }

        if response.drag_started_by(PointerButton::Primary) {
            let start = ctx.input(|i| i.pointer.press_origin()).unwrap_or_default();
            self.begin_drag(start, pan_gesture, ctx.input(|i| i.modifiers.shift));
        }

        if response.dragged_by(PointerButton::Primary) {
            if let Some(p) = response.interact_pointer_pos() {
                let world = self.camera.to_world(p);
                match &mut self.drag {
                    Drag::Move { ids, last, .. } => {
                        let delta = world - *last;
                        *last = world;
                        self.board.translate(ids, delta);
                    }
                    Drag::Resize { id, anchor, .. } => {
                        let mut r = Rect::from_two_pos(*anchor, world);
                        let min = 12.0;
                        if r.width() < min {
                            r.max.x = r.min.x + min;
                        }
                        if r.height() < min {
                            r.max.y = r.min.y + min;
                        }
                        if let Some(item) = self.board.item_mut(*id) {
                            item.set_rect(r);
                        }
                    }
                    Drag::Draw { points }
                        if points
                            .last()
                            .is_none_or(|l| l.distance(world) * self.camera.zoom > 1.5) =>
                    {
                        points.push(world);
                    }
                    _ => {}
                }
            }
            // Auto-scroll while dragging near the edge.
            if matches!(
                self.drag,
                Drag::Move { .. }
                    | Drag::Marquee { .. }
                    | Drag::Connect { .. }
                    | Drag::Create { .. }
            ) && let Some(p) = response.interact_pointer_pos()
            {
                let edge = 24.0;
                let mut push = Vec2::ZERO;
                if p.x < viewport.left() + edge {
                    push.x = 8.0;
                }
                if p.x > viewport.right() - edge {
                    push.x = -8.0;
                }
                if p.y < viewport.top() + edge {
                    push.y = 8.0;
                }
                if p.y > viewport.bottom() - edge {
                    push.y = -8.0;
                }
                if push != Vec2::ZERO {
                    self.camera.pan += push;
                    if let Drag::Move { ids, last, .. } = &mut self.drag {
                        let world = self.camera.to_world(p);
                        let delta = world - *last;
                        *last = world;
                        self.board.translate(ids, delta);
                    }
                    ctx.request_repaint();
                }
            }
        }

        if response.drag_stopped() {
            let end = response
                .interact_pointer_pos()
                .or(hover)
                .map(|p| self.camera.to_world(p));
            self.end_drag(end);
        }

        if response.double_clicked() {
            if let Some(p) = response.interact_pointer_pos() {
                match self.hit(p) {
                    Some(Hit::Item(id)) => self.start_editing(id),
                    Some(Hit::Connector(_)) => {}
                    None if self.tool == Tool::Select => {
                        let world = self.camera.to_world(p);
                        let size = Kind::Sticky.default_size();
                        self.create_item(Kind::Sticky, Rect::from_center_size(world, size));
                    }
                    None => {}
                }
            }
        } else if response.clicked()
            && let Some(p) = response.interact_pointer_pos()
        {
            self.click(p, ctx.input(|i| i.modifiers.shift));
        }

        if response.secondary_clicked()
            && let Some(p) = response.interact_pointer_pos()
        {
            match self.hit(p) {
                Some(Hit::Item(id)) if !self.selection.contains(&id) => {
                    self.finish_editing();
                    self.selection = BTreeSet::from([id]);
                    self.selected_connector = None;
                }
                Some(Hit::Connector(id)) => {
                    self.finish_editing();
                    self.selection.clear();
                    self.selected_connector = Some(id);
                }
                _ => {}
            }
        }
    }

    fn click(&mut self, p: Pos2, shift: bool) {
        let world = self.camera.to_world(p);
        if let Some(kind) = self.tool.creates() {
            self.create_item(kind, Rect::from_center_size(world, kind.default_size()));
            return;
        }
        if self.tool != Tool::Select {
            return;
        }
        self.finish_editing();
        match self.hit(p) {
            Some(Hit::Item(id)) => {
                self.selected_connector = None;
                if shift {
                    if !self.selection.remove(&id) {
                        self.selection.insert(id);
                    }
                } else {
                    self.selection = BTreeSet::from([id]);
                }
            }
            Some(Hit::Connector(id)) => {
                self.selection.clear();
                self.selected_connector = Some(id);
            }
            None => {
                if !shift {
                    self.selection.clear();
                }
                self.selected_connector = None;
            }
        }
    }

    fn begin_drag(&mut self, start: Pos2, pan_gesture: bool, shift: bool) {
        self.finish_editing();
        let world = self.camera.to_world(start);
        if pan_gesture {
            self.drag = Drag::Pan;
            return;
        }
        if let Some(kind) = self.tool.creates() {
            self.drag = Drag::Create { kind, start: world };
            return;
        }
        match self.tool {
            Tool::Pen => {
                self.drag = Drag::Draw {
                    points: vec![world],
                }
            }
            Tool::Connector => {
                self.drag = match self.hit(start) {
                    Some(Hit::Item(from)) => Drag::Connect { from },
                    _ => Drag::None,
                };
            }
            Tool::Select => {
                if let Some((id, corner)) = self.corner_under(start) {
                    let item = self.board.item(id).expect("selected item exists");
                    self.drag = Drag::Resize {
                        id,
                        anchor: corner.opposite().of(item.rect),
                        before: self.board.clone(),
                    };
                    return;
                }
                if let Some((from, _)) = self
                    .connect_handle()
                    .filter(|(_, h)| h.distance(start) < 10.0)
                {
                    self.drag = Drag::Connect { from };
                    return;
                }
                match self.hit(start) {
                    Some(Hit::Item(id)) => {
                        if !self.selection.contains(&id) {
                            if !shift {
                                self.selection.clear();
                            }
                            self.selection.insert(id);
                        }
                        self.selected_connector = None;
                        self.drag = Drag::Move {
                            ids: self.board.with_frame_contents(&self.selection),
                            last: world,
                            before: self.board.clone(),
                        };
                    }
                    _ => {
                        if !shift {
                            self.selection.clear();
                        }
                        self.selected_connector = None;
                        self.drag = Drag::Marquee {
                            start: world,
                            additive: shift,
                        };
                    }
                }
            }
            Tool::Hand => self.drag = Drag::Pan,
            _ => {}
        }
    }

    fn end_drag(&mut self, end: Option<Pos2>) {
        match std::mem::replace(&mut self.drag, Drag::None) {
            Drag::None | Drag::Pan => {}
            Drag::Move { before, .. } | Drag::Resize { before, .. } => self.commit(before),
            Drag::Marquee { start, additive } => {
                if let Some(end) = end {
                    let hits = self.board.items_within(Rect::from_two_pos(start, end));
                    if additive {
                        self.selection.extend(hits);
                    } else {
                        self.selection = hits;
                    }
                }
            }
            Drag::Create { kind, start } => {
                let end = end.unwrap_or(start);
                let mut rect = Rect::from_two_pos(start, end);
                if rect.width() * self.camera.zoom < 8.0 || rect.height() * self.camera.zoom < 8.0 {
                    rect = Rect::from_center_size(start, kind.default_size());
                }
                self.create_item(kind, rect);
            }
            Drag::Draw { mut points } => {
                if let Some(end) = end
                    && points.last() != Some(&end)
                {
                    points.push(end);
                }
                let before = self.board.clone();
                self.board
                    .add_item(Item::pen(points, self.pen_color, self.pen_width));
                self.commit(before);
            }
            Drag::Connect { from } => {
                let Some(end) = end else { return };
                let before = self.board.clone();
                let target = match self.connect_target(end, from) {
                    ConnectTarget::Item(to) => Some(to),
                    ConnectTarget::Nothing => None,
                    ConnectTarget::Empty => {
                        // Dropping on empty canvas grows the mind map: a new item
                        // like the source, linked to it.
                        let source = self.board.item(from).cloned();
                        source
                            .filter(|s| s.kind != Kind::Pen && s.kind != Kind::Frame)
                            .map(|s| {
                                let mut item =
                                    Item::new(s.kind, Rect::from_center_size(end, s.rect.size()));
                                item.color = s.color;
                                item.font_size = s.font_size;
                                self.board.add_item(item)
                            })
                    }
                };
                if let Some(to) = target {
                    self.board.connect(from, to);
                    self.commit(before);
                    if self.board.item(to).is_some_and(|i| i.text.is_empty()) {
                        self.start_editing(to);
                    }
                }
            }
        }
    }

    fn context_menu(&mut self, response: &egui::Response) {
        let has_items = !self.selection.is_empty();
        let has_any = has_items || self.selected_connector.is_some();
        let pointer = response
            .ctx
            .input(|i| i.pointer.interact_pos())
            .map(|p| self.camera.to_world(p));
        response.context_menu(|ui| {
            if ui
                .add_enabled(
                    has_items && self.selection.len() == 1,
                    egui::Button::new("Edit text"),
                )
                .clicked()
            {
                if let Some(&id) = self.selection.first() {
                    self.start_editing(id);
                }
                ui.close();
            }
            if ui
                .add_enabled(has_items, egui::Button::new("Copy"))
                .clicked()
            {
                self.copy_selection();
                ui.close();
            }
            if ui
                .add_enabled(
                    !self.clipboard.0.is_empty(),
                    egui::Button::new("Paste here"),
                )
                .clicked()
            {
                self.paste(pointer);
                ui.close();
            }
            if ui
                .add_enabled(has_items, egui::Button::new("Duplicate"))
                .clicked()
            {
                self.duplicate_selection();
                ui.close();
            }
            ui.separator();
            if ui
                .add_enabled(has_items, egui::Button::new("Bring to front"))
                .clicked()
            {
                self.edit_board(|b, sel| b.bring_to_front(sel));
                ui.close();
            }
            if ui
                .add_enabled(has_items, egui::Button::new("Send to back"))
                .clicked()
            {
                self.edit_board(|b, sel| b.send_to_back(sel));
                ui.close();
            }
            ui.separator();
            if ui
                .add_enabled(has_any, egui::Button::new("Delete"))
                .clicked()
            {
                self.delete_selection();
                ui.close();
            }
        });
    }

    // ----- painting --------------------------------------------------------------

    fn paint_background(&self, painter: &egui::Painter, viewport: Rect) {
        painter.rect_filled(viewport, 0.0, CANVAS_BG);
        let mut step = 40.0;
        while step * self.camera.zoom < 14.0 {
            step *= 5.0;
        }
        let world = self.camera.rect_to_world(viewport);
        let radius = (1.2 * self.camera.zoom.sqrt()).clamp(0.8, 1.6);
        let mut x = (world.min.x / step).floor() * step;
        while x <= world.max.x {
            let mut y = (world.min.y / step).floor() * step;
            while y <= world.max.y {
                painter.circle_filled(self.camera.to_screen(pos2(x, y)), radius, GRID_DOT);
                y += step;
            }
            x += step;
        }
    }

    fn paint_board(&self, painter: &egui::Painter) {
        let editing = self.editing.as_ref().map(|e| e.id);
        let frames = self.board.items.iter().filter(|i| i.kind == Kind::Frame);
        let others = self.board.items.iter().filter(|i| i.kind != Kind::Frame);
        for item in frames.chain(others) {
            self.paint_item(painter, item, editing == Some(item.id));
        }
        for c in &self.board.connectors {
            if let Some((a, b)) = self.board.connector_endpoints(c) {
                let selected = self.selected_connector == Some(c.id);
                let color = if selected { ACCENT } else { c.color };
                let width = if selected { 3.0 } else { 2.0 };
                self.paint_arrow(
                    painter,
                    self.camera.to_screen(a),
                    self.camera.to_screen(b),
                    Stroke::new(width, color),
                );
            }
        }
    }

    fn paint_arrow(&self, painter: &egui::Painter, a: Pos2, b: Pos2, stroke: Stroke) {
        let dir = (b - a).normalized();
        if !dir.is_finite() {
            return;
        }
        let head = 12.0_f32.min((b - a).length() / 2.0);
        let tip_base = b - dir * head;
        painter.line_segment([a, tip_base], stroke);
        let normal = vec2(-dir.y, dir.x) * head * 0.45;
        painter.add(Shape::convex_polygon(
            vec![b, tip_base + normal, tip_base - normal],
            stroke.color,
            Stroke::NONE,
        ));
    }

    fn paint_item(&self, painter: &egui::Painter, item: &Item, editing: bool) {
        let zoom = self.camera.zoom;
        let r = self.camera.rect_to_screen(item.rect);
        if !painter.clip_rect().intersects(r.expand(40.0)) {
            return;
        }
        let radius = CornerRadius::same((4.0 * zoom).clamp(0.0, 12.0) as u8);
        match item.kind {
            Kind::Sticky => {
                let shadow = r.translate(vec2(0.0, 3.0 * zoom.min(2.0)));
                painter.rect_filled(shadow, radius, Color32::from_black_alpha(28));
                painter.rect_filled(r, radius, item.color);
            }
            Kind::Rect => {
                painter.rect(
                    r,
                    radius,
                    item.color,
                    Stroke::new(2.0, darken(item.color)),
                    StrokeKind::Inside,
                );
            }
            Kind::Ellipse => {
                painter.add(Shape::ellipse_filled(
                    r.center(),
                    r.size() / 2.0,
                    item.color,
                ));
                painter.add(Shape::ellipse_stroke(
                    r.center(),
                    r.size() / 2.0,
                    Stroke::new(2.0, darken(item.color)),
                ));
            }
            Kind::Frame => {
                painter.rect(
                    r,
                    CornerRadius::same(2),
                    item.color,
                    Stroke::new(1.0, Color32::from_gray(200)),
                    StrokeKind::Outside,
                );
                if !editing {
                    let title = self.camera.rect_to_screen(frame_title_rect(item));
                    let font = FontId::proportional((item.font_size * zoom).max(1.0));
                    if font.size >= 3.0 {
                        let text = if item.text.is_empty() {
                            "Untitled frame"
                        } else {
                            &item.text
                        };
                        painter
                            .with_clip_rect(title.intersect(painter.clip_rect()))
                            .text(
                                title.left_center(),
                                Align2::LEFT_CENTER,
                                text,
                                font,
                                Color32::from_gray(90),
                            );
                    }
                }
                return;
            }
            Kind::Text => {}
            Kind::Pen => {
                let pts: Vec<Pos2> = item
                    .points
                    .iter()
                    .map(|p| self.camera.to_screen(*p))
                    .collect();
                let stroke = Stroke::new((item.stroke_width * zoom).max(0.5), item.color);
                if pts.len() == 1 {
                    painter.circle_filled(pts[0], stroke.width / 2.0, item.color);
                } else {
                    painter.add(Shape::line(pts, stroke));
                }
                return;
            }
        }
        if editing || item.text.is_empty() {
            return;
        }
        let font_size = item.font_size * zoom;
        if font_size < 3.0 {
            // Too small to read: hint at the text with a bar instead.
            let inner = r.shrink(TEXT_PAD * zoom);
            let bar = Rect::from_min_size(
                inner.min,
                vec2(inner.width() * 0.7, (font_size * 0.8).max(1.0)),
            );
            painter.rect_filled(bar, 0.0, text_color(item).gamma_multiply(0.3));
            return;
        }
        let inner = text_rect(item, r, zoom);
        let galley = painter.layout(
            item.text.clone(),
            FontId::proportional(font_size),
            text_color(item),
            inner.width().max(1.0),
        );
        let pos = match item.kind {
            Kind::Text => inner.min,
            // Shapes and notes centre their text, like a card.
            _ => pos2(
                inner.center().x - galley.size().x / 2.0,
                inner.center().y - galley.size().y / 2.0,
            )
            .max(inner.min),
        };
        painter
            .with_clip_rect(inner.expand(2.0).intersect(painter.clip_rect()))
            .galley(pos, galley, text_color(item));
    }

    fn paint_overlays(&self, painter: &egui::Painter, ctx: &egui::Context) {
        let sel_stroke = Stroke::new(1.5, ACCENT);
        for id in &self.selection {
            if let Some(item) = self.board.item(*id) {
                let r = self.camera.rect_to_screen(item.rect).expand(3.0);
                painter.rect_stroke(r, 2.0, sel_stroke, StrokeKind::Outside);
            }
        }
        if self.selection.len() > 1
            && let Some(b) = self.board.bounds(Some(&self.selection))
        {
            let r = self.camera.rect_to_screen(b).expand(8.0);
            painter.add(Shape::dashed_line(
                &[
                    r.left_top(),
                    r.right_top(),
                    r.right_bottom(),
                    r.left_bottom(),
                    r.left_top(),
                ],
                Stroke::new(1.0, ACCENT),
                6.0,
                4.0,
            ));
        }
        if let Some((_, r)) = self.resizable_rect() {
            for c in Corner::ALL {
                let h = Rect::from_center_size(c.of(r), Vec2::splat(HANDLE));
                painter.rect(h, 2.0, Color32::WHITE, sel_stroke, StrokeKind::Middle);
            }
        }
        if !matches!(self.drag, Drag::Connect { .. })
            && let Some((_, h)) = self.connect_handle()
        {
            painter.circle(h, 6.0, ACCENT, Stroke::new(2.0, Color32::WHITE));
        }

        let pointer = ctx.input(|i| i.pointer.interact_pos());
        match &self.drag {
            Drag::Marquee { start, .. } => {
                if let Some(p) = pointer {
                    let r = Rect::from_two_pos(self.camera.to_screen(*start), p);
                    painter.rect(
                        r,
                        0.0,
                        ACCENT.gamma_multiply(0.08),
                        Stroke::new(1.0, ACCENT),
                        StrokeKind::Inside,
                    );
                }
            }
            Drag::Create { kind, start } => {
                if let Some(p) = pointer {
                    let r = Rect::from_two_pos(self.camera.to_screen(*start), p);
                    let fill = kind.default_color().gamma_multiply(0.6);
                    match kind {
                        Kind::Ellipse => {
                            painter.add(Shape::ellipse_filled(r.center(), r.size() / 2.0, fill));
                        }
                        _ => {
                            painter.rect(
                                r,
                                2.0,
                                fill,
                                Stroke::new(1.0, ACCENT),
                                StrokeKind::Inside,
                            );
                        }
                    }
                }
            }
            Drag::Draw { points } => {
                let pts: Vec<Pos2> = points.iter().map(|p| self.camera.to_screen(*p)).collect();
                painter.add(Shape::line(
                    pts,
                    Stroke::new(self.pen_width * self.camera.zoom, self.pen_color),
                ));
            }
            Drag::Connect { from } => {
                if let (Some(p), Some(item)) = (pointer, self.board.item(*from)) {
                    let world = self.camera.to_world(p);
                    let a = self.camera.to_screen(item.anchor_towards(world));
                    let end = match self.connect_target(world, *from) {
                        ConnectTarget::Item(to) => {
                            let t = self.board.item(to).unwrap();
                            painter.rect_stroke(
                                self.camera.rect_to_screen(t.rect).expand(3.0),
                                2.0,
                                Stroke::new(2.0, ACCENT),
                                StrokeKind::Outside,
                            );
                            self.camera.to_screen(t.anchor_towards(item.rect.center()))
                        }
                        _ => p,
                    };
                    self.paint_arrow(painter, a, end, Stroke::new(2.0, ACCENT));
                }
            }
            _ => {}
        }
    }

    /// The text box for the item being edited, laid over the item itself.
    fn text_editor(&mut self, ui: &mut egui::Ui) {
        let Some(edit) = &mut self.editing else {
            return;
        };
        let Some(item) = self.board.item_mut(edit.id) else {
            self.editing = None;
            return;
        };
        let zoom = self.camera.zoom;
        let screen = self.camera.rect_to_screen(item.rect);
        let (area, align) = match item.kind {
            Kind::Frame => (
                self.camera.rect_to_screen(frame_title_rect(item)),
                egui::Align::Min,
            ),
            Kind::Text => (text_rect(item, screen, zoom), egui::Align::Min),
            _ => (text_rect(item, screen, zoom), egui::Align::Center),
        };
        let color = text_color(item);
        let id = egui::Id::new(("braincraft-edit", edit.id));
        let editor = egui::TextEdit::multiline(&mut item.text)
            .id(id)
            .font(FontId::proportional((item.font_size * zoom).max(4.0)))
            .text_color(color)
            .frame(egui::Frame::NONE)
            .margin(egui::Margin::ZERO)
            .horizontal_align(align)
            .desired_width(area.width())
            .desired_rows(1);
        let resp = ui.put(area, editor);
        if !edit.focus_requested {
            edit.focus_requested = true;
            resp.request_focus();
        } else if resp.lost_focus() {
            self.finish_editing();
            return;
        }
        // Text items grow to fit what is typed.
        if item.kind == Kind::Text {
            let font = FontId::proportional((item.font_size * zoom).max(4.0));
            let text_height = ui
                .painter()
                .layout(item.text.clone(), font, color, area.width())
                .size()
                .y;
            let needed = (text_height + 2.0 * (area.top() - screen.top())) / zoom;
            if needed > item.rect.height() + 0.5 {
                item.rect.max.y = item.rect.min.y + needed;
            }
        }
    }

    fn minimap(
        &mut self,
        painter: &egui::Painter,
        response: &egui::Response,
        rect: Rect,
        viewport: Rect,
    ) {
        let view_world = self.camera.rect_to_world(viewport);
        let world = self
            .board
            .bounds(None)
            .map_or(view_world, |b| b.union(view_world))
            .expand(40.0);
        let scale = (rect.width() / world.width()).min(rect.height() / world.height());
        let offset = rect.center() - world.center().to_vec2() * scale;
        let map = |p: Pos2| (p.to_vec2() * scale + offset.to_vec2()).to_pos2();

        painter.rect(
            rect,
            6.0,
            Color32::from_white_alpha(235),
            Stroke::new(1.0, Color32::from_gray(210)),
            StrokeKind::Inside,
        );
        let inner = painter.with_clip_rect(rect.shrink(2.0));
        for item in &self.board.items {
            let r = Rect::from_min_max(map(item.rect.min), map(item.rect.max));
            match item.kind {
                Kind::Frame => {
                    inner.rect_stroke(
                        r,
                        0.0,
                        Stroke::new(1.0, Color32::from_gray(170)),
                        StrokeKind::Inside,
                    );
                }
                _ => {
                    inner.rect_filled(
                        r,
                        0.0,
                        if item.kind.uses_ink() {
                            item.color.gamma_multiply(0.5)
                        } else {
                            darken(item.color)
                        },
                    );
                }
            }
        }
        let v = Rect::from_min_max(map(view_world.min), map(view_world.max));
        inner.rect(
            v,
            1.0,
            ACCENT.gamma_multiply(0.08),
            Stroke::new(1.5, ACCENT),
            StrokeKind::Inside,
        );

        if (response.clicked() || response.dragged())
            && let Some(p) = response.interact_pointer_pos()
        {
            let target = ((p.to_vec2() - offset.to_vec2()) / scale).to_pos2();
            self.camera.center_on(target, viewport);
        }
        if response.hovered() {
            response.ctx.set_cursor_icon(CursorIcon::PointingHand);
        }
    }

    /// The floating bar above the selection with colour and arrangement controls.
    fn selection_toolbar(&mut self, ctx: &egui::Context, viewport: Rect) {
        if !matches!(self.drag, Drag::None) {
            return;
        }
        let (anchor, inks, text) = if let Some(c) = self
            .selected_connector
            .and_then(|c| self.board.connector(c))
        {
            let Some((a, b)) = self.board.connector_endpoints(c) else {
                return;
            };
            (
                self.camera.to_screen(a.lerp(b, 0.5)) - vec2(0.0, 20.0),
                true,
                false,
            )
        } else if let Some(bounds) = self.board.bounds(Some(&self.selection)) {
            let r = self.camera.rect_to_screen(bounds);
            let kinds: Vec<Kind> = self
                .selection
                .iter()
                .filter_map(|id| self.board.item(*id))
                .map(|i| i.kind)
                .collect();
            let inks = kinds.iter().all(|k| k.uses_ink());
            let text = kinds.iter().any(|k| k.has_text());
            (pos2(r.center().x, r.top() - 28.0), inks, text)
        } else {
            return;
        };
        let anchor = anchor.clamp(
            viewport.min + vec2(160.0, 40.0),
            viewport.max - vec2(160.0, 20.0),
        );

        egui::Area::new(egui::Id::new("braincraft-selection-bar"))
            .fixed_pos(anchor)
            .pivot(Align2::CENTER_BOTTOM)
            .order(egui::Order::Foreground)
            .show(ctx, |ui| {
                egui::Frame::popup(ui.style()).show(ui, |ui| {
                    ui.horizontal(|ui| {
                        let colors: &[(&str, Color32)] = if inks {
                            &palette::INKS
                        } else {
                            &palette::FILLS
                        };
                        for (name, color) in colors {
                            let (rect, resp) =
                                ui.allocate_exact_size(vec2(20.0, 20.0), Sense::click());
                            ui.painter().circle(
                                rect.center(),
                                8.0,
                                *color,
                                Stroke::new(1.0, Color32::from_gray(180)),
                            );
                            if resp.on_hover_text(*name).clicked() {
                                self.set_color(*color);
                            }
                        }
                        if text {
                            ui.separator();
                            if ui
                                .small_button("A−")
                                .on_hover_text("Smaller text")
                                .clicked()
                            {
                                self.scale_font(1.0 / 1.2);
                            }
                            if ui.small_button("A+").on_hover_text("Larger text").clicked() {
                                self.scale_font(1.2);
                            }
                        }
                        ui.separator();
                        if !self.selection.is_empty() {
                            if ui
                                .small_button("Front")
                                .on_hover_text("Bring to front")
                                .clicked()
                            {
                                self.edit_board(|b, sel| b.bring_to_front(sel));
                            }
                            if ui
                                .small_button("Back")
                                .on_hover_text("Send to back")
                                .clicked()
                            {
                                self.edit_board(|b, sel| b.send_to_back(sel));
                            }
                            if ui
                                .small_button("Duplicate")
                                .on_hover_text("Duplicate (Ctrl+D)")
                                .clicked()
                            {
                                self.duplicate_selection();
                            }
                        }
                        if ui.small_button("🗑").on_hover_text("Delete (Del)").clicked() {
                            self.delete_selection();
                        }
                    });
                });
            });
    }

    fn help_window(&mut self, ctx: &egui::Context) {
        egui::Window::new("Shortcuts")
            .open(&mut self.show_help)
            .resizable(false)
            .collapsible(false)
            .anchor(Align2::RIGHT_TOP, vec2(-12.0, 48.0))
            .show(ctx, |ui| {
                egui::Grid::new("shortcuts")
                    .num_columns(2)
                    .striped(true)
                    .show(ui, |ui| {
                        for tool in Tool::ALL {
                            ui.label(tool.key().name());
                            ui.label(tool.name());
                            ui.end_row();
                        }
                        for (keys, what) in [
                            ("Scroll / Middle-drag / Space-drag", "Pan"),
                            ("Ctrl + Scroll, pinch", "Zoom"),
                            ("Shift + 1", "Zoom to fit"),
                            ("Double-click", "Edit text / new sticky"),
                            ("Enter", "Edit selected"),
                            (
                                "Drag blue dot",
                                "Connect (drop on empty to add a linked note)",
                            ),
                            ("Shift + click / drag", "Add to selection"),
                            ("Arrows (Shift)", "Nudge by 1 (10)"),
                            ("Ctrl + C / X / V", "Copy / cut / paste"),
                            ("Ctrl + D", "Duplicate"),
                            ("Ctrl + A", "Select all"),
                            ("Ctrl + Z / Ctrl + Shift + Z", "Undo / redo"),
                            ("Ctrl + S", "Save"),
                            ("Delete", "Delete"),
                            ("Esc", "Deselect"),
                        ] {
                            ui.label(keys);
                            ui.label(what);
                            ui.end_row();
                        }
                    });
            });
    }
}

fn darken(c: Color32) -> Color32 {
    let [r, g, b, _] = c.to_array();
    let f = |v: u8| (v as f32 * 0.72) as u8;
    Color32::from_rgb(f(r), f(g), f(b))
}

fn text_color(item: &Item) -> Color32 {
    if item.kind.uses_ink() {
        item.color
    } else {
        palette::TEXT_ON_FILL
    }
}

/// Screen-space area inside an item where its text is laid out.
fn text_rect(item: &Item, screen: Rect, zoom: f32) -> Rect {
    let pad = match item.kind {
        Kind::Ellipse => screen.width().min(screen.height()) * 0.15 + TEXT_PAD * zoom,
        Kind::Text => 4.0 * zoom,
        _ => TEXT_PAD * zoom,
    };
    let r = screen.shrink(pad);
    if r.is_positive() {
        r
    } else {
        Rect::from_center_size(screen.center(), Vec2::splat(1.0))
    }
}

impl eframe::App for BrainCraftApp {
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        let title = format!(
            "BrainCraft — {}{}",
            self.path,
            if self.dirty { " •" } else { "" }
        );
        ui.ctx()
            .send_viewport_cmd(egui::ViewportCommand::Title(title));

        // The canvas viewport from last frame is close enough for the zoom buttons.
        let viewport = ui
            .ctx()
            .memory(|m| {
                m.data
                    .get_temp::<Rect>(egui::Id::new("braincraft-viewport"))
            })
            .unwrap_or(ui.max_rect());
        egui::Panel::top("braincraft-top").show(ui, |ui| {
            ui.add_space(4.0);
            self.top_bar(ui, viewport);
            ui.add_space(4.0);
        });
        egui::Panel::left("braincraft-tools")
            .resizable(false)
            .exact_size(56.0)
            .show(ui, |ui| {
                self.tool_bar(ui);
            });
        egui::CentralPanel::default()
            .frame(egui::Frame::NONE)
            .show(ui, |ui| {
                let rect = ui.max_rect();
                ui.ctx().memory_mut(|m| {
                    m.data
                        .insert_temp(egui::Id::new("braincraft-viewport"), rect)
                });
                self.canvas(ui);
            });
    }
}
