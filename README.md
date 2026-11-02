# Viscereality Showcase control

Static hosting projection for the Viscereality Showcase phone controller.

Open [Viscereality Showcase](https://showcase.mesmerprism.com/showcase-control/) in Chrome on Android to install the controller. The headset must run the separate Showcase app and allow phone control.

This repository contains the reviewed browser shell and hosting configuration. Runtime changes are generated from the maintained application source; do not edit the projection directly. The shell caches its finite static resources for offline use. Pairing and headset control run locally.

GitHub Pages publishes the root of `main`. The custom domain is `showcase.mesmerprism.com`; the PWA identity, launch address and worker scope are `/showcase-control/`.
