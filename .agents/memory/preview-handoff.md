---
name: Preview-ready handoff
description: The environment-specific step needed to make uploaded app work appear in the Replit Preview surface.
---

Uploaded project files can be runnable in the conversation sandbox without creating a user-visible Preview option. For a persistent app preview, the work must live in a registered web artifact with its managed workflow running.

**Why:** Running the uploaded ZIP directly exposed a local server but did not create the normal project Preview surface.

**How to apply:** When an uploaded web app needs a Preview button, move or port it into a `react-vite` web artifact, restart its exact managed workflow, refresh logs, and present the artifact.