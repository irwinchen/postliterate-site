---
schema_version: 1
id: 2026-05-11-working-conversations-feed
title: "Designing the unified working-conversations dashboard feed"
date: 2026-05-11
project: site
message_count: 32
cowork_session_id: 436de40f-30d8-4b2c-a5a6-19fadd102727
chat_uuid: null
summary: |
  - Replaced two parallel Recent Work streams (cowork + claude.ai exports) with one chronological feed unified by a v1 normalized schema.
  - Added a new session-debriefs source that ingests YAML-fronted markdown produced by the session-debrief skill, with cowork_session_id linking back to the originating CLI session.
  - Hardened artifact extraction from `<antArtifact>` tags with path-traversal guards, size caps, and an admin.mjs route that forces HTML to text/plain.
artifacts:
  - name: conversation-store.mjs
    type: text/javascript
    title: "Conversation store helper"
    path: scripts/dashboard/lib/conversation-store.mjs
    link_kind: repo
  - name: artifact-extractor.mjs
    type: text/javascript
    title: "Artifact extractor helper"
    path: scripts/dashboard/lib/artifact-extractor.mjs
    link_kind: repo
---

Test debrief used during initial wiring of the working-conversations
pipeline. Safe to delete once a real debrief lands.
