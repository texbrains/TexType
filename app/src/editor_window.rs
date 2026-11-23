//! The formula editor window, standalone or opened by an add-in for one formula.
//!
//! Owns: creating, warming and closing editor windows; passing the formula in and the result out.
//! Limits: the editor itself is ui/editor; what happens to the result belongs to `sessions`.
