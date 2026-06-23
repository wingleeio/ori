---
"@wingleeio/ori-core": patch
"@wingleeio/ori-react": patch
---

Improve editor responsiveness on the native typing path: keep plain keystrokes free of pre-paint model notifications, apply known native edits directly to the Y.Doc, move the custom caret imperatively with transforms, and speed up block/virtualizer lookups used by selection and measurement.
