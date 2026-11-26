# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Existing static HTML/CSS/JS mockup (no build step) for the viewer surface; the production target recorded in the mockup README is React + Vite + three.js.

## Users

Primary users are architects and BIM coordinators in a design office. They work at large desktop monitors in long sessions, comparing model versions, cutting sections, and saving layer states that structural, MEP, and architecture teammates reopen later. Secondary users are structural/MEP engineers checking layers and object data, and project owners reviewing the model.

Confirmed by the user on 2026-11-26: the primary user is the architect / BIM coordinator.

## Product Purpose

RhinoView makes a very large Rhino `.3dm` / BIM model viewable in the browser without desktop CAD. A 995.9 MB source file becomes a 118.9 MB GLB that loads in the viewer; the user inspects layers and materials, reads object data, cuts sections, switches file versions, and saves named layer sets. Success means a coordinator can answer "what changed, what is visible, and what does this section look like" in seconds, on a normal office machine.

## Positioning

A browser viewer built around the two things a Rhino/BIM coordinator actually repeats: version comparison and saved layer states. Each saved set is a shareable view of the model (visibility + section + camera), not just a checkbox list.

## Operating Context

- Office desktop, 1280–1920 px wide, mouse and keyboard; the current mockup is desktop-only (`min-width: 1180px`).
- Vietnamese interface copy; the demonstration project `260816_TPRO-SK_Full_ver1.3dm` carries Japanese layer names and a Japanese project context.
- Real demonstration figures: 995.9 MB `.3dm`, 118.9 MB GLB, 6,333,244 triangles, 46 layers, 27,400 objects, 630 materials, 1.4 / 10 GB project storage.
- Versions v1–v4 exist; v4 is still converting (62%), v3 is the version being viewed.
- Saved layer sets in the mockup: Toàn bộ, Kiến trúc, Kết cấu, Mặt bằng tầng 3 (Y 13.8 m cut), Mặt đứng trục A (X −8.4 m cut).
- The viewer is a work surface, not a marketing page: no onboarding, no pricing, no social proof.

## Capabilities and Constraints

- Topbar: brand, file name, version dropdown, search, notifications, "Tải phiên bản mới".
- Left rail: saved layer sets with counts and a create action; storage meter.
- Stage: model image, file chip, vertical tool strip, view cube, scale bar, object detail card.
- Right inspector: tabs Danh mục / Vật liệu / Mặt cắt; layer and material lists with swatches and counts; section axis picker (Ngang Y / Dọc X / Dọc Z), slider, flip, reset.
- Status bar: API latency, triangle/GLB/layer/object totals, WebGL/FPS.
- The user confirmed the redesign must keep the existing layout, content, and interactions. This is a visual-world replacement, not a re-architecture.
- The mockup uses a static screenshot of the model (`assets/model.png`, `assets/model_cut.png`); the real app renders three.js.
- No backend in the mockup; data is fixed demonstration data from the real file.
- The interface must never show internal keys (`uniquenum_pri`, raw IDs) to users.

## Brand Commitments

- Product name: RhinoView.
- Vietnamese interface copy, with technical terms kept in English where the office uses them (layer, triangle, GLB, WebGL).
- The user explicitly ruled out: a look that stays a generic SaaS dashboard; a flashy, effect-heavy surface. Precision and restraint are binding.
- No invented customers, benchmarks, prices, or capabilities.

## Evidence on Hand

- `report/inventory.md` — measured inventory of the real `.3dm` file.
- `report/mockup2_viewer.png`, `mockup2_saved.png`, `mockup2_section.png`, `mockup2_version_menu.png`, `mockup2_1280.png` — current mockup states.
- `mockup2/assets/model.png`, `model_cut.png` — real viewer captures used by the mockup.
- `mockup/README.md`, `tbim-viewer/README.md`, `web/` — earlier mockup and working POC viewers.
- No testimonials, customer logos, or press exist; future work must not fabricate them.

## Product Principles

1. The model is the subject; the interface is the instrument around it.
2. Precision reads as trust: exact numbers, aligned rules, stable positions.
3. State must be legible at a glance: which version, which layers, which cut, what changed.
4. Familiar tool placement beats novelty; the coordinator should not relearn the screen.
5. Never decorate a technical fact; make it easier to read.

## Accessibility & Inclusion

No product-specific accessibility standard has been established. The existing surface is desktop-only and must remain readable at 1280 px wide; keyboard access to tabs, the version menu, and the layer list should be preserved.
