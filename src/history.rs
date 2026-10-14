//! Snapshot-based undo/redo.

use crate::board::Board;

const LIMIT: usize = 200;

#[derive(Default)]
pub struct History {
    undo: Vec<Board>,
    redo: Vec<Board>,
}

impl History {
    /// Records `before` as an undo step if the board actually changed since then.
    pub fn commit(&mut self, before: Board, now: &Board) -> bool {
        if &before == now {
            return false;
        }
        self.undo.push(before);
        if self.undo.len() > LIMIT {
            self.undo.remove(0);
        }
        self.redo.clear();
        true
    }

    pub fn undo(&mut self, board: &mut Board) -> bool {
        match self.undo.pop() {
            Some(prev) => {
                self.redo.push(std::mem::replace(board, prev));
                true
            }
            None => false,
        }
    }

    pub fn redo(&mut self, board: &mut Board) -> bool {
        match self.redo.pop() {
            Some(next) => {
                self.undo.push(std::mem::replace(board, next));
                true
            }
            None => false,
        }
    }

    pub fn can_undo(&self) -> bool {
        !self.undo.is_empty()
    }

    pub fn can_redo(&self) -> bool {
        !self.redo.is_empty()
    }

    pub fn clear(&mut self) {
        self.undo.clear();
        self.redo.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::board::{Item, Kind};
    use egui::Rect;

    fn add(board: &mut Board) {
        board.add_item(Item::new(
            Kind::Sticky,
            Rect::from_min_max([0.0, 0.0].into(), [1.0, 1.0].into()),
        ));
    }

    #[test]
    fn undo_redo_cycle() {
        let mut h = History::default();
        let mut b = Board::default();
        let before = b.clone();
        add(&mut b);
        assert!(h.commit(before, &b));
        assert!(h.undo(&mut b));
        assert!(b.items.is_empty());
        assert!(h.redo(&mut b));
        assert_eq!(b.items.len(), 1);
        assert!(!h.redo(&mut b));
    }

    #[test]
    fn unchanged_boards_are_not_recorded() {
        let mut h = History::default();
        let b = Board::default();
        assert!(!h.commit(b.clone(), &b));
        assert!(!h.can_undo());
    }

    #[test]
    fn new_edit_clears_redo() {
        let mut h = History::default();
        let mut b = Board::default();
        let before = b.clone();
        add(&mut b);
        h.commit(before, &b);
        h.undo(&mut b);
        let before = b.clone();
        add(&mut b);
        h.commit(before, &b);
        assert!(!h.can_redo());
    }
}
