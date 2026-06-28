# Changelog

## [1.12.0](https://github.com/115jon/ralph-meet/compare/v1.11.0...v1.12.0) (2026-06-28)


### Features

* **chat:** ✨ add direct instagram reel playback ([657b6c9](https://github.com/115jon/ralph-meet/commit/657b6c922abae8761fdacee1fbb6bc4cca9c467d))
* **embeds:** ✨ add instagram video support for shared embeds ([b5c4150](https://github.com/115jon/ralph-meet/commit/b5c4150e71a94165c0d270813ad6b078ec8fb03b))

## [1.11.0](https://github.com/115jon/ralph-meet/compare/v1.10.0...v1.11.0) (2026-06-28)


### Features

* **landing:** ✨ auto-fetch desktop releases from github api ([336c897](https://github.com/115jon/ralph-meet/commit/336c89782aec94a518855f02bba4dcd8840a6fdf))

## [1.10.0](https://github.com/115jon/ralph-meet/compare/v1.9.0...v1.10.0) (2026-06-28)


### Features

* **ui:** :lipstick: overhaul homepage interactive showcases and design system alignment ([8d623d5](https://github.com/115jon/ralph-meet/commit/8d623d50529239696b4ebcf551fb66a04d77df95))

## [1.9.0](https://github.com/115jon/ralph-meet/compare/v1.8.0...v1.9.0) (2026-06-28)


### Features

* **chat:** :sparkles: implement media safety filter and sensitive content blurring ([b0202b5](https://github.com/115jon/ralph-meet/commit/b0202b5db3b4b71368afaaa772f048f9a1dc1862))
* **chat:** ✨ add gif and sticker picker shortcuts ([e15990d](https://github.com/115jon/ralph-meet/commit/e15990da7737f98898ca47c614c15345a37456f0))
* **chat:** ✨ add klipy meme support to media picker ([f38d218](https://github.com/115jon/ralph-meet/commit/f38d218ebe234c81c5197a10bb08447af047a114))
* **chat:** ✨ add mp4 video favorites to clips ([3e5a48f](https://github.com/115jon/ralph-meet/commit/3e5a48fc1ffccc97d4da500e7e223bd09547c17f))
* **chat:** ✨ add per-user media content filters ([abb5d46](https://github.com/115jon/ralph-meet/commit/abb5d4629c34c1225887079eb4f7ccfe01f7bedf))
* **chat:** ✨ add trending entry and keyboard suggestions ([21cdcc4](https://github.com/115jon/ralph-meet/commit/21cdcc4767c74e27170b7cf42f29129a315652e9))
* **theme:** ✨ persist synced themes with preview drawer ([8e221c7](https://github.com/115jon/ralph-meet/commit/8e221c70747b2132173e76732900da9240f23136))
* **ui:** 🎨 add spider-man theme and fix emoji selection alignment ([780f0e0](https://github.com/115jon/ralph-meet/commit/780f0e0127e2eb8b13522194cd3430a7408222d1))


### Bug Fixes

* **chat:** 🐛 keep gif picker tabs from snapping back ([ceac6b8](https://github.com/115jon/ralph-meet/commit/ceac6b813e6c665a470a6d3cbcb7c9a78cd352d5))
* **chat:** 🐛 preserve clip duration and fix embed assertions ([4674d5a](https://github.com/115jon/ralph-meet/commit/4674d5ac1fda1aaf714b83ec5d7a897463916835))
* **chat:** 🐛 render embed emoji tokens and preserve selection ([742772c](https://github.com/115jon/ralph-meet/commit/742772c6473b2e8865366ebe99f71b81ceafacee))
* **soundboard:** 🐛 sync picker pause state with media controls ([c41ecf6](https://github.com/115jon/ralph-meet/commit/c41ecf63819779b355d6147ca80db9b7bbeeb782))


### Performance Improvements

* **vite:** ⚡️ make polling opt-in for local dev ([774a331](https://github.com/115jon/ralph-meet/commit/774a33182a7223d882337e4e27fb24b63dfb67a6))

## [1.8.0](https://github.com/115jon/ralph-meet/compare/v1.7.0...v1.8.0) (2026-06-27)


### Features

* **chat:** ✨ add recent reaction submenu for messages ([65ab523](https://github.com/115jon/ralph-meet/commit/65ab52394bccbe1615458a7972d9ead929504c5c))
* **theme:** :sparkles: add miku light and dark themes with accessibility improvements ([cff54dc](https://github.com/115jon/ralph-meet/commit/cff54dc51c8d82a3c005836bbaad4dc5eb769df5))


### Bug Fixes

* **chat:** 🐛 dedupe echoed message reactions ([01571a3](https://github.com/115jon/ralph-meet/commit/01571a387834ab6930f2762ce9960736ec8a73f1))
* **native-share:** 🐛 align process loopback audio init ([30359bf](https://github.com/115jon/ralph-meet/commit/30359bfe5a308887d4212230f7ca358ae2fcc30e))
* **native-share:** 🐛 stabilize wgc fallback and loopback audio ([9e5cd91](https://github.com/115jon/ralph-meet/commit/9e5cd915ec3c0213471c9ecee9a63e0da3b5ae34))
* **voice:** :bug: guard connected publisher sessions from global eviction ([a74bd41](https://github.com/115jon/ralph-meet/commit/a74bd4168961fdcf23f19f38c2e48aa24346dfa7))

## [1.7.0](https://github.com/115jon/ralph-meet/compare/v1.6.2...v1.7.0) (2026-06-25)


### Features

* **desktop-installer:** ✨ initialize c# installer bootstrapper ([118f8ab](https://github.com/115jon/ralph-meet/commit/118f8ab77f6f0485545a026b139bb9e12bd3f1a2))
* **desktop:** :building_construction: configure custom bootstrapper updater integration and release pipeline ([0cbe97f](https://github.com/115jon/ralph-meet/commit/0cbe97f1e3692ce182babbbe5b208fca2c6076da))
* **desktop:** ✨ implement standalone updater splash screen and fix window visibility ([78e8ca0](https://github.com/115jon/ralph-meet/commit/78e8ca063f30b56cd7778f8a871d2c4f91af1720))


### Bug Fixes

* **desktop:** :bug: fix window maximized flash on startup and resolve state restoration ([f6b6fcd](https://github.com/115jon/ralph-meet/commit/f6b6fcd39b5c3c2ecd31b1f6fd30dadf903d3c6c))
* **desktop:** :bug: prevent window maximize/fullscreen flash on startup ([5672e90](https://github.com/115jon/ralph-meet/commit/5672e90e79728d68d68562b169fa9b1f3a5478cf))
* **desktop:** 🐛 resolve updater window stacking and lifecycle issues ([6acf86e](https://github.com/115jon/ralph-meet/commit/6acf86e60fe68c7789d09ccea78610304438ea72))
* **desktop:** allow process loopback audio without game-capture-hook feature ([4b95ff1](https://github.com/115jon/ralph-meet/commit/4b95ff1ca383d449dc465ffc883565d63b7e883b))

## [1.6.2](https://github.com/115jon/ralph-meet/compare/v1.6.1...v1.6.2) (2026-06-24)


### Bug Fixes

* **desktop:** allow radio-browser in connect-src CSP ([a0e5fde](https://github.com/115jon/ralph-meet/commit/a0e5fde28be8c4a847d1d8381619d84fc1fb511f))

## [1.6.1](https://github.com/115jon/ralph-meet/compare/v1.6.0...v1.6.1) (2026-06-24)


### Bug Fixes

* **soundboard:** add radio to soundType typescript interfaces ([a5fa6b5](https://github.com/115jon/ralph-meet/commit/a5fa6b56c4ab878ea6431113a19a16e3b9e7f6cf))

## [1.6.0](https://github.com/115jon/ralph-meet/compare/v1.5.1...v1.6.0) (2026-06-24)


### Features

* **channel-sidebar:** ✨ show voice status as read-only for observers ([b0f5d19](https://github.com/115jon/ralph-meet/commit/b0f5d19147e9f3f6e5402cd5c93716330b95ce5b))
* **chat:** ✨ add animated send button to mobile message input ([ff69c12](https://github.com/115jon/ralph-meet/commit/ff69c12169f4bf0834b3f6852b3c2db26d1c0134))
* **chat:** implement fluid exit animations for more modals ([04aaa22](https://github.com/115jon/ralph-meet/commit/04aaa22c42102bfb211b96c945db071a369cbeb7))
* **chat:** improve mobile UX with fluid animations and hardware back support ([ab1ddbd](https://github.com/115jon/ralph-meet/commit/ab1ddbd4222285fc575147a5f451ae347b005e16))
* **desktop:** ✨ implement hybrid WGC pre-roll and process loopback audio ([5cf47ea](https://github.com/115jon/ralph-meet/commit/5cf47ea56b1317b620c056f96cd3f95d3b7c9831))
* **soundboard:** integrate Radio Browser API for live streaming stations ([ff60057](https://github.com/115jon/ralph-meet/commit/ff60057f008b0f1b0405842482264d4daf54a982))


### Bug Fixes

* **chat:** :bug: fix blank image previews for pasted and mobile uploads ([ca9332d](https://github.com/115jon/ralph-meet/commit/ca9332dd8257503054611a8e64fc8e22f6acecc9))
* **soundboard:** display radio station favicons and distinct styling in favorites view ([214c816](https://github.com/115jon/ralph-meet/commit/214c816b5037d03d6f8e5c74f56d862786120966))

## [1.5.1](https://github.com/115jon/ralph-meet/compare/v1.5.0...v1.5.1) (2026-06-23)


### Bug Fixes

* **chat:** 🐛 fix X embed inline video src url ([e80395a](https://github.com/115jon/ralph-meet/commit/e80395ab9dc2347381fa7b3ea2ebd9edb0c2d4aa))

## [1.5.0](https://github.com/115jon/ralph-meet/compare/v1.4.1...v1.5.0) (2026-06-23)


### Features

* **chat:** ✨ make X embeds with videos playable inline ([97f7f43](https://github.com/115jon/ralph-meet/commit/97f7f434920c8e708263ff1942cdf593f33155e5))

## [1.4.1](https://github.com/115jon/ralph-meet/compare/v1.4.0...v1.4.1) (2026-06-23)


### Bug Fixes

* **audio:** 🐛 suppress reconnect sound replays ([194554e](https://github.com/115jon/ralph-meet/commit/194554e0a1ed014976de4d1538639207ae553123))
* **ui:** :bug: prevent sticker reaction modal from growing horizontally ([e0e4284](https://github.com/115jon/ralph-meet/commit/e0e4284b53898321a522056af6a91f45aabdab41))

## [1.4.0](https://github.com/115jon/ralph-meet/compare/v1.3.1...v1.4.0) (2026-06-23)


### Features

* **share:** proxy TikTok embeds and improve oEmbed presentation ([5c7febc](https://github.com/115jon/ralph-meet/commit/5c7febcc54cf13499300b2cbf321d05dbf55194f))
* **soundboard:** ✨ add myinstants favorites and revamp now playing ui ([ad372d0](https://github.com/115jon/ralph-meet/commit/ad372d014e78031f1a7e8b0b1579effdec13adce))
* **soundboard:** ✨ revamp picker layout, favorites metadata, and add local previews ([e748fa5](https://github.com/115jon/ralph-meet/commit/e748fa53722c117633b62bc7b088bc5fafb8c8e1))
* **soundboard:** ✨ revamp ui, add metadata and light mode theming ([31647cc](https://github.com/115jon/ralph-meet/commit/31647cc1aed199e013291a89ffa6a6230b6e5459))
* **ui:** 💄 apply theme-aware glassmorphic styling to emoji picker ([881ef78](https://github.com/115jon/ralph-meet/commit/881ef7885448c5d7b7d623374d5c28b76162b76e))
* **ui:** 💄 apply theme-aware glassmorphic styling to gif picker ([fdfab43](https://github.com/115jon/ralph-meet/commit/fdfab4360cc0507eb4b23a9ebec86f36121293fd))


### Bug Fixes

* **share:** 🐛 prevent discord from hiding video descriptions via twitter:card ([98edf0b](https://github.com/115jon/ralph-meet/commit/98edf0b1c1825ac11d33ca48302e066a1edce072))
* **share:** proxy TikTok embed videos for Discord ([713e056](https://github.com/115jon/ralph-meet/commit/713e056a7995713f1e1354e57ae223b631ef1cbc))
* **share:** remove twitter:player to allow rich embeds with descriptions ([f5ad9f5](https://github.com/115jon/ralph-meet/commit/f5ad9f5a55febf224295e686c678e8be423b4dce))
* **soundboard:** :bug: prevent audio looping on network reconnect ([7e8d7af](https://github.com/115jon/ralph-meet/commit/7e8d7aff35f3b227f9005dfce6bfc5b53c987335))
* **soundboard:** use deterministic playback ID to optimize spam handling ([2e3dc82](https://github.com/115jon/ralph-meet/commit/2e3dc825a3474482d09dd3f237caab52f8fe3942))
* **ui:** 🐛 prevent soundboard tooltip from falsely triggering on focus restore ([456ba99](https://github.com/115jon/ralph-meet/commit/456ba99e85ad219673f98c351293ddfe8f3ef154))
* **ui:** 💄 standardize popover positioning and mobile bottom-sheet behavior ([4836366](https://github.com/115jon/ralph-meet/commit/4836366692e23865d90ee137395fbc069592faad))
* **ui:** resolve EmojiPicker clipping and standardize theme colors ([d2d420b](https://github.com/115jon/ralph-meet/commit/d2d420bc523dd4d03524719403dd6493a2d147cc))
* **voice:** allow fxtwitter and twimg external GIF hosts in VoiceAppEvent validation ([370afd1](https://github.com/115jon/ralph-meet/commit/370afd1fa75ac5c0e3ad662dbcdbe74cae1786c4))

## [1.3.1](https://github.com/115jon/ralph-meet/compare/v1.3.0...v1.3.1) (2026-06-22)


### Bug Fixes

* **share:** revert inline video and use theme colors for external embeds ([1456c45](https://github.com/115jon/ralph-meet/commit/1456c45e0615c112b8bd431a90f5f2ec10cbba8d))
* **voice:** 🐛 handle favorite gif status and reactions ([31fef7a](https://github.com/115jon/ralph-meet/commit/31fef7afbb5ac8de3dee3eb70ecc6d8b28a8f2aa))

## [1.3.0](https://github.com/115jon/ralph-meet/compare/v1.2.0...v1.3.0) (2026-06-21)


### Features

* **camera:** improve background segmentation accuracy and feathering ([24ba1de](https://github.com/115jon/ralph-meet/commit/24ba1de79027a6dff1f28335c3809c38892df467))
* **chat:** ✨ add server voice activity hover cards ([36a9bb9](https://github.com/115jon/ralph-meet/commit/36a9bb9d2d8f5ccc99a774f675f9a56b736e4a5b))
* **chat:** comprehensive emoji system with custom ai generation ([6c47fec](https://github.com/115jon/ralph-meet/commit/6c47fecf3e408c4d988e0c013ac6b1cdf952b156))

## [1.2.0](https://github.com/115jon/ralph-meet/compare/v1.1.1...v1.2.0) (2026-06-20)


### Features

* **voice:** add channel status and media vibes ([37185b0](https://github.com/115jon/ralph-meet/commit/37185b06a45822eeda447746c6a181172d45fc6e))

## [1.1.1](https://github.com/115jon/ralph-meet/compare/v1.1.0...v1.1.1) (2026-06-20)


### Bug Fixes

* **desktop:** mount update checker overlay ([8035e1c](https://github.com/115jon/ralph-meet/commit/8035e1c0584c7b250433e827a9f0a675a6b29a6e))

## [1.1.0](https://github.com/115jon/ralph-meet/compare/v1.0.3...v1.1.0) (2026-06-20)


### Features

* **chat:** add profile banners and nameplates ([7110bc5](https://github.com/115jon/ralph-meet/commit/7110bc551f68cf89b12b7eb27586a8d031b19fe0))


### Bug Fixes

* **chat:** preserve external and embedded media in channel media ([40648bc](https://github.com/115jon/ralph-meet/commit/40648bcc1f975994e382d67e1c3caf7327e73b61))
* **chat:** refresh external embed media and add viewer jump ([4f32efe](https://github.com/115jon/ralph-meet/commit/4f32efe2a3665d8b78c639e02f4bd52a7bebe746))
* **chat:** restore embed video controls and DMCA fallbacks ([644aaad](https://github.com/115jon/ralph-meet/commit/644aaad82835113696f7e1cb6110ba55b9113a1e))
* **chat:** stabilize virtual message jumps ([4b22d62](https://github.com/115jon/ralph-meet/commit/4b22d626dbcd419d4c1f0fb12dbfb066207a81d9))
* **ci:** use release-please changelog for github release ([3acbae4](https://github.com/115jon/ralph-meet/commit/3acbae40107f1b394df0808cb9a9f20f9d300e47))

## [1.0.3](https://github.com/115jon/ralph-meet/compare/v1.0.2...v1.0.3) (2026-06-19)


### Bug Fixes

* **desktop:** log fetch_update invocation ([ac75cb2](https://github.com/115jon/ralph-meet/commit/ac75cb2829f331271a6131b13459f53350b2017a))

## [1.0.2](https://github.com/115jon/ralph-meet/compare/v1.0.1...v1.0.2) (2026-06-19)


### Bug Fixes

* **ci:** fix PR label swap permission by using default token ([f1db2ff](https://github.com/115jon/ralph-meet/commit/f1db2ffc997af460f1dad206e69df09f6a16fd80))
* **ci:** trigger release-please for 1.0.2 ([5201083](https://github.com/115jon/ralph-meet/commit/5201083ef9e227120ea1e5b707e2117f71b03f7c))
* **desktop:** allow fetch_update and install_update IPC commands via ACL ([b2aeb1b](https://github.com/115jon/ralph-meet/commit/b2aeb1b2c8361927328614946ff7420dedc04b15))

## [1.0.1](https://github.com/115jon/ralph-meet/compare/v1.0.0...v1.0.1) (2026-06-19)


### Bug Fixes

* **ci:** handle autorelease labels to prevent blocks ([228f6cd](https://github.com/115jon/ralph-meet/commit/228f6cd0f3cea6f4f8b02c84de4b9d32be47d3ac))
* **ci:** trigger release-please after label removal ([753befc](https://github.com/115jon/ralph-meet/commit/753befc598ac07dec63ede8a49194d058152c858))
* **ci:** verify automated release pipeline ([08ca0b4](https://github.com/115jon/ralph-meet/commit/08ca0b4e66d4b892cf11d16d36cb5a671047f6ca))

## 1.0.0 (2026-06-19)


### ⚠ BREAKING CHANGES

* **voice:** The logging format in the browser console has changed significantly.
* **ws:** heartbeat wire format changed. Server and client must be deployed together.
* **api:** All `apiSuccess` calls now return raw JSON data instead of a `{ data }` wrapper. Client consumers relying on `res.json().data` unwrapping will now receive the direct object. `apiFetch` in `api-client.ts` no longer unwraps a `.data` field.

### Features

* ✨ thread sidebar ui polish and server settings fixes ([ee6464c](https://github.com/115jon/ralph-meet/commit/ee6464cc120a318892b93fe08263f6d9cb89c842))
* 🔌 auto-reconnect with full-screen splash overlay ([0ccdce8](https://github.com/115jon/ralph-meet/commit/0ccdce89eb9db5f588492305fbed3a3f8e3c39a0))
* Add optimistic UI for reactions, pins, and channel creation ([#16](https://github.com/115jon/ralph-meet/issues/16)) ([e43d764](https://github.com/115jon/ralph-meet/commit/e43d764055b6625f488e54d575da802c53ccd65f))
* **api:** ✨ apply global DO rate limit to uploads and invites ([28c7abc](https://github.com/115jon/ralph-meet/commit/28c7abceb88755576c400c97b93aed47eebf2906))
* **audio:** ✨ add shared spatial audio controls ([6bb8ca4](https://github.com/115jon/ralph-meet/commit/6bb8ca4a0af93172421d553f1724ec80f6d76e78))
* **audio:** ✨ improve explicit stream audio playback and always hear settings ([0cf62b0](https://github.com/115jon/ralph-meet/commit/0cf62b011875ef01129f8cbb193c0c521f4b1c26))
* **audit:** ✨ implement server audit log system ([021d750](https://github.com/115jon/ralph-meet/commit/021d75086f1dcd238b65d470e72a36c4a95f214c))
* **auth:** :sparkles: replace clerk with ralph auth ([410e777](https://github.com/115jon/ralph-meet/commit/410e7775035e55c75c0827ed183ab0ba70508f42))
* **auth:** ✨ add /sign-up route with preserved redirect context ([a776aae](https://github.com/115jon/ralph-meet/commit/a776aaef6effb5007547554dd23945c63284cc54))
* **auth:** protect chat routes and extract clerk theme ([011adb8](https://github.com/115jon/ralph-meet/commit/011adb850f687e2d283dec5e135577dd9524a51a)), closes [#12](https://github.com/115jon/ralph-meet/issues/12)
* **call:** :sparkles: navigate to dm channel on call accept ([aeae2b5](https://github.com/115jon/ralph-meet/commit/aeae2b5cac9ae2855381248f5d11f6a4e360679f))
* **call:** ✨ add "Start a Call" context menu with confirmation modal ([3b343ec](https://github.com/115jon/ralph-meet/commit/3b343ecbc0449d7c32ab6ea3545a549aa495eced))
* **call:** 🔊 stabilize SFU reconnection and cold-rejoin logic ([dfecd2f](https://github.com/115jon/ralph-meet/commit/dfecd2f05a786500bba358eca978d1024c5e4a13))
* **calls:** 💄 refine call UI states and context menus ([85bfd61](https://github.com/115jon/ralph-meet/commit/85bfd61e0289131b87e6c0ce51e8db15f119a084))
* **camera:** :sparkles: implement WebGL compositor and high-fidelity background blur ([dfd8253](https://github.com/115jon/ralph-meet/commit/dfd8253aea424f104352e5912f6d1adab2a2504a))
* **camera:** ✨ add animated camera backgrounds ([8cc193f](https://github.com/115jon/ralph-meet/commit/8cc193fa5021366e42c167133e9e4eecb359c319))
* **channels:** ✨ add drag-and-drop channel reordering ([769533e](https://github.com/115jon/ralph-meet/commit/769533e84ad2b5ce04fbacabfa1e07740681037c))
* **channels:** ✨ implement channel overview settings & Discord-style context menu ([f6761b2](https://github.com/115jon/ralph-meet/commit/f6761b2f448662a6e026df368a12fa4f54c1a1ab))
* **channels:** implement channel permission overrides ([73112e8](https://github.com/115jon/ralph-meet/commit/73112e839033d59a79737336d5782acc08aebc79))
* **chat:** :lipstick: render visual reconnection indicators for sidebar voice members ([66d89c7](https://github.com/115jon/ralph-meet/commit/66d89c70c9f6e7ca45b42940a96de9d73d0da671))
* **chat:** :sparkles: implement persistent search history in gif picker modal ([df1c1ba](https://github.com/115jon/ralph-meet/commit/df1c1ba2f424d4816d6e8a9c85e8e1caf2f99853))
* **chat:** :sparkles: improve X and TikTok embed presentation ([337b2e5](https://github.com/115jon/ralph-meet/commit/337b2e5906e07f92648ae3f1226d50e19314f674))
* **chat:** :sparkles: integrate desktop notification state synchronization on chat store events ([00f279c](https://github.com/115jon/ralph-meet/commit/00f279cc29b79a2e0769269f14ffb659bd46971b))
* **chat:** :sparkles: isolate user voice activity and visual reconnects in DM call region ([c739960](https://github.com/115jon/ralph-meet/commit/c73996007ade3aab2157d689105605ba4f6ff324))
* **chat:** :sparkles: scroll-position restore with debug instrumentation ([defe121](https://github.com/115jon/ralph-meet/commit/defe121b2ee6dd57f6caa86d8f4376c471e944e6))
* **chat:** :sparkles: support attachment counts in reply previews and enhance command menu search ([f6c19a4](https://github.com/115jon/ralph-meet/commit/f6c19a47385d38fd37bbd87ab2c15cb562ec15a4))
* **chat:** :sparkles: track message visibility to clear unread counts and improve scroll behavior ([ae39213](https://github.com/115jon/ralph-meet/commit/ae39213379ee1c1000338f3c3b2a4cf5f9442146))
* **chat:** ↕️ bi-directional infinite scroll in detached mode ([84bf3c0](https://github.com/115jon/ralph-meet/commit/84bf3c0161e445a6e7fda8dfaf41b0724fa3efba))
* **chat:** ✨ add arrow-up to edit last own message ([a0dec94](https://github.com/115jon/ralph-meet/commit/a0dec94af3ae26385265994d5cf35333ce72e63f))
* **chat:** ✨ add custom video player, channel drag reorder, and icon upload hardening ([9a76454](https://github.com/115jon/ralph-meet/commit/9a7645452408ba6935245a1364271ec9a2cf633f))
* **chat:** ✨ add GIF picker ([9407ae1](https://github.com/115jon/ralph-meet/commit/9407ae119ef0a08b9b8b5be482bb17200cf52479))
* **chat:** ✨ add klipy gif provider support ([7aec177](https://github.com/115jon/ralph-meet/commit/7aec177c91ce8b1ed0ffd5446d8e972996b220e0))
* **chat:** ✨ add quick switcher and harden access control ([4c375aa](https://github.com/115jon/ralph-meet/commit/4c375aa60433d17965fc02415ddd94b22c133c24))
* **chat:** ✨ add unread message separator and banner ([78dee6d](https://github.com/115jon/ralph-meet/commit/78dee6d05f828f5d17bd787bf5d2229da381d77c))
* **chat:** ✨ implement media cache, tab keep-alive, and clip play controls ([2c89380](https://github.com/115jon/ralph-meet/commit/2c89380e52a80a72a862625c805a50a903b26829))
* **chat:** ✨ implement message embeds and removal functionality ([6f8f15c](https://github.com/115jon/ralph-meet/commit/6f8f15c1410e325a239d48d2ba9defac50c42ff8))
* **chat:** ✨ implement real-time invites and dynamic user resolution ([ffcf080](https://github.com/115jon/ralph-meet/commit/ffcf080d80581db2783acacfae9abbc355506003))
* **chat:** ✨ interactive mentions with hover tooltips and profile popovers ([be9a44b](https://github.com/115jon/ralph-meet/commit/be9a44b2f8ed4ae195efb9a9c34a16430dae5d61))
* **chat:** ✨ mention autocomplete, rendering, and background fix ([7266890](https://github.com/115jon/ralph-meet/commit/7266890aba9a765bafe05c4ed2d5999082d82139))
* **chat:** ✨ show display names across chat surfaces ([0c0cc56](https://github.com/115jon/ralph-meet/commit/0c0cc561c8fb078d0a0145769cdba8070e9cee6b))
* **chat:** 🎯 anchor fetch for jump-to-unloaded-message ([d4b3889](https://github.com/115jon/ralph-meet/commit/d4b3889c895cfb6b0a5f51e08e10f8409963f6da))
* **chat:** 🐛 attempt to stabilize detached programmatic jump scroll ([e2f4232](https://github.com/115jon/ralph-meet/commit/e2f4232d013eca6ba7d7b9381121ce7893e474cf))
* **chat:** 🔊 add message received sound and unified audio interaction ([3f9b831](https://github.com/115jon/ralph-meet/commit/3f9b83124908df464d25929face58fab6dfb64fd))
* **chat:** 🔨 add ban option to message and member context menus ([be4ae62](https://github.com/115jon/ralph-meet/commit/be4ae629e6a292f623b0a45fa4578be4a3a54c7d))
* **client:** improve DM channel UI and details pane ([a5b119f](https://github.com/115jon/ralph-meet/commit/a5b119f72ebc9159868669ac8fe6e5a8b3d97eba))
* **db:** ✨ add display_name field to users and api endpoints ([4857c7d](https://github.com/115jon/ralph-meet/commit/4857c7d2aabd294bb1a7ac2e92b599a9458bd660))
* **db:** schema drift sync migration for production D1 ([79ebcee](https://github.com/115jon/ralph-meet/commit/79ebcee3f7c9519763920b332e388b7180553f1d))
* **demo-room:** ✨ add ephemeral chat with GIF support ([1609dda](https://github.com/115jon/ralph-meet/commit/1609ddac61bd03d4e6f62fcd90731ff4e898542b))
* **desktop:** :package: vendor mediapipe assets locally for CEF compatibility ([0774e2c](https://github.com/115jon/ralph-meet/commit/0774e2ca5e6c661d5f02b0cb8a24e766b24549a5))
* **desktop:** :sparkles: add desktop notification settings toggling and tray sync helpers ([0e67a0f](https://github.com/115jon/ralph-meet/commit/0e67a0fc8c7586cb7ad89b6e3583b91da7279c87))
* **desktop:** :sparkles: add native video device enumeration via media_devices ([1563398](https://github.com/115jon/ralph-meet/commit/156339848277662ea96ba5096e8eb143bb1a1a65))
* **desktop:** :sparkles: implement system tray notification overlays and badge counter ([9602149](https://github.com/115jon/ralph-meet/commit/96021497970b4af5a7d9afff658566e8ae43286e))
* **desktop:** :sparkles: integrate manual update checker UI in Settings ([bf89374](https://github.com/115jon/ralph-meet/commit/bf89374b5c8abcbc86586712602490478d0b9d0d))
* **desktop:** ✨ add native OS notifications and post-save profile refresh ([b39d8ae](https://github.com/115jon/ralph-meet/commit/b39d8aef6739b5f1f50fd670d7a9200d996629bb))
* **desktop:** ✨ add OS settings tab with autostart, close-to-tray, and start-minimized ([2043ac6](https://github.com/115jon/ralph-meet/commit/2043ac6e68992a771477c72b4bf8164ac3f63b1b))
* **desktop:** ✨ add Tauri 2 desktop client with cross-platform auth and WebSocket support ([3d39985](https://github.com/115jon/ralph-meet/commit/3d3998503bf407aa785111cdab4dceb5e264b537))
* **desktop:** ✨ add theme-aware desktop splash screen ([ca9c6e0](https://github.com/115jon/ralph-meet/commit/ca9c6e057559bebbda280f947ad434c0f5ce6670))
* **desktop:** ✨ implement native Windows invisible-tray hack via layered transparency ([536e956](https://github.com/115jon/ralph-meet/commit/536e9566f541dec403b3ebc08e8194334e9c6c7d))
* **desktop:** ✨ minimize to tray on window close ([97193a2](https://github.com/115jon/ralph-meet/commit/97193a258f8ef3aeab3403db135475a48566c4f7))
* **desktop:** ✨ open external links in system browser ([ed3f7af](https://github.com/115jon/ralph-meet/commit/ed3f7af328cd542774d1ab8b0cddd4672bf8d2a8))
* **desktop:** ✨ vendor tauri-plugin-notification and sync unread state ([9252e7d](https://github.com/115jon/ralph-meet/commit/9252e7d38f1f32c457602b5c109f03422efa7395))
* **desktop:** ✨ Vulkan game capture + Discord-compatible hooking ([602509e](https://github.com/115jon/ralph-meet/commit/602509e4d3a8551d2058c2e50744085c353de136))
* **desktop:** 🏗️ migrate tauri renderer from webview2 to CEF ([ad18de8](https://github.com/115jon/ralph-meet/commit/ad18de869a45eb7667c08e37d8875c2dbf1cdcd7))
* **desktop:** 💾 persist window size and position across restarts ([45718b7](https://github.com/115jon/ralph-meet/commit/45718b7ec9851dd5ed7830fbaf0ee0de51ae3c79))
* **desktop:** 🔄 wire auto-update via tauri-plugin-updater ([9919623](https://github.com/115jon/ralph-meet/commit/9919623a9d0fc99ec541430e89861c34f8572a08))
* **desktop:** 🔐 browser-based sign-in with native Clerk sessions ([2f3e4cf](https://github.com/115jon/ralph-meet/commit/2f3e4cf54f2ae72331f5e931ded2ffee13e66918))
* **desktop:** 🔔 add system tray with unread notification badge ([f37e84c](https://github.com/115jon/ralph-meet/commit/f37e84c1b1111c58e37c8b44a8f620bc5255caa5))
* **desktop:** 🔗 invite deep-links + reworked invite UI with accept button ([28ce0b0](https://github.com/115jon/ralph-meet/commit/28ce0b0fb934514ca9647e0e2d9aef282abdfc90))
* **desktop:** implement hardware-accelerated WMF H.264 encoder for screen sharing ([787e321](https://github.com/115jon/ralph-meet/commit/787e3216bb9fafebe86795ded9aeb824ef91d834))
* **desktop:** zero-overhead native game-capture hook screen share ([32aec68](https://github.com/115jon/ralph-meet/commit/32aec687e4e007dacc6dea78be0ff76a5245cef7))
* **embeds:** :sparkles: add on-demand direct TikTok player with iframe fallback ([ab44a89](https://github.com/115jon/ralph-meet/commit/ab44a89201bd1b68c7c48211fcd0653f3fdcf90c))
* **embeds:** :sparkles: TikTok oEmbed player URLs and custom video controls ([5087aee](https://github.com/115jon/ralph-meet/commit/5087aee4b653817a3bc385c976eeb5b4ba9b8919))
* **gif:** :sparkles: add search suggestions and autocomplete to gif picker ([1415af3](https://github.com/115jon/ralph-meet/commit/1415af3f3340d20b25a5d7526c792b9f1bc250e6))
* **gifs:** :sparkles: add back button from search to categories ([9cb1875](https://github.com/115jon/ralph-meet/commit/9cb18758966bcea24dd0f54ccbfc6ba27c2e9120))
* **gifs:** :sparkles: stabilize clip detection and persist duration in favorites ([0a1cffc](https://github.com/115jon/ralph-meet/commit/0a1cffc69e12bba13485c1993ab4fb0751ac43a6))
* **home:** ✨ overhaul Home/DM UX with full-width FriendsView ([84ed315](https://github.com/115jon/ralph-meet/commit/84ed3157660bb21e28ae74b707b29e1702de4289))
* implement RBAC roles system and enhance user profiles ([1d09fb8](https://github.com/115jon/ralph-meet/commit/1d09fb8d7139da429215d25b58cf5d5d52089743))
* **mobile:** :iphone: enforce safe area padding across chat components ([8cd15e2](https://github.com/115jon/ralph-meet/commit/8cd15e262ec786568a15381207b45c72f3d22db5))
* **mobile:** :lipstick: refine UI components for mobile responsiveness ([86071a6](https://github.com/115jon/ralph-meet/commit/86071a606c0c611d33b51941b76737e1e7edfedd))
* **mobile:** ✨ add full-screen profile sheet for mobile member views ([24063b1](https://github.com/115jon/ralph-meet/commit/24063b1b56642d42d2d604b76d38ea1ba47f8932))
* **mobile:** ✨ fix Clerk auth flow with session persistence ([45173f3](https://github.com/115jon/ralph-meet/commit/45173f3097939cb50c0476607c0528931b60c69b))
* **mobile:** ✨ implement safe area view with tauri plugin ([bab70fb](https://github.com/115jon/ralph-meet/commit/bab70fb91e23d6102a12bd9a1a2e6cf0695ed3f2))
* **mobile:** use native onBackButtonPress API for Android navigation ([b98400d](https://github.com/115jon/ralph-meet/commit/b98400d6563210c36cd67b1e062d6479c2f5b412))
* **notifications:** ✨ add Discord-style notification badges across UI ([f8d68a7](https://github.com/115jon/ralph-meet/commit/f8d68a7a52c8e9808821bb9256dfceb060e5b223))
* **notifications:** ✨ add quick win UX enhancements ([087436b](https://github.com/115jon/ralph-meet/commit/087436bf05dfc4f181d4866865b16d9ca2a1f936))
* **notifications:** 🔔 add [@mention](https://github.com/mention) and reply notification system ([14e4ba9](https://github.com/115jon/ralph-meet/commit/14e4ba9ad98c0573a093ea7c6c9047c22df4e791))
* **profile:** :sparkles: broadcast updated_at on avatar change and profile sync ([7a64c3c](https://github.com/115jon/ralph-meet/commit/7a64c3c9c8c2cfc5d3ced346e7966f0bd7a3cbe3))
* **profile:** display mutual friends and servers with avatars ([9a86603](https://github.com/115jon/ralph-meet/commit/9a866033cfc87ccf80c0be9f356146c2515032f3))
* rebuild demo room on modern voice components ([d649c4f](https://github.com/115jon/ralph-meet/commit/d649c4f8df0958be2a40e94c9db4e5dae90049de))
* resolve desktop build asset URLs ([5e614a9](https://github.com/115jon/ralph-meet/commit/5e614a91fd9151cad0189ad729bc9e236727a90a))
* **screen-share:** ✨ wire change source button to desktop screen picker ([b1f894d](https://github.com/115jon/ralph-meet/commit/b1f894d1f5e0605174775f326b9d1a81f5c5b194))
* **screenshare:** ✨ unify desktop and web screenPicker modals ([fca36c2](https://github.com/115jon/ralph-meet/commit/fca36c24c4dfdb80cbfcd918c3c1e68843dacb18))
* **scroll:** ♻️ implement correct scroll restoration & read state logic ([09a5065](https://github.com/115jon/ralph-meet/commit/09a50655fb6d4ff07b617e8f9059c16f3e681483))
* **security:** 🔒 add rate limiting, ban system, and permission helper ([6120011](https://github.com/115jon/ralph-meet/commit/6120011d7ae07f1d399ffca8636348531324f772))
* **server:** ✨ add server icon upload with R2 storage ([dbc7dea](https://github.com/115jon/ralph-meet/commit/dbc7dea97205b2a5406bf95b2c0f54e53811f8e0))
* **settings:** implement devices tab with clerk session management ([a4619fe](https://github.com/115jon/ralph-meet/commit/a4619fe82241a5cbfc1b61ad12407d139e8b97cf))
* **sfu-client:** 🏗️ add WebRTC fault tolerance with grace timers and network recovery ([b4f0720](https://github.com/115jon/ralph-meet/commit/b4f072079c0250b3b5fc9a1cbcaa0dc14caed8be))
* **share:** :sparkles: add public message snapshots ([37966d4](https://github.com/115jon/ralph-meet/commit/37966d4d4207017be070e3a9ee377a42ac0829c0))
* **soundboard:** ✨ add pause/resume, volume control, and mute sync ([9d41dca](https://github.com/115jon/ralph-meet/commit/9d41dca9506758df71c9fd65c07b132087c754f1))
* **soundboard:** ✨ persist server soundboard clips ([b03626d](https://github.com/115jon/ralph-meet/commit/b03626dac7ab09f934c5a907b8d8524485f034ac))
* **sounds:** ✨ add synthesized sound effects for voice and notifications ([6403577](https://github.com/115jon/ralph-meet/commit/6403577385311768818e6689c79fb1b30e3139a9))
* **threads:** ✨ add message thread sidebar with reply count badges ([fdc28bf](https://github.com/115jon/ralph-meet/commit/fdc28bf10b7ee7c8da4cb7dce34b06a5c0d35b64))
* **ui:** :sparkles: display names, link context menu, and voice channel routing ([a242c65](https://github.com/115jon/ralph-meet/commit/a242c65016beb86628319952b9b05d9d1e307107))
* **ui:** ✨ add stream loading indicator ([f8809f3](https://github.com/115jon/ralph-meet/commit/f8809f307e74d6c0154830707c7082b3c2f7f48d))
* **ui:** ✨ integrate universal splash screen across web and desktop ([eaebb14](https://github.com/115jon/ralph-meet/commit/eaebb14b1609a93aa297937101e5b0626b231091))
* **ui:** ✨ remove uptime counter from dm call ui ([c580cfe](https://github.com/115jon/ralph-meet/commit/c580cfeccd1802b435d50a4d2384e85d1671344d))
* **ui:** ✨ update chat and member lists to prioritize display names ([967dd38](https://github.com/115jon/ralph-meet/commit/967dd38ab9a64f3de2f9edfe220ef6edafd8c5f7))
* **ui:** 🎨 custom video player for media viewer ([5e47264](https://github.com/115jon/ralph-meet/commit/5e472641368232fac0b0ea6a2f63f66b4b5742d2))
* **ui:** 🎨 revamp DM call region and unified voice grid ([293c32e](https://github.com/115jon/ralph-meet/commit/293c32e5c1b842f6b56f69cf3741e645f52e2952))
* **ui:** 🎬 add video support to media tab and image viewer ([026d3e0](https://github.com/115jon/ralph-meet/commit/026d3e0a467ecf4931613d7189a2643d30334112))
* **updater:** :sparkles: integrate tauri updater plugin with CI release pipeline ([b32c826](https://github.com/115jon/ralph-meet/commit/b32c8260ec77092aadb443aa093db609c90c1438))
* **uploads:** ✨ unrestricted file uploads with smart file icons ([9ea4d9d](https://github.com/115jon/ralph-meet/commit/9ea4d9dc55a21100149d28cdea74e853b0c600da))
* **voice:** :sparkles: add activities and soundboard controls ([3fd316a](https://github.com/115jon/ralph-meet/commit/3fd316a295fb6a0e3fbddb09cce310c54d5f10c9))
* **voice:** :sparkles: support clerk-less room modes, set track controls, and restore voice DTX ([e20e7b2](https://github.com/115jon/ralph-meet/commit/e20e7b230cdb808742393f00e410f7543c2f14ff))
* **voice:** ⚡️ optimize latency and implement scoped logging ([93144c4](https://github.com/115jon/ralph-meet/commit/93144c41873173ce3f111040922acbe7f651f751))
* **voice:** ✨ add real-time GIF/sticker/clip reactions in voice calls ([df032f1](https://github.com/115jon/ralph-meet/commit/df032f1c1af362d89d5cfe21c254291094e0cff0))
* **voice:** ✨ add server-side uptime tracking for voice channels and calls ([d244885](https://github.com/115jon/ralph-meet/commit/d244885aa11702da8192638291873160424e4145))
* **voice:** ✨ add voice switch confirmation modal ([8790896](https://github.com/115jon/ralph-meet/commit/8790896f7ca529cfaad35399c6f55d7b298fd02a))
* **voice:** ✨ sync VAD sensitivity and add mic test widget ([be6f5a5](https://github.com/115jon/ralph-meet/commit/be6f5a5e4cdd841930f423853b10f42f99aca538))
* **worker:** :sparkles: implement voice reconnect grace period and dynamic alarm scheduling ([1a946e0](https://github.com/115jon/ralph-meet/commit/1a946e040ee4c72561d98b929d85250dddd60de4))
* **worker:** 🔧 create custom server entry with DO exports and WS routing ([ad2860b](https://github.com/115jon/ralph-meet/commit/ad2860b42315cf821ffd1ede8d244cbe3d1f4f99))


### Bug Fixes

* `scrollToIndex` and `initialTopMostItemIndex` now correctly add `firstItemIndex` to the 0-based array index. ([4812872](https://github.com/115jon/ralph-meet/commit/4812872e0c124231643572e1267507a05bf7683a))
* 🐛 fix server icon 404, thread sidebar layout, and reply count updates ([2d43e6f](https://github.com/115jon/ralph-meet/commit/2d43e6fd99bd7bc506dcbf07f29eacdef28d8605))
* 🐛 misc fixes for media devices, voice settings, and modal components ([9bea61b](https://github.com/115jon/ralph-meet/commit/9bea61bb6b0f76e17af7e55bad2270da0ab40d41))
* 🐛 reload data on gateway reconnect + add updater permissions ([c6a6eec](https://github.com/115jon/ralph-meet/commit/c6a6eec77276c2ebcd0258b55b083748aa09192c))
* 🐛 resolve TypeScript errors in service layer type signatures ([de1a2a2](https://github.com/115jon/ralph-meet/commit/de1a2a2cb78aadd00305c0a1fdbe1047fca7526f))
* 🔧 add client-side shims for server/desktop-only modules ([d2c3bb0](https://github.com/115jon/ralph-meet/commit/d2c3bb089b62977c1936cf9fe847f9aadfa767a4))
* **api:** :bug: fix desktop camera backgrounds CORS cache-poisoning ([7d9d1d5](https://github.com/115jon/ralph-meet/commit/7d9d1d5df248d14d95b3e687dcd909a426ec31c4))
* **api:** 🐛 fix media tab returning empty results ([a24ff68](https://github.com/115jon/ralph-meet/commit/a24ff68a9e1d11c6b96a4070794f57cf1d9a2605))
* **api:** 🔒 close permission gaps and DRY up inline permission queries ([0fe710d](https://github.com/115jon/ralph-meet/commit/0fe710d40233afc25818cd27a4401a2f8c71859f))
* **api:** 🔒 enforce SEND_MESSAGES, ADD_REACTIONS, ATTACH_FILES permissions ([211cdd5](https://github.com/115jon/ralph-meet/commit/211cdd52139908284a293555b0c050a309a2cc97))
* **api:** Unwrap JSON '{ data }' envelope returned from apiSuccess in all fetch actions ([60d691f](https://github.com/115jon/ralph-meet/commit/60d691f5c9b64ed4fb2c4fbcbd756dde54094e29))
* **app:** :bug: prevent logout restore and update cta ([263cb56](https://github.com/115jon/ralph-meet/commit/263cb56f454b020e485ea0ed5773c92177bb2c82))
* **audio:** ⚡️ implement websocket resume grace period and hibernation optimizations ([a8d35a9](https://github.com/115jon/ralph-meet/commit/a8d35a9c62bf81ee3004f0ed73231c49ac2dfb3a))
* **audio:** rework chromium stereo mic and noise gate constraints ([5f47e5c](https://github.com/115jon/ralph-meet/commit/5f47e5c12e17f56fd3fc33106a30fd5fadfb5219))
* **auth:** :bug: finish kova auth rebrand ([ec301c5](https://github.com/115jon/ralph-meet/commit/ec301c51ec61bf651b6829d47f9ddc788deefe2d))
* **auth:** :bug: migrate meet to kova auth ([53927fc](https://github.com/115jon/ralph-meet/commit/53927fc59baefe008dca2f45a8ce334840e3dc4e))
* **auth:** :bug: stabilize Ralph Auth handoff ([150b4a2](https://github.com/115jon/ralph-meet/commit/150b4a2ab9736f12a772629f3c84db9caf18a9cb))
* **auth:** :bug: use app-local sign-out to preserve desktop session ([ea2b473](https://github.com/115jon/ralph-meet/commit/ea2b4737a0299d57abf7ce72487e60d96d823e2f))
* **auth:** 🐛 prevent tokenless desktop handoff ([ecab9d7](https://github.com/115jon/ralph-meet/commit/ecab9d71f11aadccdcaa711edb8c033cba5d709c))
* **auth:** 🔧 fix Clerk env var name and router getRouter export ([4a04a3c](https://github.com/115jon/ralph-meet/commit/4a04a3c3e3113c2e6056e300909f4d5f3123dbc5))
* **avatar:** merge D1 profile on load to prevent Clerk sync race conditions ([c9a3108](https://github.com/115jon/ralph-meet/commit/c9a31088a898d17b11ee82a3be94f8a868dc20fb))
* **build:** replace ralph-auth vite alias with vendored packages/kova-react ([b37aefd](https://github.com/115jon/ralph-meet/commit/b37aefd63b656d5f0cc31c7c6c43b0d27b6adb01))
* **call:** :bug: resolve diagonal tearing artifact in Chromium ([a06ef04](https://github.com/115jon/ralph-meet/commit/a06ef042e72106ac7d9384f8be1ccba5604961d9))
* **call:** :lipstick: refine UI presentation during ringing states ([44556b2](https://github.com/115jon/ralph-meet/commit/44556b26730ddce9ced15fc419402334ae7381b4))
* **call:** allow caller to stay when callee declines and make UI theme-aware ([92121a1](https://github.com/115jon/ralph-meet/commit/92121a1012a8b8f537122b3fea8b251204e61c24))
* **call:** allow users to stay in active calls when partner leaves ([8a51736](https://github.com/115jon/ralph-meet/commit/8a5173652a1e050603a2c9336f2502b4de5e2d05))
* **chat:** :bug: constrain invisible status cutout to badge ([d5c7499](https://github.com/115jon/ralph-meet/commit/d5c74993ef5d856316e7a2cf92b2aacb773ff8af))
* **chat:** :bug: fix gif picker layout shifts and recursive load-more loops ([9dc763d](https://github.com/115jon/ralph-meet/commit/9dc763d9381182afaf5ad2cf167ac8137dde1639))
* **chat:** :bug: remove duplicate screen share modal import ([86b7ccf](https://github.com/115jon/ralph-meet/commit/86b7ccf485d66de564e5e1382b2f6ba8896c1016))
* **chat:** :bug: use stable tiktok player embeds ([4ba1f86](https://github.com/115jon/ralph-meet/commit/4ba1f860a99f368321c6d299a893646dc505e96c))
* **chat:** ✨ atomic cursor navigation and input alignment ([5b11891](https://github.com/115jon/ralph-meet/commit/5b11891853142669be5c4334535f261cc573f65a))
* **chat:** 🐛 fix auto-scroll anchoring when message height changes ([268359e](https://github.com/115jon/ralph-meet/commit/268359eaafbc6160ed7e5c39f7a71ca7a2de2970))
* **chat:** 🐛 fix itemContent index crash during forward pagination ([31dce3b](https://github.com/115jon/ralph-meet/commit/31dce3b854ea3e2c51f06b7c522481a6eaaf47dc))
* **chat:** 🐛 fix jump from detached anchor to detached anchor ([daca97e](https://github.com/115jon/ralph-meet/commit/daca97e44a182c8e2ab25473c35d1e67f523fffa))
* **chat:** 🐛 fix jump-to-loaded-message inside detached window ([4812872](https://github.com/115jon/ralph-meet/commit/4812872e0c124231643572e1267507a05bf7683a))
* **chat:** 🐛 fix virtuoso initial scroll by forcing remount on anchor hops ([5074e42](https://github.com/115jon/ralph-meet/commit/5074e420038fcfa26c490c79adaad3a01c64f1cf))
* **chat:** 🐛 harden role and moderation enforcement ([c6dc897](https://github.com/115jon/ralph-meet/commit/c6dc89776d6a8bea9a4cfc3281ef735ebdda3664))
* **chat:** 🐛 keep display names in social payloads ([92fc704](https://github.com/115jon/ralph-meet/commit/92fc70439ae76f4ff9d8a4cf8f3562d97645b8ff))
* **chat:** 🐛 mention navigation, undo history, and tooltips ([99ff668](https://github.com/115jon/ralph-meet/commit/99ff6689ed8170a8a4292810e671d696bb836c14))
* **chat:** 🐛 mention undo history, bounds, and tooltip bg ([f670360](https://github.com/115jon/ralph-meet/commit/f6703606411ea18c876dc4d601ce19678969ff7d))
* **chat:** 🐛 preserve display names across realtime surfaces ([0912811](https://github.com/115jon/ralph-meet/commit/09128111de0f03b3fee0c2b76087c16880ffd02d))
* **chat:** 🐛 prevent video attachment from causing horizontal overflow ([1bfd204](https://github.com/115jon/ralph-meet/commit/1bfd2043681bb59a7968f6dc69608314d24bada7))
* **chat:** 🐛 refine mention behavior and UI ([8d451a0](https://github.com/115jon/ralph-meet/commit/8d451a0e72364bfb3888c1b1b8a8fe1eb5796400))
* **chat:** 🐛 replace react-virtuoso with virtua and fix scroll restoration ([6a80059](https://github.com/115jon/ralph-meet/commit/6a8005973ca363493b8bcdea265fccd671988a08))
* **chat:** 🐛 resolve remaining display name flashes ([1e42422](https://github.com/115jon/ralph-meet/commit/1e4242283963c4d257de2d36a73d6ba1d18f4737))
* **chat:** 🐛 resolve state sync and list rendering issues ([fd3a4d5](https://github.com/115jon/ralph-meet/commit/fd3a4d5ea1ac8eaf56aaa2cfaa508d13e542e546))
* **chat:** 🐛 resolve typing input re-render cascade and 204 parse error ([6b54e07](https://github.com/115jon/ralph-meet/commit/6b54e07d1830ab7b77b09e2c61d04551ef5e29c7))
* **chat:** 🐛 robust twin-div mention input architecture ([1bb9f71](https://github.com/115jon/ralph-meet/commit/1bb9f71269d6b7929b05513993b90958955383f6))
* **chat:** 🐛 sync member role updates ([9a70f56](https://github.com/115jon/ralph-meet/commit/9a70f5698b387604c5bfc85a0005dd3855d50ad8))
* **chat:** 🐛 track firstItemIndex as state to fix forward pagination ([d78c5b1](https://github.com/115jon/ralph-meet/commit/d78c5b1c01544c48265838efc25ef52a57b24e86))
* **chat:** 💄 improve URL handling and prevent mention triggers in links ([59cff3c](https://github.com/115jon/ralph-meet/commit/59cff3ca18a3f83a6b55ddb0baeb46fbd5fc4d00))
* **chat:** resolve Zustand render loop & gateway instability ([863be80](https://github.com/115jon/ralph-meet/commit/863be80bbf70c67c558a546b37d46afbf3f199b8))
* **client:** Local avatar UI now instantly reflects custom uploads ([6574edc](https://github.com/115jon/ralph-meet/commit/6574edce0748bfcb345085121f998e6b6a3c6935))
* conditionally apply tauri shims so real native plugins actually load in the Tauri environment ([d24cde5](https://github.com/115jon/ralph-meet/commit/d24cde56de5192ff0f3952ea9497be9888bd36d4))
* **deps:** remove remaining file: ralph-auth refs from mobile and lockfile ([917a4df](https://github.com/115jon/ralph-meet/commit/917a4dffdcfedfe61cbf52f10266c47f20e8db64))
* **desktop-auth:** 🐛 stabilize native session handoff ([0486415](https://github.com/115jon/ralph-meet/commit/048641578f596cb155d915ea77ef1663c2b80ae4))
* **desktop-cef:** :bug: restore stable gpu compositor startup ([f6fe95a](https://github.com/115jon/ralph-meet/commit/f6fe95a37fe09e33d54d493a2550c297bdad9eab))
* **desktop:** :bug: harden login listener cleanup and add voice join tracing ([737e6eb](https://github.com/115jon/ralph-meet/commit/737e6eb35b2f3c349d271ac146f50c9b69171c9c))
* **desktop:** :bug: preserve recovery screen sharing work ([5d238ba](https://github.com/115jon/ralph-meet/commit/5d238ba3bb68e41d68326cbfdd1a25e6bfa259b3))
* **desktop:** :bug: preserve source changes while streaming ([00b24a0](https://github.com/115jon/ralph-meet/commit/00b24a0bfb5ac687dd4dc77582413b68b3bcc07c))
* **desktop:** :bug: ship working CEF desktop installer ([8be2b4d](https://github.com/115jon/ralph-meet/commit/8be2b4d4999476de51b3aba5faf26bf19946d80b))
* **desktop:** :bug: stabilize screen share control path ([e2b5823](https://github.com/115jon/ralph-meet/commit/e2b582333dcf3f1b9ac4dab1692790ba6aa7d357))
* **desktop:** 🐛 auto-retry API calls on 401 with fresh Clerk token ([eaf2fff](https://github.com/115jon/ralph-meet/commit/eaf2fffa7985bc24dba062499d30aec3b5c27dba))
* **desktop:** 🐛 avoid stripping origin for external media urls in tauri ([0d87825](https://github.com/115jon/ralph-meet/commit/0d87825570eba2abff2a3a152458ed374ee410c4))
* **desktop:** 🐛 commit game-capture hook on real present, not install ([9fed1cd](https://github.com/115jon/ralph-meet/commit/9fed1cd59f770a3587cb8360a4a4f3aec951bf75))
* **desktop:** 🐛 correct kova-react alias path in desktop config ([17a4e7d](https://github.com/115jon/ralph-meet/commit/17a4e7d8d0d93593b4b7f005411abdf89fa17c30))
* **desktop:** 🐛 fix title bar repaint and devtools dark mode ([10a5299](https://github.com/115jon/ralph-meet/commit/10a52994991f86d8d12dff7b54f33784371c740f))
* **desktop:** 🐛 fix WebSocket connectivity, fonts, auth, and settings crashes ([e197648](https://github.com/115jon/ralph-meet/commit/e1976480ff8d0d77aa58528da8e401e60d48183f))
* **desktop:** 🐛 resolve tauri plugin build and ui layout failures ([6ace30e](https://github.com/115jon/ralph-meet/commit/6ace30ed7e2316f10e5c3d360675db2a6ff8f7b6))
* **desktop:** 🐛 resolve video seeking and tauri production origins ([e9fa832](https://github.com/115jon/ralph-meet/commit/e9fa832cc21e80ba885699575efdc2e0043e4aa0))
* **desktop:** 🐛 revert close-to-tray — blocked by CEF runtime ([ab59cfe](https://github.com/115jon/ralph-meet/commit/ab59cfedfd61468025ea90cf058e2f4abc2b1efc))
* **desktop:** expose full audio device list in the picker ([f8fd46e](https://github.com/115jon/ralph-meet/commit/f8fd46e9d329ab37c430a6a756b9b58d3d35f330))
* **desktop:** register ralphmeet:// deep link scheme during dev ([57b1df5](https://github.com/115jon/ralph-meet/commit/57b1df591c0506ba6065b137012bbd9954a9d661))
* **desktop:** resolve CORS and deep-link auth issues for local development ([833ea79](https://github.com/115jon/ralph-meet/commit/833ea79ebb352ce1725df42f6233aef1b10a7519))
* **do:** 🐛 add replay buffers to channel/server/user broadcasts ([4056247](https://github.com/115jon/ralph-meet/commit/4056247f9861ef84ec5c9c971c3706451d8d184c))
* **embeds:** :bug: proxy x video media playback ([63120b6](https://github.com/115jon/ralph-meet/commit/63120b6ec2f7151806ce5dfd3b56ab85df671c77))
* **embeds:** :bug: remove sandbox from YouTube and TikTok iframes ([e743d31](https://github.com/115jon/ralph-meet/commit/e743d3148f0e487aab9e47e479bd45b1797fbf51))
* **embeds:** :bug: render YouTube Shorts in portrait aspect ratio ([5363faf](https://github.com/115jon/ralph-meet/commit/5363fafc7fe81221e24ed3c0ac402c9e817dc23c))
* **embeds:** :bug: use custom video player for TikTok direct mode ([8d3825b](https://github.com/115jon/ralph-meet/commit/8d3825b223baeebea8c102a95060d97c3dca6ed0))
* **embeds:** 🐛 dedupe x videos across metadata sources ([1e9185d](https://github.com/115jon/ralph-meet/commit/1e9185d9b7a331a9aee8ec7961507696e3b1471e))
* **embeds:** 🐛 detect youtube portrait dimensions ([94c50a6](https://github.com/115jon/ralph-meet/commit/94c50a6a554b2829336be857314659beab64a568))
* **embeds:** 🐛 fix embed size when inline-block shrink-wraps ([5aabc4b](https://github.com/115jon/ralph-meet/commit/5aabc4be64e6ab3500a73c71bd5f4105b8889956))
* **embeds:** 🐛 match X gif behavior and alt text ([a60416d](https://github.com/115jon/ralph-meet/commit/a60416dbddc67acc6c13d801b419a5a684d3d92d))
* **embeds:** 🐛 render complete X media embeds ([13eba26](https://github.com/115jon/ralph-meet/commit/13eba265bc7c465f31d51c9ed56c5602fbf1e66b))
* **embeds:** 🐛 render mixed x media grids correctly ([fda8b1b](https://github.com/115jon/ralph-meet/commit/fda8b1be48c7d4f0e8fc3025312ecb316b97952c))
* **embeds:** 🐛 use shared media viewer for X embeds ([05e2235](https://github.com/115jon/ralph-meet/commit/05e2235b202df19cde7d77b18201d22801b4b65a))
* **gateway:** 🐛 fix voice channel dropping on server switch & duplicate logs ([cf3a5a8](https://github.com/115jon/ralph-meet/commit/cf3a5a81cd255572323700cbb0ba6bcefa5974ea))
* **gateway:** await notification promise on dispatch ([df9c61e](https://github.com/115jon/ralph-meet/commit/df9c61ed11e7fc2a1fcfd657b40913a4ed0c897a))
* **gif-picker:** :bug: isolate stickers and gifs in favorites and media type search ([7a1ac88](https://github.com/115jon/ralph-meet/commit/7a1ac8816abf7767e483c6a428eec666cdfdbff5))
* **gifs:** 🐛 match sent x gif favorite identities ([ac62ebd](https://github.com/115jon/ralph-meet/commit/ac62ebdcb69813a8ba3c403e3c3adcffeb45af93))
* **gifs:** 🐛 preserve favorite state on sent gifs ([9a7b34c](https://github.com/115jon/ralph-meet/commit/9a7b34c641b85ed5c61575bcb66a91e9d7064c4e))
* **gui:** 💄 correct mobile sidebar stacking over voice header ([542897f](https://github.com/115jon/ralph-meet/commit/542897f856e84d658ab66a62180a3e4be0156407))
* **hooks:** 🐛 resolve strict mode React compiler/hooks errors ([721d837](https://github.com/115jon/ralph-meet/commit/721d83792f5d8be991e7e25b17348d18167730a1))
* **media:** 🐛 handle animated gif media in viewer ([65ec591](https://github.com/115jon/ralph-meet/commit/65ec5912ce000da8edd80cdd5465992bcd51afd7))
* **meeting-room:** 🐛 wrap presence update D1 write with ctx.waitUntil ([123b1d1](https://github.com/115jon/ralph-meet/commit/123b1d12f0d06b1f48dc5fe7424c3ec6e27408ac))
* **mobile:** add core:window:allow-close capability for back button exit ([7b4116b](https://github.com/115jon/ralph-meet/commit/7b4116b21681bf033c5c586a639658df274009d5))
* **mobile:** gracefully exit the app or navigate browser back when back button reaches base layer ([c70ddaa](https://github.com/115jon/ralph-meet/commit/c70ddaa6300aa4fdc0ddc96fc363e0b63850af7a))
* **mobile:** pre-load API chunks in useBackButton to fix execution latency when exiting app ([0347a3f](https://github.com/115jon/ralph-meet/commit/0347a3fcb1982bd2d89d350e11afa57e1906d84d))
* **mobile:** remove ?url modifier from splash logo to fix vite MIME resolve errors ([8cb268c](https://github.com/115jon/ralph-meet/commit/8cb268c618dfb4c8139674f9a498fcb5db4387c2))
* **mobile:** remove legacy CloseRequested intercept that conflicts with tauri v2 back handlers ([d6eb7ba](https://github.com/115jon/ralph-meet/commit/d6eb7ba5c548b9f5318a4f515e021cd60e990b48))
* **mobile:** replace tauri-plugin-process with native app.exit(0) command via invoke ([5f194d0](https://github.com/115jon/ralph-meet/commit/5f194d009ee7941213709060282b8d0b89bfcf79))
* **mobile:** replace unsupported window.close() with tauri-plugin-process exit(0) ([a17d61e](https://github.com/115jon/ralph-meet/commit/a17d61e4ee9bc63ff3723feefaa8bbb5c7f01db0))
* **mobile:** resolve react hook rendering order and add back handler to bottom sheet ([aa5a775](https://github.com/115jon/ralph-meet/commit/aa5a775e303b528a81fa6457aaeee3209de066e2))
* **mobile:** robust back-button handling for sidebars and popovers ([f646d38](https://github.com/115jon/ralph-meet/commit/f646d38a36363c56ca14c53d9e141350b46f4461))
* **native-share:** 🐛 align safe hook capture with OBS ([ea27734](https://github.com/115jon/ralph-meet/commit/ea27734ead875119c43170dbf0eae5ceee95c9dd))
* **native-share:** 🐛 fix preview loopback and hook disabled in production ([3de5ac0](https://github.com/115jon/ralph-meet/commit/3de5ac07d2108f9851a284dfc9847889fa2262a3))
* **native-share:** 🐛 wire loopback commands into Tauri and fix hook defaults ([4852981](https://github.com/115jon/ralph-meet/commit/48529817ef6489b7734308bd41f4f9f63508ad52))
* **notifications:** 🐛 fix DM badge counts, pill indicators, and persistence ([b7e525a](https://github.com/115jon/ralph-meet/commit/b7e525ae4349747b69cacf71cf7e183527400736))
* **notifications:** 🐛 resolve DM unread counts not updating or persisting ([44efae7](https://github.com/115jon/ralph-meet/commit/44efae7c02f5d6536c8cb739f2a4ad9262802680))
* only transfer pending sessions when participant_id matches (actual reconnect). For clerk_user_id-only matches (fresh join), clean up the dead SFU sessions instead. ([57edb4b](https://github.com/115jon/ralph-meet/commit/57edb4b0237778d36f894b96097fc9f717d7d5af))
* **profile:** :bug: avoid guest fallback for oauth users ([c7c8ca1](https://github.com/115jon/ralph-meet/commit/c7c8ca1e83cb2f6c6e0d771a59ef28b0818a0867))
* refactor svg strings to react components ([056074b](https://github.com/115jon/ralph-meet/commit/056074be1364fe2dc8ebced0533fbe7cd3902405))
* remove dangerouslySetInnerHTML security warnings ([2caa834](https://github.com/115jon/ralph-meet/commit/2caa834e839bdbbd0da8f251ba914a40989313a9))
* **rtc:** 🐛 fix black screen in screen share and hardware encoder deadlock ([de67300](https://github.com/115jon/ralph-meet/commit/de673003919ed1cf484e9410483c1f53e9c3f696))
* **rtc:** 🐛 proactively unpublish and detach all local tracks gracefully before track stop ([fe279b7](https://github.com/115jon/ralph-meet/commit/fe279b7d831e84849827f1c5e80db7bfbf932b38))
* **runtime:** 🔧 alias use-sync-external-store to React shim, add 404 page ([6fa0842](https://github.com/115jon/ralph-meet/commit/6fa084275e9c5b13904910fc869b1b57cff8893c))
* **security:** 🧹 fully clean up state when user is banned/kicked ([a39a3d1](https://github.com/115jon/ralph-meet/commit/a39a3d1fb92ebd87f93e9f424000bf062af502c9))
* **security:** 🚨 handle self-ban: kick from voice, remove server, navigate away ([7dcbcec](https://github.com/115jon/ralph-meet/commit/7dcbcec58c6f3c3415294840b91e2c12577c5aaa))
* **sfu:** 🐛 fix screen share pull failure and signal timeout leak ([d6bcd40](https://github.com/115jon/ralph-meet/commit/d6bcd4038a42eef07fdd79efb19700a10d4bcec7))
* **sidebar:** 🔒 gate channel/category management actions behind permissions ([815e537](https://github.com/115jon/ralph-meet/commit/815e537b057253a39dd89de6ee4bffb6d206d105))
* **soundboard:** 🐛 support larger custom audio playback ([b632012](https://github.com/115jon/ralph-meet/commit/b632012d99f7ebfa13a20fe1b8c1451523790d40))
* **ui:** 🐛 fix member list popover toggle and unmount crash ([0be9698](https://github.com/115jon/ralph-meet/commit/0be96988ba9c70dc004277a6fa797e346d15f492))
* **ui:** 🐛 fix portrait video fullscreen rendering in viewer ([1ae4681](https://github.com/115jon/ralph-meet/commit/1ae4681e07a1c4421f3b43e456930bdb31f12f59))
* **ui:** 🐛 fix scrollbar overflow past message list boundary ([b91078c](https://github.com/115jon/ralph-meet/commit/b91078ca5f1d1b89f1c8fa10c30561c88ee54a4a))
* **ui:** 🐛 fix trapped focus and escape key closing dialogs ([6e170a8](https://github.com/115jon/ralph-meet/commit/6e170a8894dacfdedae83d513182a8af85d2b547))
* **ui:** 🐛 move message-input spacing outside scroll container ([c1d1b70](https://github.com/115jon/ralph-meet/commit/c1d1b70806c0ac13ed571d402fcdc51d0d60e896))
* **ui:** 🐛 prevent tooltips from intercepting hover events ([b1d362b](https://github.com/115jon/ralph-meet/commit/b1d362bd0b6e1ed059b08cf598b527b99316be4c))
* **ui:** 💄 align overlay UI and add global escape key handlers ([59373a8](https://github.com/115jon/ralph-meet/commit/59373a80d4c52b95f44653a9c23b907d54790616))
* **ui:** 💄 enhance voice header legibility with dark gradients in cinema mode ([1649796](https://github.com/115jon/ralph-meet/commit/1649796d538eef91ad62d5b7129b5bb0745ff84e))
* **ui:** 💄 fix settings modal scrollbar overlapping close button ([f81e39f](https://github.com/115jon/ralph-meet/commit/f81e39fd87c0870920202376f5156bfafc088d67))
* **ui:** 💄 fix voice layout avatar sizing and consistency ([adcec65](https://github.com/115jon/ralph-meet/commit/adcec655fde37bd1916e1a0716cc3a3e97950524))
* **ui:** 💄 improve channel details discoverability and tab metadata ([2008862](https://github.com/115jon/ralph-meet/commit/20088625b7e048572ed91ff5c30df252cea0eec7))
* **ui:** 💄 refine voice grid avatar display and background styling ([e295124](https://github.com/115jon/ralph-meet/commit/e2951241aaff5c23034910b2dc9e84c0f0cd5f89))
* **ui:** 🔧 adapt media viewer toolbar for videos, fix scroll jitter ([c7b6639](https://github.com/115jon/ralph-meet/commit/c7b6639ec2d34bd2e72a9b057bd7c627093411ad))
* **ui:** correct Virtuoso scroll index calculations for jump-to-message ([6c55fa1](https://github.com/115jon/ralph-meet/commit/6c55fa1e878b244c80d126cf15a1998a42bb04f3))
* **ui:** do not render disconnected users as ringing ([f9836c2](https://github.com/115jon/ralph-meet/commit/f9836c2ccdf0bc74092a522f56abc49a88148cfe))
* **vite:** 🔧 pre-bundle use-sync-external-store for ESM compatibility ([6b3e86f](https://github.com/115jon/ralph-meet/commit/6b3e86f4082290cd07c2f045b7299e071900fe6d))
* **vite:** 🔧 use resolveId plugin for use-sync-external-store shim ([12af25a](https://github.com/115jon/ralph-meet/commit/12af25a86ec5dd5d4be7b78837e9c846b7c884d6))
* **voice-room:** 🐛 await handleVoiceIdentify and remove redundant heartbeat persist ([a22a39d](https://github.com/115jon/ralph-meet/commit/a22a39d90acd8c39bdba5ee08ccef9b1541f6d18))
* **voice:** :bug: handle addTransceiver failure by falling back to compatible RTP encodings ([39032f8](https://github.com/115jon/ralph-meet/commit/39032f86d862a540117e5a2d80fd9b98ac7a10da))
* **voice:** :bug: preserve sidebar presence on reconnect ([e4d0e2f](https://github.com/115jon/ralph-meet/commit/e4d0e2fa8d40fe0d1555045cc5bc8a4533692637))
* **voice:** :bug: rejoin voice on first click under StrictMode ([befff94](https://github.com/115jon/ralph-meet/commit/befff9449e2e0bdf3b3d0dcb5b34c1e6ce7c4671))
* **voice:** :bug: reset auto-join when switching channels ([7c19b09](https://github.com/115jon/ralph-meet/commit/7c19b0994bdb2a7df77e997df00f513060dbf2e5))
* **voice:** :bug: restore sidebar voice join ([d8a338a](https://github.com/115jon/ralph-meet/commit/d8a338af08557b07fa298f868d814df9ab475eec))
* **voice:** :bug: stabilize cloudflare realtime calls ([d3918a1](https://github.com/115jon/ralph-meet/commit/d3918a1523c77fa964edb6869613d07562117937))
* **voice:** :speaker: continue join after voice switch confirm ([7cd3b06](https://github.com/115jon/ralph-meet/commit/7cd3b06131c879a50b9a183d04b22ab28687edb0))
* **voice:** :speaker: leave and rejoin when switching channels ([7c03ed2](https://github.com/115jon/ralph-meet/commit/7c03ed2b0405077438e33e87a96915d033a55482))
* **voice:** ⚡️ eliminate publish delay on join and reload ([ae2b093](https://github.com/115jon/ralph-meet/commit/ae2b093d734fe86a0381055459bc307f9aa0656e))
* **voice:** ⚡️ zero-interruption voice reconnect via SFU session transfer ([0f9cc89](https://github.com/115jon/ralph-meet/commit/0f9cc895c931c906a08069ad7bdcec3d7b22581d))
* **voice:** 🐛 add cursor overlay to screen share + remove dead capture ref ([5750ed3](https://github.com/115jon/ralph-meet/commit/5750ed3404767cbe12a3686d6866727409e4c49f))
* **voice:** 🐛 await ICE connected state before sending TracksReady ([0969c16](https://github.com/115jon/ralph-meet/commit/0969c16a9a5fc30dbb017a522d62eb4c5bca3ae3))
* **voice:** 🐛 await tracks/close to prevent race with re-publish ([4933b80](https://github.com/115jon/ralph-meet/commit/4933b80ac8c3239ec02a975da6b8284fa5ee0571))
* **voice:** 🐛 delay pull for re-published tracks after quality change ([81b12f5](https://github.com/115jon/ralph-meet/commit/81b12f5ff69c21e8defa45cb1eeae50774169489))
* **voice:** 🐛 don't transfer dead SFU sessions on fresh join ([57edb4b](https://github.com/115jon/ralph-meet/commit/57edb4b0237778d36f894b96097fc9f717d7d5af))
* **voice:** 🐛 expose sfuInstance as reactive state to fix stuck Connecting status ([8835ae5](https://github.com/115jon/ralph-meet/commit/8835ae503adac262b4d65bcbfe461ab0f73e05ed))
* **voice:** 🐛 fix 1080p stream degrading to 451p for receivers ([37e51d8](https://github.com/115jon/ralph-meet/commit/37e51d8af3041d0882818c6f99222d3308762457))
* **voice:** 🐛 fix hibernation desync, SFU leaks, and voice reconnect ([16ad317](https://github.com/115jon/ralph-meet/commit/16ad31791b74b7f94d1d34867281f058b7e45a33))
* **voice:** 🐛 fix infinite render loops in settings and device swap ([48c361c](https://github.com/115jon/ralph-meet/commit/48c361ca6cdee2640b5313bac3765b379b3babf2))
* **voice:** 🐛 fix pull-side concurrency bugs and double-publish on initial connect ([498e472](https://github.com/115jon/ralph-meet/commit/498e4724be99d35d1a554d04c9c50b6c518b248b))
* **voice:** 🐛 fix screen share pull recovery and voice state desync ([c70377b](https://github.com/115jon/ralph-meet/commit/c70377b53f713053c0c76aaded55b3924547c4b1))
* **voice:** 🐛 fix screen share quality and restore thumbnails ([a348aff](https://github.com/115jon/ralph-meet/commit/a348aff6ce530f0313bc18202f04cf1792a127cb))
* **voice:** 🐛 fix screen share re-publish by reusing push session ([c777aa9](https://github.com/115jon/ralph-meet/commit/c777aa9401940472aa66a66893c3a9922fde26a4))
* **voice:** 🐛 fix screen share re-stream race condition ([244d1bc](https://github.com/115jon/ralph-meet/commit/244d1bce6859d655886c6be4174464fb9228d949))
* **voice:** 🐛 fix stream freeze when changing quality ([21e1755](https://github.com/115jon/ralph-meet/commit/21e1755d2f9fcb63a8ff2c2b447afdacaaf51e16))
* **voice:** 🐛 harden WebRTC edge cases for ICE failure and rapid screen toggle ([3354162](https://github.com/115jon/ralph-meet/commit/33541623c570ed382083e63373e2f2160f3e9411))
* **voice:** 🐛 hide stream volume without audio ([0930c2a](https://github.com/115jon/ralph-meet/commit/0930c2a17b5736484e228258fcdb79aaa5ff715e))
* **voice:** 🐛 ignore stale StopTracks payloads on fast republish ([aa2bde6](https://github.com/115jon/ralph-meet/commit/aa2bde67fdc7badb10d6abb9c078092e2e50e8e3))
* **voice:** 🐛 implement event-driven TracksReady signal ([c6cb73f](https://github.com/115jon/ralph-meet/commit/c6cb73ffc627e5d1cbd0085a5a42f775525bc9ca))
* **voice:** 🐛 keep stream video subscribed ([15fc12a](https://github.com/115jon/ralph-meet/commit/15fc12a8f6a0217f0339adb8c40b3da9a0941b8a))
* **voice:** 🐛 prefer freshest avatar source ([663eba6](https://github.com/115jon/ralph-meet/commit/663eba67c2e9d918c955c58b10b0d47b67f1fc4a))
* **voice:** 🐛 prevent audio peaking and improve mic quality ([e2baf5e](https://github.com/115jon/ralph-meet/commit/e2baf5e9a18a0520e8a982b038b2a4f39359a5c4))
* **voice:** 🐛 propagate display names through sfu ([15134b6](https://github.com/115jon/ralph-meet/commit/15134b6d06a773223abd319afb20180f2b0e6661))
* **voice:** 🐛 recreate MediaStream references to prevent video freezes ([c46f6c9](https://github.com/115jon/ralph-meet/commit/c46f6c9e97298850cba0ffabed9ad54e8b705764))
* **voice:** 🐛 recreate PeerConnections on session resume path ([ffbd9fd](https://github.com/115jon/ralph-meet/commit/ffbd9fdb5c3f766490cf700a8be1e9c108021eb6))
* **voice:** 🐛 refresh voice token on session resume ([2f2af87](https://github.com/115jon/ralph-meet/commit/2f2af878d427daa8813f1cce876f386c5d26a148))
* **voice:** 🐛 replace polling with push-based stats subscription ([47f51df](https://github.com/115jon/ralph-meet/commit/47f51df1b72ca285c2c338a7e6d027bbbc663984))
* **voice:** 🐛 resolve missing avatars and stale device selection in voice channels ([89a17dd](https://github.com/115jon/ralph-meet/commit/89a17dd5c5c98e62c3a28806150d6bf3c0096444))
* **voice:** 🐛 resolve permanent audio dropouts on screen share stop ([a7a02af](https://github.com/115jon/ralph-meet/commit/a7a02aff29a934fbb7b3836bb775eafc9feefaf9))
* **voice:** 🐛 resolve screen share black screen on restart ([bb1fd2e](https://github.com/115jon/ralph-meet/commit/bb1fd2eef3795fe909d484e7d8b2a1108b26dc9f))
* **voice:** 🐛 resolve voice reconnect loop and add 4006 fallback ([5928a2d](https://github.com/115jon/ralph-meet/commit/5928a2db9c28227b9f88d81e662d8437651e25b9))
* **voice:** 🐛 separate stream and user volume controls ([328683e](https://github.com/115jon/ralph-meet/commit/328683e4cd996030f234a6a0068425f6bbe4ca52))
* **voice:** 🐛 show all stream qualities and fix dashboard share button ([f516c12](https://github.com/115jon/ralph-meet/commit/f516c12816364643324895d150abd55ce3d6c53f))
* **voice:** 🐛 stop reusing transceivers after closing them on SFU ([90d6b84](https://github.com/115jon/ralph-meet/commit/90d6b8480bc5693a4cdc73232b4cf636279150a0))
* **voice:** 🔇 fix VAD gate reliability and gate debug logs behind DEV flag ([9c6e3f0](https://github.com/115jon/ralph-meet/commit/9c6e3f0c19076872301ce80f0e3d580521a4a950))
* **voice:** fix state staleness across pc recreations ([ffdf60b](https://github.com/115jon/ralph-meet/commit/ffdf60bf28b1290ff32d59bc7750e37ae2649dbc))
* **voice:** improve overnight stability and fix UI desyncs ([064cea9](https://github.com/115jon/ralph-meet/commit/064cea9a4400de4cc1cb37e53c1e6b4dcde3fc28))
* **voice:** recover from SFU internal errors during track negotiation ([e9f5be5](https://github.com/115jon/ralph-meet/commit/e9f5be5972f76a80ec57403f15d438022b24a113))
* **webrtc:** :bug: fix one-way audio after hot reload ([c000ddf](https://github.com/115jon/ralph-meet/commit/c000ddfbed3e53c7dadf58b2c1fb110db2eb918a))
* **webrtc:** 🐛 resolve metrics permanently stuck on loading and improve signal UI ([bbd881f](https://github.com/115jon/ralph-meet/commit/bbd881fe67371a5fb51e75f2a5f17ba749c93473))
* **wordle:** 🐛 load current NYT puzzle ([915f0bd](https://github.com/115jon/ralph-meet/commit/915f0bd9b91013513923e4d091d46c168cd11836))
* **worker:** 🐛 fix alarm error handling and normalize log prefixes to [ChatGW] ([3374654](https://github.com/115jon/ralph-meet/commit/337465433de67233a1ff15f8635034db478bbe9d))
* **ws:** 🐛 simplify heartbeat auto-response pattern for proper hibernation ([878d010](https://github.com/115jon/ralph-meet/commit/878d01063ad43ca7266aeb0c0d2d9a1fa0441815))


### Performance Improvements

* **chat:** :zap: coalesce bootstrap loading ([bac8b24](https://github.com/115jon/ralph-meet/commit/bac8b244ad2bf49a29d73c01249cf670b9617803))
* **chat:** :zap: lazy load remaining screen share modals ([909bcbc](https://github.com/115jon/ralph-meet/commit/909bcbcca1d3cfbd030d3f86574d4c3061f668be))
* **chat:** :zap: lazy load screen share pickers ([fb5a441](https://github.com/115jon/ralph-meet/commit/fb5a441e5f8b40eca5a31d999866ffd18b7605b5))
* **chat:** :zap: lazy load user panel popovers ([63b4c5c](https://github.com/115jon/ralph-meet/commit/63b4c5cf250954cff7c64b05f0c8eb8f4b5af674))
* **chat:** :zap: lazy load user settings modal ([280aeb4](https://github.com/115jon/ralph-meet/commit/280aeb4d89879fbaaacc241de12b431a484a9077))
* **chat:** :zap: lazy load voice confirmation modals ([60b17f4](https://github.com/115jon/ralph-meet/commit/60b17f44689c8556e0825b74c6d47328e410396e))
* **chat:** :zap: lazy load voice dashboard ([b73b9f6](https://github.com/115jon/ralph-meet/commit/b73b9f65f0e3a0a180b450c2447a864e993dbccb))
* **chat:** ⚡️ cache messages across channel switches ([2bb0723](https://github.com/115jon/ralph-meet/commit/2bb07237d7ba30b7df16b3219c52a3204116c6e9))
* **chat:** ⚡️ cache server navigation data ([f8f873c](https://github.com/115jon/ralph-meet/commit/f8f873cdb53335bb97491f0b7ed4460763a6ee3a))
* **chat:** ⚡️ cache Tenor GIF requests ([ca61b1e](https://github.com/115jon/ralph-meet/commit/ca61b1e490b5dc12ffe3453a8c1d70b2ee19c012))
* **chat:** ⚡️ convert remaining full-store subscribers to useShallow selectors ([bda7c71](https://github.com/115jon/ralph-meet/commit/bda7c71cb10745f83821d24399c5cca7fd05511f))
* **chat:** ⚡️ fix re-render storms from speaking state and full-store subscriptions ([80bcc10](https://github.com/115jon/ralph-meet/commit/80bcc1050b894f7e8be68126cfa6dfaa7b858fec))
* **chat:** ⚡️ keep played media mounted in virtual list ([7cafa9b](https://github.com/115jon/ralph-meet/commit/7cafa9b11e6bff148d4e87d95ca593fe07a03f92))
* **chat:** ⚡️ reduce gif send latency ([306a653](https://github.com/115jon/ralph-meet/commit/306a6535e3169d1fabae82dbe731ccd94b0cf295))
* **chat:** ⚡️ virtualize message list with react-virtuoso ([be95ced](https://github.com/115jon/ralph-meet/commit/be95ced38bbc1d07a056fc8ab2200bb43328a5b4))
* **desktop:** :zap: implement zero-overhead screen share pipeline with DX11 game-capture hook ([6575356](https://github.com/115jon/ralph-meet/commit/6575356401f68199aabc0d41d5e7780e72288415))
* **desktop:** :zap: streamline chat startup ([c813983](https://github.com/115jon/ralph-meet/commit/c813983d97613ec0db0f844be202e21ece05788e))
* **desktop:** ⚡️ eliminate IPC registry overhead and enable hw acceleration ([be2512e](https://github.com/115jon/ralph-meet/commit/be2512e4607684ae21b61369f775f2bfd56bb096))
* **do:** ⚡️ batch storage.put() calls with dirty-flag pattern ([a30fafd](https://github.com/115jon/ralph-meet/commit/a30fafd5c8eb20aadbe96087796219312c6933e9))
* **do:** ⚡️ cache Clerk profiles in KV with 5min TTL ([c433076](https://github.com/115jon/ralph-meet/commit/c433076c2f5f76c28f09bf48cf9eefc19980754f))
* **do:** ⚡️ debounce D1 writes in handlePresenceUpdate ([b910f05](https://github.com/115jon/ralph-meet/commit/b910f051fb25344a04d8893fe598d1cf178f78b6))
* **do:** ⚡️ split voiceChannelMembers into per-channel storage keys ([a081123](https://github.com/115jon/ralph-meet/commit/a0811235d9dc2825aa5075d0fde0caee227da8ca))
* **media:** ⚡️ use permissions.query() for fast mic/camera detection ([900f02f](https://github.com/115jon/ralph-meet/commit/900f02faa1c8bd71ad38ce8e50e961c58d397a18))
* **screen-share:** ⚡ replace native capture with CEF chromeMediaSource API ([1d960b0](https://github.com/115jon/ralph-meet/commit/1d960b0773380153a523b1acd9fe0bcf9e7274bb))
* **security:** 🔒 reduce TURN credential TTL from 24h to 1h ([08d10fa](https://github.com/115jon/ralph-meet/commit/08d10fa0e84a3d29c63ac95715b2040c276d315b))
* **voice-room:** ⚡️ add SFU retry logic and reduce voice token TTL ([9ecbef8](https://github.com/115jon/ralph-meet/commit/9ecbef8637f41f8aae785ce9dc4bbba0c7426884))
* **voice:** :zap: lazy load screen share modal ([ffd4ecc](https://github.com/115jon/ralph-meet/commit/ffd4ecc93f6887eae87cafea29785a607055980a))
* **voice:** :zap: lazy load stream context menu ([25231ea](https://github.com/115jon/ralph-meet/commit/25231eadda3eef28b9d1e6df192e45f46e0091da))
* **voice:** :zap: preserve screen share source metadata ([74feb44](https://github.com/115jon/ralph-meet/commit/74feb44ad1ed5498eaf4e7f79e2faf5177ba635a))
* **webrtc:** ⚡️ optimize connection and media flow latency ([92aed92](https://github.com/115jon/ralph-meet/commit/92aed92109542f19272bd5904ebc7a86c884132e))
* **worker:** ⚡️ hoist SSR handler and pre-compile rate limiter regexes ([31e1a11](https://github.com/115jon/ralph-meet/commit/31e1a11c2607ed2395c54b6f905380abd0def3df))


### Miscellaneous Chores

* **release:** bump to accurate semantic version 1.0.0 ([1563867](https://github.com/115jon/ralph-meet/commit/1563867df8f96ee51775a067a78073b25ba1fcba))


### Code Refactoring

* **api:** ♻️ flatten api responses and completely replace raw fetch calls ([a93a52e](https://github.com/115jon/ralph-meet/commit/a93a52e03fcaf3119c17c4e659dcb3a42588d5dc))

## Changelog
