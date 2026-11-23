//! Headless rendering for the add-ins: LaTeX to SVG, MathML, size and baseline.
//!
//! Owns: the hidden render page (ui/kernel), render batches, the cache of results.
//! Limits: no Office picture formats (the add-ins make them), no MathType pictures (core/convert).
