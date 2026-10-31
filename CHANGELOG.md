# Changelog

## [3.4.0](https://github.com/115jon/ralph-meet/compare/v3.3.0...v3.4.0) (2026-10-31)


### Features

* **voice:** ✨ add a spectral noise floor estimator ([96d6d49](https://github.com/115jon/ralph-meet/commit/96d6d49ab858baef244c7fba70d942528d9c8d80))
* **voice:** ✨ keep warm standby sessions for occupied voice channels ([e97fd89](https://github.com/115jon/ralph-meet/commit/e97fd89f516eb7a5c130f67626052fc0eb36e1df))
* **voice:** ✨ republish a track listeners cannot pull ([301ebeb](https://github.com/115jon/ralph-meet/commit/301ebebefba6f701af928198e7c61733ad191a6b))
* **voice:** ✨ time each voice join stage ([ffe8d99](https://github.com/115jon/ralph-meet/commit/ffe8d9928b52426ad96d9542f86cb732bc5ba075))


### Bug Fixes

* **lint:** 🐛 guard unsafe optional chains and make three rules errors ([4d4abf8](https://github.com/115jon/ralph-meet/commit/4d4abf8edb28b592bdc4de292315fcb0e4bdc88a))
* **realtime:** 🐛 pass the payload to voice leave and call end ([b255626](https://github.com/115jon/ralph-meet/commit/b255626ca2b11b334b9850b29c01f2ff621f8eaa))
* **realtime:** 🐛 skip tracks a restart left behind in voice ready ([d3c3241](https://github.com/115jon/ralph-meet/commit/d3c3241fb20657f00fa45bdaecb57d2b13a1b460))
* **realtime:** pass leave and call-end payloads; typecheck workerd tests ([5fe7451](https://github.com/115jon/ralph-meet/commit/5fe74516b55a0ea0f7a3b6dad2aee582bc7d1340))
* **voice:** 🐛 hold a pull until the peer connection is connected ([c354fe8](https://github.com/115jon/ralph-meet/commit/c354fe85c9e6be50af81a31619d9a639686e7d3f))
* **voice:** 🐛 keep isolated clicks from opening the gate ([556fbe0](https://github.com/115jon/ralph-meet/commit/556fbe0824d3f89f40c4d22dd1d12e28461c3669))
* **voice:** 🐛 keep warm standby private and idle ([e67ac9c](https://github.com/115jon/ralph-meet/commit/e67ac9cd2d5f483aeb285d41889ba4aed84f7f03))
* **voice:** 🐛 republish stale standby track on join ([1c40fed](https://github.com/115jon/ralph-meet/commit/1c40fed41ead14b9a8c000b31752a347e5312fd1))
* **voice:** 🐛 require a channel join for voice identify and pulls ([29c2079](https://github.com/115jon/ralph-meet/commit/29c2079fc881196e28c33113972c61a56ab76f81))
* **voice:** 🐛 retry a partytracks pull when its bulk request fails ([4099417](https://github.com/115jon/ralph-meet/commit/40994179463ecb00e28c2931265834858762d768))
* **voice:** hold a pull until the peer connection is connected ([2aa797d](https://github.com/115jon/ralph-meet/commit/2aa797d7d0e1f3ea53806060b567794d4388cb24))
* **voice:** republish stale standby track on join ([811a3d3](https://github.com/115jon/ralph-meet/commit/811a3d39b87d67b3ef9b1b06890eda029ab7b4e8))
* **voice:** require a channel join for voice identify and pulls ([5b0299b](https://github.com/115jon/ralph-meet/commit/5b0299b9e288dac6d03f43644a5b4642b11ef733))
* **voice:** retry failed partytracks pulls and skip stale tracks after a restart ([ff9ad73](https://github.com/115jon/ralph-meet/commit/ff9ad734264e01c99b6ca6eb0ad1fbd342084c87))


### Performance Improvements

* **app:** ⚡️ load the call stack, chat store and panels only when needed ([bf194fb](https://github.com/115jon/ralph-meet/commit/bf194fbfa1298a9c2440885b817ba69664d806bb))
* **app:** lazy-load the call stack, chat store and panels ([74d6f83](https://github.com/115jon/ralph-meet/commit/74d6f83c3cc07daf174b119f18ed3dbe096653d7))
* **realtime:** ⚡️ retry waiting sockets once the server is reachable ([8f4dfb0](https://github.com/115jon/ralph-meet/commit/8f4dfb06772fd423d5952fea22360bbf057dbd6d))
* **voice:** ⚡️ build the gated processor while the gateway connects ([bd66d0f](https://github.com/115jon/ralph-meet/commit/bd66d0f62819dc3a6bb33818e4e0c8f16e501f98))
* **voice:** ⚡️ gate the mic in the audio graph with a 20 ms lookahead ([125457d](https://github.com/115jon/ralph-meet/commit/125457d62ced99fb00aef7a0fc4c18e6b774f193))
* **voice:** ⚡️ identify on the voice socket from the ticket bootstrap ([3c08c01](https://github.com/115jon/ralph-meet/commit/3c08c0123378c6320ffa2214b425053603e7e688))
* **voice:** ⚡️ retry early partytracks pulls from 100 ms ([2519c70](https://github.com/115jon/ralph-meet/commit/2519c7051cf9ce64030a40af6bcdac410ca733e9))
* **voice:** ⚡️ send 10 ms opus frames ([0973b0c](https://github.com/115jon/ralph-meet/commit/0973b0c046c23f05ebdfec66c588320061b140e0))
* **voice:** ⚡️ skip the rtp wait and send ice with the socket ticket ([1d23263](https://github.com/115jon/ralph-meet/commit/1d232630147535f02a7ff760fa24213f83db2985))
* **voice:** cut mouth-to-ear latency from about 170 to 100 ms ([83b28e6](https://github.com/115jon/ralph-meet/commit/83b28e6c4c381c1d42b96e732fd4cb5f12c9a9c7))

## [3.3.0](https://github.com/115jon/ralph-meet/compare/v3.2.0...v3.3.0) (2026-10-30)


### Features

* **auth:** ✨ restyle access pages on a shared public frame ([ffb1044](https://github.com/115jon/ralph-meet/commit/ffb1044dc28cc576b2e3bab6677c43b6fdca23aa))
* **calls:** ✨ rebuild the dm call region on the shared dock ([15af009](https://github.com/115jon/ralph-meet/commit/15af0092c5288c7d0627bff8e57a58add1d2085f))
* **chat:** ✨ confirm copy actions with a toast ([259029f](https://github.com/115jon/ralph-meet/commit/259029f94e908d29e08991caba77ad33b23ac256))
* **chat:** ✨ fit phone list pages to the 48px header and row recipe ([55c4cb1](https://github.com/115jon/ralph-meet/commit/55c4cb181cd6a1da763f6d15d7e053c9fd9c5cbd))
* **chat:** ✨ open context menus as action sheets on long press ([9c92770](https://github.com/115jon/ralph-meet/commit/9c9277009cf574581c19636ea4d024c2a7475624))
* **chat:** ✨ restyle the app shell, settings and profiles ([9dc84b3](https://github.com/115jon/ralph-meet/commit/9dc84b34cdc1f8a7c9c09d4459b4cb560b79f3e4))
* **chat:** ✨ wake gateway on resume and show connection states ([e13c509](https://github.com/115jon/ralph-meet/commit/e13c5090e9f3bca20abb9c6dfd267b47ab14de63))
* **collectibles:** ✨ accept catalog pushes from an external fetcher ([2cadb49](https://github.com/115jon/ralph-meet/commit/2cadb4941076c18e0f1cfc9c449fd17444ec0643))
* **collectibles:** ✨ add per-type pickers with live previews ([a2ce191](https://github.com/115jon/ralph-meet/commit/a2ce191d992dacf414e714e0e524c409530df92f))
* **command-menu:** ✨ show avatars, icons and key hints in the switcher ([7998ec7](https://github.com/115jon/ralph-meet/commit/7998ec7b740eba65b92defd249fe76ca1db8f962))
* **desktop:** ✨ restyle the desktop shell and handle window occlusion ([4188a3a](https://github.com/115jon/ralph-meet/commit/4188a3a759e2744dd6d3dfb110d1ea964762234b))
* **dev:** ✨ add overlay fixtures for dialogs, panels and popovers ([7544ce5](https://github.com/115jon/ralph-meet/commit/7544ce54ccc29e34f517b843a620bb218aeb0484))
* **dev:** ✨ add screen-share and listen-together fixture surfaces ([4970c3b](https://github.com/115jon/ralph-meet/commit/4970c3b7d101ddf0fd7262b84c84383b62d74f9b))
* **dev:** ✨ add settings and profile fixtures with a fetch stub ([1bb9a28](https://github.com/115jon/ralph-meet/commit/1bb9a28920a9e749dbcd9ac8b250d38cc52d0bfc))
* **dev:** ✨ add the remaining settings and profile fixture states ([357beda](https://github.com/115jon/ralph-meet/commit/357beda76ce34f5a8f89d53a70cb5599d5b08f0a))
* **dev:** ✨ fill the listen-together fixture with covers and results ([cdde640](https://github.com/115jon/ralph-meet/commit/cdde640140a3f81df6406081be936d30a4555b5e))
* **errors:** ✨ add describeapierror so server messages stay off screen ([18aba39](https://github.com/115jon/ralph-meet/commit/18aba3905de42f3bab1ef134f0d64ee76f604827))
* **home:** ✨ put screen share and listen together on the product stage ([1a41de0](https://github.com/115jon/ralph-meet/commit/1a41de066cc3893a395fe84d2d4323241fefb239))
* **home:** ✨ recapture listen together cropped to the panel ([17aeed4](https://github.com/115jon/ralph-meet/commit/17aeed4d6ff5f9ef970cc7b32ef5bc3b986d23bf))
* **home:** ✨ redesign the landing page and regenerate screenshots ([d95a8f5](https://github.com/115jon/ralph-meet/commit/d95a8f50ccd630f776bb852481d3dc0dacaf291f))
* **home:** ✨ redesign the landing page around a live dither field ([0373b07](https://github.com/115jon/ralph-meet/commit/0373b07b87136cee28e224d586ba47788ddb5a5a))
* **icons:** ✨ add fill weights for nav and permission icons ([9fb4522](https://github.com/115jon/ralph-meet/commit/9fb4522dee18badf75453573a86662c0eb3900b6))
* **profile:** ✨ play profile effects once and label account rows ([3ff2db2](https://github.com/115jon/ralph-meet/commit/3ff2db2c658adb36c2bf4b114d382b6d9d6b4afb))
* **profile:** ✨ rebuild the profile editor inside one dialog frame ([b3907e5](https://github.com/115jon/ralph-meet/commit/b3907e5fba3f5f8798001c1579215576ac921c19))
* **profile:** ✨ resolve unset profile colours to theme tokens ([f289718](https://github.com/115jon/ralph-meet/commit/f2897184cd29cec8e06a85d028296806ff7d5558))
* **profile:** ✨ show profiles as a solid draggable drawer on phones ([6d13c14](https://github.com/115jon/ralph-meet/commit/6d13c140d680e05734be11d4a19a6fa36ca5b020))
* **search:** ✨ add filtered message search scoped to visible channels ([2c44d95](https://github.com/115jon/ralph-meet/commit/2c44d951bf789b11256abd8727c01f37f5eee543))
* **search:** ✨ redesign search as a docked panel and phone page ([003fa91](https://github.com/115jon/ralph-meet/commit/003fa91134864dfdb6a291742d1734cbbe96d186))
* **settings:** ✨ add camera loading, no-camera and no-access states ([b5acdb7](https://github.com/115jon/ralph-meet/commit/b5acdb762ec7069cf928b54dbeb9fe7299747def))
* **settings:** ✨ add mic loading, access and empty states ([38796d3](https://github.com/115jon/ralph-meet/commit/38796d31677c64b07142f6ea58bd9338dd55f1de))
* **settings:** ✨ confirm before clearing a soundboard trigger ([d02af2f](https://github.com/115jon/ralph-meet/commit/d02af2f3ebddc23bd7c948f4eee0c0c857b3269a))
* **settings:** ✨ extract the settings workbench and move studio onto it ([cec7f32](https://github.com/115jon/ralph-meet/commit/cec7f323eab2b5ca480d3f6f8d4d086c5e3e4bde))
* **settings:** ✨ move claim account into the account panel ([daabc38](https://github.com/115jon/ralph-meet/commit/daabc3808e21f8e4b7bc5dd7787545ab553606c1))
* **settings:** ✨ open settings from one host and add a mobile tab bar ([26a9140](https://github.com/115jon/ralph-meet/commit/26a9140e7b878c3f4356f1d6c1c9605e86d9d649))
* **settings:** ✨ rebuild channel settings with named permission radios ([46de007](https://github.com/115jon/ralph-meet/commit/46de0075380cf413a110cbc0b1c619f43b0aabe0))
* **settings:** ✨ rebuild server settings on the workbench ([a75485a](https://github.com/115jon/ralph-meet/commit/a75485a13c394df6c059d453cb9145182874f392))
* **settings:** ✨ rebuild settings with row search and deep links ([cd83ca6](https://github.com/115jon/ralph-meet/commit/cd83ca6b4d5901026b902b81e9727f7c0a0eb2f5))
* **shop:** ✨ redesign the shop around collections and previews ([ea4e519](https://github.com/115jon/ralph-meet/commit/ea4e519f83834cf3bb450131824856a466369c28))
* **theme:** ✨ add per-theme contrast tokens and unify the accent ([f9e82ad](https://github.com/115jon/ralph-meet/commit/f9e82add120265c72d1c703d180ea31af62c77c8))
* **ui:** ✨ add a responsive confirm dialog ([f9c5759](https://github.com/115jon/ralph-meet/commit/f9c575923079ad0d2ab77c0865c4a23b7e92e45b))
* **ui:** ✨ add a toast primitive on sonner and mount it at the root ([2c9f6a9](https://github.com/115jon/ralph-meet/commit/2c9f6a97730dfc3c786df51cfc1bc02db3800db0))
* **ui:** ✨ add one dock state recipe for every voice control ([7c7cfb0](https://github.com/115jon/ralph-meet/commit/7c7cfb035f945f2b0202cc5074ed65652d633abd))
* **ui:** ✨ add phosphor icon adapter with bold and fill states ([1677292](https://github.com/115jon/ralph-meet/commit/16772921b3fd3ef6886b3ef04e3a3db11b7c4357))
* **ui:** ✨ add popover, menu, sheet and side panel primitives ([744eb24](https://github.com/115jon/ralph-meet/commit/744eb247c53dda2fa9e875a3dfb4632d04317a73))
* **ui:** ✨ add poster design tokens, foundation css and primitives ([277ddcb](https://github.com/115jon/ralph-meet/commit/277ddcb71240aa5445fb6097dcca7b55db94341e))
* **ui:** ✨ add sessions, keyboard and key icon concepts ([056b458](https://github.com/115jon/ralph-meet/commit/056b4582bc0c98efa4d6d299eb2a6a959f65f0ad))
* **ui:** ✨ add vaul drawer, action sheet and safe-area foundation ([040684f](https://github.com/115jon/ralph-meet/commit/040684fbef508b615facaefa6cb305b7142e0415))
* **ui:** ✨ restyle primitives to quiet pro with real switches ([771c030](https://github.com/115jon/ralph-meet/commit/771c030221cacecf132ac087b418092fba9cd808))
* **ui:** ✨ turn modals and pickers into drawers on phones ([322fe0e](https://github.com/115jon/ralph-meet/commit/322fe0e342721e67a62ce89d43dea3238ede1733))
* **ui:** poster redesign, connection UX and mobile fixes ([12e3a8d](https://github.com/115jon/ralph-meet/commit/12e3a8d27ca6f27eb53b5a85aab9f3ce6c38787e))
* **voice:** ✨ add a floating player shell that snaps to corners ([bbf9c17](https://github.com/115jon/ralph-meet/commit/bbf9c170686784c5df094786a8919885c7170337))
* **voice:** ✨ explain where screen sharing can't run ([8b8b8f3](https://github.com/115jon/ralph-meet/commit/8b8b8f39d31663689905f4151ad86fd0e9c387bd))
* **voice:** ✨ fit the dock and stage to phones and narrow columns ([d794e73](https://github.com/115jon/ralph-meet/commit/d794e734f5e535b35dbc0b66cc8e8d8e047d69aa))
* **voice:** ✨ restyle voice, streams and listen together ([05cd8d0](https://github.com/115jon/ralph-meet/commit/05cd8d051bf7c1655e00e766dc518c35d0b1a5a6))


### Bug Fixes

* **a11y:** 🐛 name the listen together result actions menu ([d977ace](https://github.com/115jon/ralph-meet/commit/d977ace14f5c85fa0651d29bfaec050103ed91f7))
* **a11y:** 🐛 name the media viewer and pad it below the safe area ([d0c2801](https://github.com/115jon/ralph-meet/commit/d0c2801e7219061aeedc4364e15cbb4687935314))
* **a11y:** 🐛 rove settings tabindex and keep radix dialog title id ([92de8d4](https://github.com/115jon/ralph-meet/commit/92de8d4b829ddc57251f678ef660efaca3a9b5c8))
* **a11y:** 🐛 show a focus edge on the command menu input ([cfe5098](https://github.com/115jon/ralph-meet/commit/cfe5098709d38af12c1a95d1d84279e147917dba))
* **a11y:** 🐛 stop typing dots under reduced motion ([d923861](https://github.com/115jon/ralph-meet/commit/d9238618d5fdd546f2e4654d86e0116db5a8efad))
* **api:** 🐛 log expected 401 and 404 responses at debug level ([a6326df](https://github.com/115jon/ralph-meet/commit/a6326dfd8624df49d46f172cdc94c55e725a531b))
* **auth:** 🐛 move kova --ra tokens out of the coarse-pointer query ([877bd12](https://github.com/115jon/ralph-meet/commit/877bd1279c11b33c20761e87338f3f363979259d))
* **avatar:** 🐛 give the frame editor zoom row room on phones ([938391e](https://github.com/115jon/ralph-meet/commit/938391e7f52f9f70cd27e90ad5fed73710eb69a7))
* **call:** 🐛 make decline a destructive tint in the dm call lobby ([cc1ad5b](https://github.com/115jon/ralph-meet/commit/cc1ad5b815593d2bf93cd19af043529340def028))
* **chat:** 🐛 align upload sound, touch fields and layers with quiet pro ([d497bf2](https://github.com/115jon/ralph-meet/commit/d497bf2fee87a898797ef3d71757905034ed9438))
* **chat:** 🐛 bring empty, loading and error states onto the 14.x anatomy ([4e387c5](https://github.com/115jon/ralph-meet/commit/4e387c5127ebe5184f60c8aaa33d1ebee4583262))
* **chat:** 🐛 fit friends tabs at 768 and stop showing raw errors ([d39629b](https://github.com/115jon/ralph-meet/commit/d39629bdd68295cc172715c641d6171ea8b3c963))
* **chat:** 🐛 give channel kinds their own glyphs ([4ce7f21](https://github.com/115jon/ralph-meet/commit/4ce7f21ea577e61696408b8d8c036ef5d2d51e18))
* **chat:** 🐛 hide leave server and drop coming-soon stream items ([dd8cb49](https://github.com/115jon/ralph-meet/commit/dd8cb4964335a7ed795f9f8e702333c2b69e1f5f))
* **chat:** 🐛 keep the friends title whole when tabs crowd the header ([a2f4cf8](https://github.com/115jon/ralph-meet/commit/a2f4cf8f78d871898c81cf4e3861ec2f488e8abc))
* **chat:** 🐛 make hover-only actions reachable on touch ([8d68c07](https://github.com/115jon/ralph-meet/commit/8d68c07e999d1ede802fecf62de1c4e38f4564bd))
* **chat:** 🐛 replace native confirm, alert and prompt with dialogs ([f914e72](https://github.com/115jon/ralph-meet/commit/f914e72c9956648eaf174f332e7f2366658cd8ef))
* **chat:** 🐛 reveal grouped message times on tap ([d2d8204](https://github.com/115jon/ralph-meet/commit/d2d82046e9c509c71829b0b709eaf153edcb75bb))
* **chat:** 🐛 size image grids by aspect ratio and clear media leftovers ([e62ac5e](https://github.com/115jon/ralph-meet/commit/e62ac5eb3d36371eb4f8d327c7c8279d068c32cc))
* **chat:** 🐛 tighten message rows and composer to the quiet pro recipe ([f46b87e](https://github.com/115jon/ralph-meet/commit/f46b87ee9778ca46a2f1935bbb9f666157854cdd))
* **collectibles:** 🐛 harden catalog sync and restrict manual refresh ([e5f52e4](https://github.com/115jon/ralph-meet/commit/e5f52e403c9f1a11cf5464379ec456265b7fc8d9))
* **collectibles:** 🐛 load bundle frame art from the frame item sku ([5127a48](https://github.com/115jon/ralph-meet/commit/5127a48e2a7a5bc6b871acb7fb315c2cc228f438))
* **copy:** 🐛 align default and share page titles with the landing ([268dd8d](https://github.com/115jon/ralph-meet/commit/268dd8d5903a5486dc469352b60bbc2f6b083c8f))
* **dev:** 🐛 open the connection details popover in voice dock fixtures ([ab71481](https://github.com/115jon/ralph-meet/commit/ab71481134bb430229df0f8a7f2293ee4aaea0f8))
* **dev:** 🐛 seed fixture stores in a layout effect, not during render ([2a8de74](https://github.com/115jon/ralph-meet/commit/2a8de74f140d7faca6708ea5028cb4c5d5512405))
* **dev:** 🐛 seed named devices and add per-panel settings fixtures ([85000ce](https://github.com/115jon/ralph-meet/commit/85000ce3f41e37abe9cc72effa860f3fe90e20d4))
* **dev:** 🐛 show the reconnect overlay in fixtures and pad its safe area ([59e2088](https://github.com/115jon/ralph-meet/commit/59e2088d8ca9a4d6af3659d70e9582b02bc7c6d8))
* **embeds:** 🐛 cache social media lookups by signature expiry ([51b862b](https://github.com/115jon/ralph-meet/commit/51b862bf3fad1cee7131365e4b1e3be82eb51631))
* **embeds:** 🐛 classify embed failures and cache resolved links ([2e5b455](https://github.com/115jon/ralph-meet/commit/2e5b455399a84749ee9536685db5f896eaf7b8fb))
* **embeds:** 🐛 fix embed overlays, gone posts and media boxes ([72de0a8](https://github.com/115jon/ralph-meet/commit/72de0a8899b380413eeac0d2e238bc1ced413a48))
* **embeds:** 🐛 match spotify to the theme and fix embed link contrast ([0dc8cc8](https://github.com/115jon/ralph-meet/commit/0dc8cc87f476f6e131cd0b1cb59cca3f0351741a))
* **embeds:** 🐛 measure unsized videos before placing the play button ([0b5c576](https://github.com/115jon/ralph-meet/commit/0b5c576493401c223ae5a81b8fa14ce09dcc858b))
* **embeds:** 🐛 read tiktok player durations as seconds ([1a1dac8](https://github.com/115jon/ralph-meet/commit/1a1dac8aa2392258db1a538d91f9b39d341dfb74))
* **embeds:** 🐛 store partial embeds and retry failed links ([4db6918](https://github.com/115jon/ralph-meet/commit/4db69180660a65e0d42e56e9b42ab280304a58c0))
* **listen:** 🐛 move audio options onto the popover and stop 360 clipping ([2ed9e60](https://github.com/115jon/ralph-meet/commit/2ed9e601ec3cbb429613b3b26d05b87c2cf496a1))
* **listen:** 🐛 show readable copy for listen together errors ([7dadf31](https://github.com/115jon/ralph-meet/commit/7dadf3137eb97d209cca450cff7037a7dfbd96a9))
* **presence:** 🐛 cut status dot holes with a mask and ring the surface ([c73b561](https://github.com/115jon/ralph-meet/commit/c73b56166329c28ca220483563ab9fdd23d055df))
* **presence:** 🐛 use status tokens for dots and mute platform icons ([589f4a3](https://github.com/115jon/ralph-meet/commit/589f4a3d981f7877b8cdacc2c590a6e31449cef6))
* **profile:** 🐛 draw frame, effect and decoration on the profile modal ([a4ec4dc](https://github.com/115jon/ralph-meet/commit/a4ec4dcc23628f469b0555b29be7f5c7d20fdcb6))
* **profile:** 🐛 keep frame art inside the profile box and layered right ([220d13b](https://github.com/115jon/ralph-meet/commit/220d13b42bedcbab0dfd5055264f88933d1d7ec4))
* **profile:** 🐛 lay the modal avatar fallback on an accent tint ([73dbefc](https://github.com/115jon/ralph-meet/commit/73dbefcf2e0cdb6cb08d9467276d8c13d0fdae83))
* **profile:** 🐛 let profile theme colours stay on auto ([b0f1ed5](https://github.com/115jon/ralph-meet/commit/b0f1ed585267ea7aa45ce6081bfeda05398a182e))
* **profile:** 🐛 offer call to friends, not blocked users, on phones ([924489d](https://github.com/115jon/ralph-meet/commit/924489d35900e4cc7e1f7323aabe731d10e58ca8))
* **profile:** 🐛 wire popover message and drop dead controls ([373cf74](https://github.com/115jon/ralph-meet/commit/373cf746cfdb0cdee8fb487211c78bb10d7279e1))
* **realtime:** 🐛 raise the heartbeat timeout to 90s ([12530b0](https://github.com/115jon/ralph-meet/commit/12530b08f9bcee761585f235e68dd61c19b8eef3))
* **settings:** 🐛 keep the restart confirm open when it fails ([e005f40](https://github.com/115jon/ralph-meet/commit/e005f40935c7d6ba9de64e2ece3e3710729495e1))
* **settings:** 🐛 land workbench focus on the nav, not the first row ([3581b7b](https://github.com/115jon/ralph-meet/commit/3581b7bc46f3df673129e8cf12eddb3e54c38e2a))
* **settings:** 🐛 put the display name style dialog on the stacked layer ([b4ab16e](https://github.com/115jon/ralph-meet/commit/b4ab16edaa37f624fa61a39685feae9841bd4e29))
* **settings:** 🐛 stop sessions claiming no devices after a failed load ([a917581](https://github.com/115jon/ralph-meet/commit/a917581213c520cfa403d58daf9007824a06cee8))
* **settings:** 🐛 use tabs for shared links and hide raw errors ([2f9ad8f](https://github.com/115jon/ralph-meet/commit/2f9ad8fcb9ef1707275f96ddb853f3e1bb22c1f8))
* **ui:** 🐛 fix light-theme sliders, stage header and avatar fills ([67becb6](https://github.com/115jon/ralph-meet/commit/67becb62bae8fe9fc6178e6d6f7893ae1c8a5773))
* **ui:** 🐛 give disabled solid buttons a tonal state ([939c6d7](https://github.com/115jon/ralph-meet/commit/939c6d7ffaa72be98043a4b7bac35e7cbf4b4c38))
* **ui:** 🐛 give small controls 44px touch targets and press ([fabc933](https://github.com/115jon/ralph-meet/commit/fabc9333d913e57a0b790dcb646af5a38a80b0cb))
* **ui:** 🐛 keep the dialog close button absolutely positioned ([ead4263](https://github.com/115jon/ralph-meet/commit/ead4263b38941019f2f89c506f0f2bf614f8c280))
* **ui:** 🐛 let base ui pick where popover focus lands ([a861e40](https://github.com/115jon/ralph-meet/commit/a861e400826718a309d518edd3a7fea0c2fe8fa8))
* **ui:** 🐛 use accent ink for message links and inline code ([152a906](https://github.com/115jon/ralph-meet/commit/152a906d5ec52e44d44dba4ea9e63d51b5adba2d))
* **voice:** 🐛 drop stream menu items that do nothing ([e049abb](https://github.com/115jon/ralph-meet/commit/e049abb615b383ac82dcd7c3cafe45968e0dcbb5))
* **voice:** 🐛 fade reactions in place under reduced motion ([ae0fa63](https://github.com/115jon/ralph-meet/commit/ae0fa630cf70694c0c7eeb4125a19c33176339ac))
* **voice:** 🐛 fit floating players to phones and let them move ([6953707](https://github.com/115jon/ralph-meet/commit/69537076aadeecf8340fcf08d727f636dbdd0fbd))
* **voice:** 🐛 fit the screen share pickers to phones ([144d1d4](https://github.com/115jon/ralph-meet/commit/144d1d4712de19d4a44b86ac67e31dd7bd597865))
* **voice:** 🐛 pad full-screen call and debug overlays for the notch ([2d68980](https://github.com/115jon/ralph-meet/commit/2d6898012d2e594ae27d2c8915b59e671452b193))
* **voice:** 🐛 read the connection label from the state, not joined ([4bc551d](https://github.com/115jon/ralph-meet/commit/4bc551d91d8525a264a5f0a4f1da595a35edca7e))
* **voice:** 🐛 show call controls on touch and guard fullscreen ([dda7722](https://github.com/115jon/ralph-meet/commit/dda7722c831e7e1b3d24590f66161a8b432cec44))

## [3.2.0](https://github.com/115jon/ralph-meet/compare/v3.1.1...v3.2.0) (2026-10-22)


### Features

* **ui:** ✨ add design tokens, type scale and a visible focus ring ([72ba7b9](https://github.com/115jon/ralph-meet/commit/72ba7b9c19400e0093709e046e00422432039ae9))
* **ui:** ✨ share one dithered loading screen and empty states ([c34691c](https://github.com/115jon/ralph-meet/commit/c34691c3db651991c98880328a66c2fc144d7b34))

## [3.1.1](https://github.com/115jon/ralph-meet/compare/v3.1.0...v3.1.1) (2026-10-22)


### Bug Fixes

* **auth:** 🐛 keep desktop sessions across publishable key changes ([d737745](https://github.com/115jon/ralph-meet/commit/d737745a822bb86c9497a40bb5c1975bf3c62a03))
* **auth:** 🐛 release the code and return to /activate on not you ([823554c](https://github.com/115jon/ralph-meet/commit/823554c3abfaf44fd69e0956021384b884b207b7))
* **security:** 🐛 only follow same-origin redirects after sign-in ([c32da65](https://github.com/115jon/ralph-meet/commit/c32da65f98af5c941fa63011dfd36d1a4a6f7cbc))

## [3.1.0](https://github.com/115jon/ralph-meet/compare/v3.0.0...v3.1.0) (2026-10-22)


### Features

* **auth:** ✨ approve desktop sign-ins at /activate on dithered pages ([8a5e337](https://github.com/115jon/ralph-meet/commit/8a5e337a05a22aa6ad7974f715f0a8fecc0f3347))
* **auth:** approve desktop sign-ins at /activate on dithered pages ([1572756](https://github.com/115jon/ralph-meet/commit/1572756defb1f48b8f88419f9e615139d58e3985))

## [3.0.0](https://github.com/115jon/ralph-meet/compare/v2.0.2...v3.0.0) (2026-10-22)


### ⚠ BREAKING CHANGES

* **voice:** Browser media no longer supports the legacy raw-SFU signaling interfaces; consumers must publish and pull through PartyTracks. Native screen sharing retains its dedicated Calls signaling seam.
* **landing:** Completely new landing page design removes all previous custom UI showcase components (AnimatedChatShowcase, AnimatedVoiceShowcase, HeroInteractiveWorkspace, NetworkVisual)

### Features

* **auth:** ✨ sign in on desktop and mobile with a device code ([edaf484](https://github.com/115jon/ralph-meet/commit/edaf484e05b8b4337e8c60453f43124ed5b2df8e))
* **auth:** sign in on desktop and mobile with a device code ([6a390f6](https://github.com/115jon/ralph-meet/commit/6a390f67a8a021db288e0a57fc3b9d7bd1b96f92))
* **landing:** ✨ add framer-motion animations and bento layout ([cb65c9f](https://github.com/115jon/ralph-meet/commit/cb65c9f69802d9f2f3df79f585010d0743db672c))
* **landing:** ✨ polish homepage motion, a11y, and release fetch ([01eeec2](https://github.com/115jon/ralph-meet/commit/01eeec25cd26be90c11d472a21c3f111d3768a84))


### Bug Fixes

* **audio:** 🐛 align VAD gating with processed audio ([a775ef8](https://github.com/115jon/ralph-meet/commit/a775ef8afdae18ff8db02819796b2fed3d88a4d3))
* **audio:** 🐛 bypass sensitivity gating in Studio mode ([a551731](https://github.com/115jon/ralph-meet/commit/a551731f80f0ada20d0ce3d09d961b74e6bff14a))
* **audio:** 🐛 prevent silence ticks and preserve RNNoise compatibility ([5ab0fd6](https://github.com/115jon/ralph-meet/commit/5ab0fd6460b9a696edace772dcdaa2604bbaadd1))
* **auth:** 🐛 bounce native handoff and actually sign out web ([ef20ede](https://github.com/115jon/ralph-meet/commit/ef20ede4668f7f9a902fd202a77d87fe04945b59))
* **auth:** 🐛 wait for bearer token before web chat bootstrap ([7c9b65d](https://github.com/115jon/ralph-meet/commit/7c9b65d030e6b8bb81f48e1d75bebfcb445000ea))
* **chat:** 🎨 align voice dashboard and user panel styling ([a01294e](https://github.com/115jon/ralph-meet/commit/a01294e94829154d122dd635db82e847d4d10e9e))
* **chat:** 🐛 preserve GIF attachments on message send ([73fd29d](https://github.com/115jon/ralph-meet/commit/73fd29d14d3f4a3e8bbf2feb96058e800d6f1a0d))
* **chat:** 🐛 show voice mute and deafen states ([4f7aee6](https://github.com/115jon/ralph-meet/commit/4f7aee6b586ec1033f27913a696a17008fa40af6))
* **desktop:** 🐛 pin CEF hit-test correction ([efa0ded](https://github.com/115jon/ralph-meet/commit/efa0ded98cdfd0a2ce21e29ba1f9da8c6fba1a0b))
* **dialog:** 🐛 restore interactive portal layers ([8958488](https://github.com/115jon/ralph-meet/commit/8958488143915c92b8c3cdfd9ff0f33ddcb79cea))
* **embeds:** 🐛 tombstone deleted posts and refresh instagram media ([c2b53e9](https://github.com/115jon/ralph-meet/commit/c2b53e90fb0ffc30926facd4fa5f658681d4467c))
* **gif-picker:** 🐛 keep category search from opening suggestions ([865e8e5](https://github.com/115jon/ralph-meet/commit/865e8e5b64b6c1799716bd4152c87074f86d102e))
* **rate-limit:** 🐛 give proxy media its own request ceiling ([d1764d9](https://github.com/115jon/ralph-meet/commit/d1764d927a7c17f011823c32e0021f1ef77511f8))
* **security:** 🔒 harden document response headers ([378d856](https://github.com/115jon/ralph-meet/commit/378d856652f73b63102b020e4ff2bc003c079f15))
* **ssr:** 🐛 stabilize browser-only reads during SSR ([8d9b5f2](https://github.com/115jon/ralph-meet/commit/8d9b5f2218d72afae89a804e651c643969e7e9c8))
* **ui:** 🐛 keep modal selects from closing their dialogs ([b81e38d](https://github.com/115jon/ralph-meet/commit/b81e38d856df2e1a32b8533d84ebbebcd9ab16e6))
* **ui:** 🐛 normalize overlay z-index utilities ([262ec45](https://github.com/115jon/ralph-meet/commit/262ec45e9c902ff72b1e1ada4ad2a2f81af4c623))
* **ui:** 🐛 render emoji tokens in dynamic names ([48dbf80](https://github.com/115jon/ralph-meet/commit/48dbf804df94a6ab2bc61c48ca59f421f178bc09))
* **ui:** 🐛 render home icon from static assets ([b871ebc](https://github.com/115jon/ralph-meet/commit/b871ebc1c4d0ba9102e72ff1b1947db51cda40fa))
* **ui:** 🐛 type the select dismiss guard without a self reference ([3dc26a1](https://github.com/115jon/ralph-meet/commit/3dc26a19939126a2dc5b68f2d931b95c0b4c252d))
* **ui:** 💄 remove app-wide blur effects ([c63c4e2](https://github.com/115jon/ralph-meet/commit/c63c4e22f1dc7160542a901015fd3cf2e856215a))
* **validation:** 🔒 disable Zod JIT under CSP ([18b33f7](https://github.com/115jon/ralph-meet/commit/18b33f71f1a656ed1fb0ec6fabed4be8de831d05))
* **voice:** 🐛 keep speaking indicator after leave/rejoin ([4360e15](https://github.com/115jon/ralph-meet/commit/4360e15f2f1fe20870b645829c912605366e8ee1))
* **voice:** 🐛 preserve local speaking state on voice-ready ([02a6629](https://github.com/115jon/ralph-meet/commit/02a662997aff4ab8d2f32a29cb5b29b4c7c5608b))
* **voice:** 🐛 propagate profile updates across voice sessions ([f3ce7b0](https://github.com/115jon/ralph-meet/commit/f3ce7b0bda78ef32d11552f044c706c3b9de1c94))
* **voice:** 🐛 recover SFU media after signaling loss ([0053c3e](https://github.com/115jon/ralph-meet/commit/0053c3ed52c67ef7634838013c4f7ca5f0d4a2ae))
* **voice:** 🐛 reduce join latency and harden media lifecycle ([e9b3605](https://github.com/115jon/ralph-meet/commit/e9b36055d0bda69b7cfaa1378b00261dfb84e7aa))
* **voice:** 🐛 refresh SFU credentials and remote pulls ([9f789b0](https://github.com/115jon/ralph-meet/commit/9f789b0a362d9e5685283c7dc246a13c0e85a0e7))
* **voice:** 🐛 restore PartyTracks after reconnect ([54cffc8](https://github.com/115jon/ralph-meet/commit/54cffc89cee9507e9f1ee6b074bc85907419643f))
* **voice:** 🐛 wire microphone monitoring and speaking state ([e474868](https://github.com/115jon/ralph-meet/commit/e474868bf7fa3b38ab5542cb7d1f7f01d5681678))
* **voice:** 🐛 wire screen preview hide into DM calls ([530a3c1](https://github.com/115jon/ralph-meet/commit/530a3c13c95d93c56d106c77c15caee1476fbf73))


### Performance Improvements

* **chat:** ⚡️ stop message list scroll jumps ([14171b1](https://github.com/115jon/ralph-meet/commit/14171b1a36202f784bd28c3f8fcb1c07a90bde19))
* **voice:** ⚡️ prewarm PartyTracks from room ticket ([6117f36](https://github.com/115jon/ralph-meet/commit/6117f362587c8d84a84ea88d1b77b075f3f4a6fb))


### Code Refactoring

* **landing:** ♻️ redesign homepage with real screenshots and clean SaaS aesthetic ([1517cca](https://github.com/115jon/ralph-meet/commit/1517cca8b0f5de4925d55fc03542fcfb5ee2c9d5))
* **voice:** ♻️ move browser media to PartyTracks ([65748f2](https://github.com/115jon/ralph-meet/commit/65748f2839c0d97e7983676bb3edc89e9ecc6979))

## [2.0.2](https://github.com/115jon/ralph-meet/compare/v2.0.1...v2.0.2) (2026-07-25)


### Bug Fixes

* **voice:** 🐛 cancel delayed leave callbacks on unmount ([e1c5e9e](https://github.com/115jon/ralph-meet/commit/e1c5e9efa2bf2ff81329aa339704e6eb99f4aad0))
* **voice:** cancel delayed leave callbacks on unmount ([975fb49](https://github.com/115jon/ralph-meet/commit/975fb4943d184e0859e2bfc46d91f56cab25b44a))

## [2.0.1](https://github.com/115jon/ralph-meet/compare/v2.0.0...v2.0.1) (2026-07-24)


### Bug Fixes

* **desktop:** 🐛 harden window lifecycle and updater handoff ([92e15a4](https://github.com/115jon/ralph-meet/commit/92e15a492e0381f9010bd2670314a7e393dbb4de))
* **desktop:** 🐛 prevent DPI titlebar clicks from closing ([47a7b37](https://github.com/115jon/ralph-meet/commit/47a7b37075951990cb1be0164e36787abc5bc1b3))
* **desktop:** prevent DPI titlebar clicks from closing ([7ff230a](https://github.com/115jon/ralph-meet/commit/7ff230adcd519905b8cc466ca7755bcb6f6889d3))

## [2.0.0](https://github.com/115jon/ralph-meet/compare/v1.20.0...v2.0.0) (2026-07-23)


### ⚠ BREAKING CHANGES

* **listen-together:** listen_together.pause, listen_together.seek, and listen_together.skip commands now require entryId matching the current queue entry.
* Native deep links carrying session_token are rejected; use the short-lived auth-code handoff instead.
* **voice:** rename the internal VoiceActivity store exports to generic Activity names.
* **platform:** Native deep links carrying session_token are rejected; use the short-lived auth-code handoff instead.

### Features

* ✨ merge accumulated mainline changes ([7881468](https://github.com/115jon/ralph-meet/commit/78814684f48ed3cc62b7f4c2f9938e384b4f55a1))
* **chat:** ✨ add media actions and accurate X GIF WebP handling ([64e4bd9](https://github.com/115jon/ralph-meet/commit/64e4bd93aec05f1ba20e4eb68c6b4af709e77895))
* **chat:** ✨ add reaction details and picker interactions ([9d3b6c1](https://github.com/115jon/ralph-meet/commit/9d3b6c1248808f1a38efe69cbf1a6f25a5bd5cbf))
* **chat:** ✨ animate user panel identity and profile trigger ([00131c3](https://github.com/115jon/ralph-meet/commit/00131c394a15259292911cf7fdd03a1959397bde))
* **desktop:** ✨ add native custom titlebar ([1377440](https://github.com/115jon/ralph-meet/commit/13774407ee8a61a753676aea3bddcd80fb8d6b77))
* **listen-together:** ✨ preview pasted media links ([b298495](https://github.com/115jon/ralph-meet/commit/b298495160ddde026f57773a84f9288265b389bd))
* **listen-together:** ✨ ship interactive listening workspace ([9f4bd5d](https://github.com/115jon/ralph-meet/commit/9f4bd5d5507fd881fa842c38faf3448a320d3f4f))
* **profile:** ✨ add avatar picker and upload history ([8018170](https://github.com/115jon/ralph-meet/commit/801817086c46fd41b3bc450e459b50186221872d))
* **profile:** ✨ unify collectible profile surfaces ([14ab3ea](https://github.com/115jon/ralph-meet/commit/14ab3eafa14ce448bbb36bc8282ac47543e278b9))
* **realtime:** ✨ defer message postprocessing through queues ([fb1f712](https://github.com/115jon/ralph-meet/commit/fb1f712d7a3ec2811a8bc23b5eaa85576bc98f5e))
* **realtime:** ✨ optimize gateway payloads and DM soundboards ([fad3e58](https://github.com/115jon/ralph-meet/commit/fad3e58dd80dbb60581391778040776edcb81ae0))
* **realtime:** 🏗️ add durable background state processing ([5782990](https://github.com/115jon/ralph-meet/commit/57829908aa5f5afc572538814e0bd181ad23b2e3))
* **safe-fetch:** ✨ add streaming-aware safeFetch helper with capped readers ([72ea937](https://github.com/115jon/ralph-meet/commit/72ea937af16b577c0a94cc9e20299c10567ebc18))
* **soundboard:** ✨ add scoped playback manager and VAD activity ([e28c344](https://github.com/115jon/ralph-meet/commit/e28c344e3ce0595a79355a739902b17df7633c9c))
* **voice:** ✨ add per-server soundboard triggers ([38c154a](https://github.com/115jon/ralph-meet/commit/38c154a448eda4f02b447b8e427284390e198c1d))
* **voice:** ✨ move listen-together playback to floating UI ([#51](https://github.com/115jon/ralph-meet/issues/51)) ([c5ea7e4](https://github.com/115jon/ralph-meet/commit/c5ea7e4fe4c1624c7bcaea9f3017a44558288c21))
* **voice:** ✨ unify room media playback ([5e2e033](https://github.com/115jon/ralph-meet/commit/5e2e0338dd08ce5380f3d8e57dbf20cef1ef14ed))
* **wordle:** ✨ add onboarding and invalid guess feedback ([ce19d84](https://github.com/115jon/ralph-meet/commit/ce19d842c1e2cce637dc7dbb8da0cd867f950b84))


### Bug Fixes

* **api:** 🔒 add permissive zod validation for request bodies ([4a37cf9](https://github.com/115jon/ralph-meet/commit/4a37cf95012c82d7fef86e0a876058dc5372bf77))
* **api:** 🔒 validate channel request bodies ([755f366](https://github.com/115jon/ralph-meet/commit/755f366ef9801393b2f4aad202a2886f5349b872))
* **api:** 🔒 validate media request bodies ([666d2d7](https://github.com/115jon/ralph-meet/commit/666d2d723dd971f5cb597e2bc95c1c9d56754f6b))
* **api:** 🔒 validate server request bodies ([e631f40](https://github.com/115jon/ralph-meet/commit/e631f406cc97ed48daf8e0a2b454aca6dc2f8b64))
* **api:** 🔒 validate social request bodies ([65975ba](https://github.com/115jon/ralph-meet/commit/65975bafc20fe713c83da19a2985251a634087e3))
* **chat:** 🐛 improve mobile navigation layout ([b0ea0d6](https://github.com/115jon/ralph-meet/commit/b0ea0d6204a6caa703264e9e43d627bf694b3a47))
* **chat:** 🐛 keep sidebar channels clear of user panel ([d3934b3](https://github.com/115jon/ralph-meet/commit/d3934b3b9776469e35414f921e45be6dc2cb625b))
* **chat:** 🐛 normalize server flags for name edits ([#49](https://github.com/115jon/ralph-meet/issues/49)) ([f7dbb36](https://github.com/115jon/ralph-meet/commit/f7dbb36797eaf8dd4788a48c3843dfca7231bee2))
* **chat:** 🐛 preserve channel URLs without remounting chat ([c3547d3](https://github.com/115jon/ralph-meet/commit/c3547d3fc9ca5464da015783dfa25444699f2420))
* **chat:** 🐛 prevent home icon mask collisions ([8730bdc](https://github.com/115jon/ralph-meet/commit/8730bdc2550b8918f722b390d490ad6aa04a8b22))
* **chat:** 🐛 restore route-aware title bars ([8a1c98b](https://github.com/115jon/ralph-meet/commit/8a1c98b1e0fa640cba95c6ee5e0a46d08b55133d))
* **chat:** 🐛 stabilize chat state synchronization ([aa415dc](https://github.com/115jon/ralph-meet/commit/aa415dc4959f1a825f735453ad846949f6552a53))
* **chat:** 🐛 stabilize profile editor and soundboard drag ([0984579](https://github.com/115jon/ralph-meet/commit/098457986f7368e57923c9abe3af4a5ae40b68e1))
* **chat:** 🐛 stop notification updates from reloading history ([a15420c](https://github.com/115jon/ralph-meet/commit/a15420c4162ed9431c22d1c57a278c4923dbd90e))
* **chat:** 🐛 swap quick reply for edit on own messages ([433df84](https://github.com/115jon/ralph-meet/commit/433df848fe2c5e9105999ebac7cd71ddd27c51bf))
* **chat:** 🐛 unify theme-aware status indicators ([79c366e](https://github.com/115jon/ralph-meet/commit/79c366ef2f63110f879dfa1eb8de911d9ef19a73))
* **ci:** 🐛 configure Worker capability secret ([73d375a](https://github.com/115jon/ralph-meet/commit/73d375a71c888838b024e8157bc52da81b91b57a))
* **ci:** 🐛 ignore generated changelog formatting ([267c40d](https://github.com/115jon/ralph-meet/commit/267c40d8b0e6e0b4829ac0d3d1cf06ba57207ac3))
* **ci:** 🐛 ignore generated changelog formatting ([448a15d](https://github.com/115jon/ralph-meet/commit/448a15d0e16257939238879f8781ba73ba740cb0))
* **ci:** 🐛 serialize Worker runtime tests ([6cda657](https://github.com/115jon/ralph-meet/commit/6cda657bb351acc08d2a794284520f3a5922a0de))
* **desktop:** 🐛 harden native titlebar lifecycle ([b9f15b3](https://github.com/115jon/ralph-meet/commit/b9f15b322f014760accc7e1d8c8faf6180353e96))
* **dev:** 🐛 type optional Vite dependency exclusions ([f3f46bc](https://github.com/115jon/ralph-meet/commit/f3f46bcbb79126afe8f1a9a7c8dc311e4ec7d60e))
* **embeds:** 🔒 route external fetchers through safeFetch with capped reads ([55a8a1b](https://github.com/115jon/ralph-meet/commit/55a8a1b33d67707911dfea874af664a196c1e8b1))
* **listen-together:** 🐛 avoid playback resync when opening queue ([170a9b8](https://github.com/115jon/ralph-meet/commit/170a9b8cffa858fe9095d098cdaa3bbb674535e8))
* **listen-together:** 🐛 fix player layout and contrast ([0fc4564](https://github.com/115jon/ralph-meet/commit/0fc4564478647b109d71ac91a3b5f850a2d46e8b))
* **listen-together:** 🐛 harden playback synchronization ([cc6b548](https://github.com/115jon/ralph-meet/commit/cc6b548d752168172bb18e329f7e31efab4a3c87))
* **listen-together:** 🐛 keep playback synced across tracks ([d88cc45](https://github.com/115jon/ralph-meet/commit/d88cc4532e59f3df90d1e9bb72c3e002cb26ebf3))
* **listen-together:** 🐛 preserve cross-browser playback ([7122b23](https://github.com/115jon/ralph-meet/commit/7122b231c1051d284aa6e02c30390aa40c8145b6))
* **media:** 🐛 prevent passive microphone capture ([6cd2f40](https://github.com/115jon/ralph-meet/commit/6cd2f401efaf685f712570ebd01cd5b2c472c009))
* **media:** 🔒 tighten proxy host allowlist ([7c80c8a](https://github.com/115jon/ralph-meet/commit/7c80c8aa6d4f5934fd7a8533a86f08846c356608))
* **navigation:** 🐛 isolate back button history cleanup ([3fafc62](https://github.com/115jon/ralph-meet/commit/3fafc625f9a5f3dc6017c0d39f63829da1e38fc8))
* **platform:** 🔒 harden realtime access and package boundaries ([1fb6988](https://github.com/115jon/ralph-meet/commit/1fb6988be4fd2d5f3e56ec0f662c3d7f997e4165))
* **profile-frame:** 🐛 contain border layers within surfaces ([d2d81e3](https://github.com/115jon/ralph-meet/commit/d2d81e38eb674d3be96d943ebc705f4d72051a7a))
* **profile-frame:** 🐛 fit framed editor previews to frame bounds ([3c9d479](https://github.com/115jon/ralph-meet/commit/3c9d479f24238f85d1976cf18b5ca9ecde6d7cf4))
* **profile-mobile:** 🐛 contain themed drawer content within frame ([31b25a5](https://github.com/115jon/ralph-meet/commit/31b25a5bd229b4741a8d847ee10f081246191245))
* **profile:** 🐛 validate identity edits with shared Zod schemas ([a4cec09](https://github.com/115jon/ralph-meet/commit/a4cec09416410f8e92f9b5c266772684cfbb63cd))
* **rate-limiter:** 🔒 persist DO rate-limit buckets to SQLite storage ([58e1de4](https://github.com/115jon/ralph-meet/commit/58e1de43c77a02b941341e78330b72528ce8e828))
* **realtime:** 🐛 harden websocket resume continuity ([58afc2a](https://github.com/115jon/ralph-meet/commit/58afc2a3c187423ce2dd5c9b7583db2df83ebcaa))
* **realtime:** 🐛 resume chat gateway events safely ([3ab4f5b](https://github.com/115jon/ralph-meet/commit/3ab4f5bd2e8c66eddbcb2bcdd84c99a276c4504a))
* **routes:** 🐛 ignore soundboard upload test as route ([bf2be65](https://github.com/115jon/ralph-meet/commit/bf2be65b69d3900a0656dc6526538e8bd7acc9ed))
* **server:** 🔒 hide internal error details ([5b14a9d](https://github.com/115jon/ralph-meet/commit/5b14a9d84e8335131291ad5485a20b051c0e300d))
* **shop:** 🐛 use Yapper as the sole catalog source ([d7a3ff0](https://github.com/115jon/ralph-meet/commit/d7a3ff0e1ff7b2b14b9c40ab7dfdfa020ea8358f))
* **soundboard:** 🐛 broadcast and bound automatic playback ([36f47b6](https://github.com/115jon/ralph-meet/commit/36f47b6006157e89bc5bd04cdf46a2305db31d16))
* **tooling:** 🐛 complete lint baseline ([6c793d8](https://github.com/115jon/ralph-meet/commit/6c793d8bb10b59b5df5b7df8be5dad106dce7a6f))
* **types:** 🐛 restore Cloudflare payload type safety ([1e5adbe](https://github.com/115jon/ralph-meet/commit/1e5adbe0d26f4098ddaa92c27b19799e0da719c3))
* **ui:** 🐛 prevent modal focus from resetting scroll ([6979ead](https://github.com/115jon/ralph-meet/commit/6979ead30fabcaa6f5afe3b74c03eeecd64a41c0))
* **ui:** 🐛 prevent splash logo hydration mismatch ([d850b52](https://github.com/115jon/ralph-meet/commit/d850b527a809d4ef2e43b73c38b3370aaf320f1e))
* **ui:** 🐛 prevent splash logo theme flicker ([c8209ad](https://github.com/115jon/ralph-meet/commit/c8209ad78eae43794da1770962202cab2eeb4723))
* **voice:** 🐛 analyze the raw microphone for speaking state ([3aa49a6](https://github.com/115jon/ralph-meet/commit/3aa49a693e90625e9bf52edd1aecb322d09e9ad7))
* **voice:** 🐛 dispose SFU and audio lifecycle resources ([7f255f4](https://github.com/115jon/ralph-meet/commit/7f255f4045ca325bc77153309f0b35bbff416e5e))
* **voice:** 🐛 harden asynchronous media lifecycle ([1e8746e](https://github.com/115jon/ralph-meet/commit/1e8746e317c7f0199b88fa6817eef63348f4ec62))
* **voice:** 🐛 ignore expected listen-together play cancellation ([4694282](https://github.com/115jon/ralph-meet/commit/46942822111085703714e71e1f18411d60db3974))
* **voice:** 🐛 keep camera publishing live in background ([64cf6de](https://github.com/115jon/ralph-meet/commit/64cf6de94ec7316fc5ae84146ba761e3fffed270))
* **voice:** 🐛 log SFU teardown reasons ([1b7b6d8](https://github.com/115jon/ralph-meet/commit/1b7b6d8e5376e666fa14f24a30be0d686cb3a714))
* **voice:** 🐛 preserve call when navigating to text ([b0c46df](https://github.com/115jon/ralph-meet/commit/b0c46dfb5a8438b8db99b2c7732bdca238f6fd5d))
* **voice:** 🐛 restore Cloudflare pull negotiation ([7db6524](https://github.com/115jon/ralph-meet/commit/7db652433d52ed12ee323fcb688826fc17c59ea1))
* **voice:** 🐛 restore spatial audio join guard ([fe1e7e9](https://github.com/115jon/ralph-meet/commit/fe1e7e90731bf94f572a92feeeb887b4eeb43227))
* **voice:** 🐛 scope VAD to the outbound microphone ([64a5bb7](https://github.com/115jon/ralph-meet/commit/64a5bb7a01c97341bc7acc45739c7fbdff75e2d0))
* **voice:** 🐛 stabilize playback and focused stage ([376d060](https://github.com/115jon/ralph-meet/commit/376d060388f9e9612536dac249e428edfa3d3d3d))
* **wordle:** 🐛 enforce valid guesses and secure activity sync ([5956227](https://github.com/115jon/ralph-meet/commit/595622753d5a2e2fb797946a6382de776612a772))


### Performance Improvements

* **chat:** ⚡️ speed up channel history loading ([8c459e1](https://github.com/115jon/ralph-meet/commit/8c459e10f4ce61bc024a401e08e6a5063a432ac1))
* **listen-together:** ⚡️ batch Spotify playlist resolution ([dac8d66](https://github.com/115jon/ralph-meet/commit/dac8d66e73ceb743740c7202a7768d0cbc1eb24e))
* **meeting-room:** ⚡️ batch channel access checks ([a07b8a0](https://github.com/115jon/ralph-meet/commit/a07b8a016e7dc2c8267f7be881c055be8a0fa20e))
* **meeting-room:** ⚡️ batch server-membership check in broadcastToServerMembers ([2d83a6c](https://github.com/115jon/ralph-meet/commit/2d83a6cbceb0555e624e61a067c670e3c29284d8))
* **proxy-media:** ⚡️ stream synthetic range slices instead of buffering full body ([6fb7cd0](https://github.com/115jon/ralph-meet/commit/6fb7cd09fce7010cb16184c56f1ed798ef141411))
* **voice:** ⚡️ isolate listen-together playback renders ([7d7ab37](https://github.com/115jon/ralph-meet/commit/7d7ab37c043b9892c563f3b9f72ef1e0cf19857b))


### Code Refactoring

* ♻️ consolidate realtime under root Worker ([#54](https://github.com/115jon/ralph-meet/issues/54)) ([39ef729](https://github.com/115jon/ralph-meet/commit/39ef729ce40223a6bfc5f7e61bfb8f7cabf7ef9f))

## [1.20.0](https://github.com/115jon/ralph-meet/compare/v1.19.1...v1.20.0) (2026-07-10)

### Features

- **listen-together:** ✨ add local loudness control ([7c86974](https://github.com/115jon/ralph-meet/commit/7c86974973750ff9dedd3102ed4b55f6381ab28c))
- **voice:** 🔒 add realtime socket admission ([0b1b1b5](https://github.com/115jon/ralph-meet/commit/0b1b1b5fbedc3e04bcfe1fd3cb937b8a38a03c8d))
- **voice:** 🔒 add realtime socket admission ([12b4ab7](https://github.com/115jon/ralph-meet/commit/12b4ab7ad40cb71e12b57bca70ac37041e286fe1))

### Bug Fixes

- **desktop:** 🐛 default installed capture policy to wgc-enabled ([84c777f](https://github.com/115jon/ralph-meet/commit/84c777f5959e3cebcbacbaaaa44e149425399da9))
- **desktop:** 🐛 persist settings and relaunch safely ([4b42b6f](https://github.com/115jon/ralph-meet/commit/4b42b6f358915f0633ba195cbc42037a05a8bbb4))
- **listen-together:** 🐛 contain loudness switch thumb ([443a945](https://github.com/115jon/ralph-meet/commit/443a9452a914d66d0edd38a5c63a1f524dd7c26d))
- **listen-together:** 🐛 refresh stale playback urls and add logs ([e238d54](https://github.com/115jon/ralph-meet/commit/e238d543ec64af364e407e77090d053b50d4b377))
- **sync:** 🐛 propagate cross-session chat updates ([fec8f54](https://github.com/115jon/ralph-meet/commit/fec8f544a1d1a47a18b788f5b13e5e1a2faaaa23))
- **voice:** 🐛 restore admitted websocket upgrades ([bfe84f9](https://github.com/115jon/ralph-meet/commit/bfe84f95765a294dde9e067442ba952bbb8ed6db))
- **voice:** 🐛 start socket after ticket fetch ([41192a0](https://github.com/115jon/ralph-meet/commit/41192a074b992d5a8de6f6f0f29d68d979bbe5df))
- **voice:** 🐛 wire mini preview context menu actions ([16e89ff](https://github.com/115jon/ralph-meet/commit/16e89ffde0972777af37d6b0ff1e2e4d7740ba98))
- **voice:** 🔒 harden sfu lifecycle diagnostics ([91179df](https://github.com/115jon/ralph-meet/commit/91179df3bb3eca3ed1e2c99f80185d2303b4fb95))

### Performance Improvements

- **theme:** ⚡️ simplify theme rendering and bundle fonts ([0b7f612](https://github.com/115jon/ralph-meet/commit/0b7f612af4ee3d5727f2b224d9f9611db8fead5b))

## [1.19.1](https://github.com/115jon/ralph-meet/compare/v1.19.0...v1.19.1) (2026-07-09)

### Bug Fixes

- **chat:** 🐛 avoid nested buttons in gif media tiles ([e3658a1](https://github.com/115jon/ralph-meet/commit/e3658a1d5c81c8426310a89bb85a8d99184b0ad1))
- **profile:** 🐛 persist default profile theme colors ([c1491c1](https://github.com/115jon/ralph-meet/commit/c1491c158628af6672d51e7cfcd954e2e6df9c36))

## [1.19.0](https://github.com/115jon/ralph-meet/compare/v1.18.0...v1.19.0) (2026-07-09)

### Features

- **chat:** ✨ unify profile previews and add thumbnail call controls ([f02184b](https://github.com/115jon/ralph-meet/commit/f02184bee866226426d202e254ea0444fbce0e76))
- **voice:** ✨ add compact listen together player ([a694e04](https://github.com/115jon/ralph-meet/commit/a694e04e2f573c4d3faf49c120856374c443683e))

### Bug Fixes

- **profile:** 🐛 correct edit modal profile previews ([293ebac](https://github.com/115jon/ralph-meet/commit/293ebacce518163f81e6ef0fe9c6591e7bd79c6e))

## [1.18.0](https://github.com/115jon/ralph-meet/compare/v1.17.0...v1.18.0) (2026-07-08)

### Features

- **activities:** ✨ add warp rush 3d prototype ([b5af8e6](https://github.com/115jon/ralph-meet/commit/b5af8e6872fdaffd8952b2c9ad43fc6cdca313b2))

### Bug Fixes

- **chat:** 🐛 unify custom nameplate mask rendering ([1f1e2a5](https://github.com/115jon/ralph-meet/commit/1f1e2a5a121af414a846bccf8d5f4fd34c300dc5))
- **profile:** 🐛 align profile effect preview typings ([34f555a](https://github.com/115jon/ralph-meet/commit/34f555aba9266c5cc8433df00400a8d01f8d4b09))
- **profile:** 🐛 keep collectible edits local until save ([8c03e78](https://github.com/115jon/ralph-meet/commit/8c03e789a622e69437478a03c6918c4d4f7c5533))

## [1.17.0](https://github.com/115jon/ralph-meet/compare/v1.16.0...v1.17.0) (2026-07-08)

### Features

- **chat:** ✨ add resizable left sidebar ([7562ace](https://github.com/115jon/ralph-meet/commit/7562ace2ea2b6ff4680050dbee85020da0cfe0b4))
- **profile:** ✨ add live profile metadata and presence surfaces ([7c7c3a8](https://github.com/115jon/ralph-meet/commit/7c7c3a8ea97cdb169abb6aaf45f630e00c78e959))

### Bug Fixes

- **channels:** 🐛 preserve decorated names across chat ui ([80cf37b](https://github.com/115jon/ralph-meet/commit/80cf37b8b5c464f622f3644e5ce1809d3cf253f1))
- **chat:** 🐛 render TikTok embed emoji inline ([8a2d78c](https://github.com/115jon/ralph-meet/commit/8a2d78ccc0f27a83fa5c15d9239efdb14d3aa5ff))
- **profile:** 🐛 fix themed profile previews and status actions ([ca873ad](https://github.com/115jon/ralph-meet/commit/ca873adeba74fb33ec201426456a33570514e206))

## [1.16.0](https://github.com/115jon/ralph-meet/compare/v1.15.0...v1.16.0) (2026-07-07)

### Features

- **profile:** ✨ add profile themes and display name styling ([7256f48](https://github.com/115jon/ralph-meet/commit/7256f485ee89bbaa79eabe03879d4d31674f4177))

### Bug Fixes

- **chat:** 🐛 render styled display names in member lists ([f4bf588](https://github.com/115jon/ralph-meet/commit/f4bf588e0e16388c1f5acefa072e735d0006c275))
- **desktop:** 🐛 restore desktop command permissions ([3269c51](https://github.com/115jon/ralph-meet/commit/3269c512a89c39ee58c63dda6e2933e7816e57c5))
- **embeds:** 🐛 build instagram embeds without oembed ([a9badfb](https://github.com/115jon/ralph-meet/commit/a9badfb02abfeb732a64bf71c24c0918e2641445))
- **embeds:** 🐛 refresh stale Instagram and TikTok embeds ([896663b](https://github.com/115jon/ralph-meet/commit/896663b3ba9a97f0d581156e8890d236005f29b3))
- **embeds:** 🐛 refresh tiktok assets and share hydration ([0ad1565](https://github.com/115jon/ralph-meet/commit/0ad1565ec16c8baa4b8df6459ff708c09b7a43f4))
- **embeds:** 🐛 restore Instagram author metadata ([eecb625](https://github.com/115jon/ralph-meet/commit/eecb625ee3a4df778cadc26f31d0f867a6a8eb20))
- **embeds:** 🐛 use video attachments for instagram media ([fd9d654](https://github.com/115jon/ralph-meet/commit/fd9d654d918d98387af13d81b5d78e6ddc8a633f))
- **listen-together:** 🐛 harden remote youtube resolution ([2f6d3b5](https://github.com/115jon/ralph-meet/commit/2f6d3b5b8997e2191d9de65382c686a8bd8ecb1f))
- **listen-together:** 🐛 isolate youtube fallback clients ([b037f27](https://github.com/115jon/ralph-meet/commit/b037f2709268a2997f4102ba810f3acd3b5001b4))
- **voice:** 🐛 stabilize dashboard overlays and diagnostics ([ab9f394](https://github.com/115jon/ralph-meet/commit/ab9f394cb40e7d841e9e6e4518163e6d9893ab36))

## [1.15.0](https://github.com/115jon/ralph-meet/compare/v1.14.1...v1.15.0) (2026-07-07)

### Features

- **avatar:** ✨ add avatar framing and collectible displays ([bcff1a6](https://github.com/115jon/ralph-meet/commit/bcff1a69d7561712492f4f334e72ca4755173031))
- **chat:** ✨ add message delete modal ([3d9d370](https://github.com/115jon/ralph-meet/commit/3d9d3709d3a1e62559e88d635ba9d19d965a1f95))
- **client:** ✨ integrate react-scan and lazily load hydration ([4a8cda5](https://github.com/115jon/ralph-meet/commit/4a8cda594b12f6ffb6b6ddc1c715ed0de93921e7))
- **desktop:** ✨ add sign-in link fallback ([ebd7dcd](https://github.com/115jon/ralph-meet/commit/ebd7dcd8f2246d872497c02a930a4795080d977a))
- **desktop:** ✨ show startup handoff status ([bc4ca52](https://github.com/115jon/ralph-meet/commit/bc4ca524d0ca2a4f8587a363ef5bba1bf3169154))
- **embeds:** ✨ add x tweet text expansion controls ([21a48f9](https://github.com/115jon/ralph-meet/commit/21a48f9decfd59c5e369cef65f9ee3dd74ff93af))
- **embeds:** ✨ refine instagram embeds and viewer gestures ([d4ac1fd](https://github.com/115jon/ralph-meet/commit/d4ac1fddcb639e0b6296887a474db08617b9816e))
- **embeds:** ✨ refine x embed rendering ([89ef0f9](https://github.com/115jon/ralph-meet/commit/89ef0f970b8e31990fbd07b5a11d3c2b01cd9107))
- **listen-together:** ✨ add worker-native audio queue and resolver ([c86025d](https://github.com/115jon/ralph-meet/commit/c86025d1075afed06f0aef582ce2c69c561138c7))
- **media:** ✨ persist video playback preferences ([8602117](https://github.com/115jon/ralph-meet/commit/8602117e3124df4507d80b0a2632c4e28c9df189))
- **notifications:** ✨ show unread count in title ([1f31158](https://github.com/115jon/ralph-meet/commit/1f311585519c1131fe53198c752f0f35ebbad54d))
- **room:** ✨ add room link copy action ([0fcab17](https://github.com/115jon/ralph-meet/commit/0fcab178cd7d9b847656976c282d5887d4e5a519))
- **room:** ✨ clarify demo chat limits ([c23bf1d](https://github.com/115jon/ralph-meet/commit/c23bf1d3f923fb4b65e61904de5437e33472ff14))
- **room:** ✨ show screen share viewers ([43c141b](https://github.com/115jon/ralph-meet/commit/43c141be54eeec9fa69271acf2c41a272ecbbb63))
- **room:** ✨ warn when microphone is missing ([25815b6](https://github.com/115jon/ralph-meet/commit/25815b6d39d4c2b9b4a62818c0798dfe1304fe53))
- **settings:** ✨ improve profile customization controls ([dde0864](https://github.com/115jon/ralph-meet/commit/dde086466c266585807d7bd7f84de0cac1b4f8cf))
- **settings:** ✨ redesign profile settings experience ([2c0fcd6](https://github.com/115jon/ralph-meet/commit/2c0fcd6363e2009d9c3952889899ab1b48be1696))
- **shop:** ✨ add collectible detail modal ([2345327](https://github.com/115jon/ralph-meet/commit/234532718e8cf3f1ad5a4cf9742114f5b22a7e79))
- **shop:** ✨ cache collectibles and mirror yapper browsing ([bff6575](https://github.com/115jon/ralph-meet/commit/bff657548a82bbfc95a5676cfa690ddb8ed3ef19))
- **voice:** ✨ add rnnoise noise suppression controls ([ff14cc8](https://github.com/115jon/ralph-meet/commit/ff14cc8b0e8cc92b43fa1b366bf60c61b0ed1dd5))
- **voice:** ✨ copy diagnostics bundle ([c0768fe](https://github.com/115jon/ralph-meet/commit/c0768fec7211b7872a92889cb07c34627adfa8bc))
- **voice:** ✨ remember screen share defaults ([0e743c4](https://github.com/115jon/ralph-meet/commit/0e743c44e2d26aacb17e609cc62249e4abf1207b))
- **voice:** ✨ show room connection status ([0579fe4](https://github.com/115jon/ralph-meet/commit/0579fe40fddd36fa06c3d9842dcf8fd81e64b9da))
- **web:** ✨ use green favicon in development ([57e3321](https://github.com/115jon/ralph-meet/commit/57e3321edb22c9718e269a34572f0ef3440c78ff))
- **worker:** ✨ add health check endpoint ([9e60e18](https://github.com/115jon/ralph-meet/commit/9e60e18e095ebb314dd63bfa3849a5c4300f5638))

### Bug Fixes

- **a11y:** 🐛 add explicit button types ([f577012](https://github.com/115jon/ralph-meet/commit/f5770126840e418234afca583de52823e02caff3))
- **chat:** 🐛 avoid hard reloads after auth callback ([45abe7f](https://github.com/115jon/ralph-meet/commit/45abe7f53c65fd48c004c1f95fca451157222c8a))
- **chat:** 🐛 avoid nested buttons in dm list ([88bff0c](https://github.com/115jon/ralph-meet/commit/88bff0c5376a3e5aa2c9e54cf25b97cb173cfbab))
- **chat:** 🐛 collapse duplicate channels after create ([6bf6960](https://github.com/115jon/ralph-meet/commit/6bf6960312595b65b21eea68881a0b267f08c22b))
- **chat:** 🐛 defer proxied x video loads ([cf82c9e](https://github.com/115jon/ralph-meet/commit/cf82c9e4eda6cd4bf7ddf58fb58027e59fcc86aa))
- **chat:** 🐛 hydrate tiktok embeds into the custom player ([a67f777](https://github.com/115jon/ralph-meet/commit/a67f777d47a9766508754c696c163024c79f56b9))
- **chat:** 🐛 polish tiktok slideshow embeds ([ffed626](https://github.com/115jon/ralph-meet/commit/ffed626906ee2f12f5c072ef90d2f0fde1120c45))
- **chat:** 🐛 show initial loading tips ([855739b](https://github.com/115jon/ralph-meet/commit/855739b225946eb924e41f7ade25d4a77c9647b0))
- **chat:** 🐛 show live media on gif shortcut cards ([4778503](https://github.com/115jon/ralph-meet/commit/477850384ec553327e902704c5a2de9baec8e969))
- **collectibles-ui:** 🐛 align profile effects and responsive shop flows ([02d7ecb](https://github.com/115jon/ralph-meet/commit/02d7ecbbfbd6d301da231241a0fcc6c5de2fd6ec))
- **embeds:** 🐛 restore x emoji fallbacks and dom coverage ([dbbb2a7](https://github.com/115jon/ralph-meet/commit/dbbb2a71f39f0063ed8fb194299a0d5807ad8c92))
- **embeds:** 🐛 restore x tweet inline links ([b163d3f](https://github.com/115jon/ralph-meet/commit/b163d3f2a128a15aa19e7ed57cd4bbc7d88ec822))
- **embeds:** 🐛 stabilize tiktok media hydration and proxy refresh ([5d5b0c5](https://github.com/115jon/ralph-meet/commit/5d5b0c50f1320743400456f9cd671f21cd5f3d03))
- **embeds:** 🐛 support tiktok live-photo slides ([5925a82](https://github.com/115jon/ralph-meet/commit/5925a821e807a6555fab07fceadc8048965b7bd4))
- **embeds:** 🐛 support tiktok slideshow embeds ([db972d6](https://github.com/115jon/ralph-meet/commit/db972d6afab1924c12ad938238f3f9ef8ce972ae))
- **media:** 🐛 keep volume slider open during handoff ([624e67a](https://github.com/115jon/ralph-meet/commit/624e67a67c1e09f614f83f8bbc72df5958d2a998))
- **profile:** 🐛 restore collectible effect layering and playback ([5627093](https://github.com/115jon/ralph-meet/commit/56270930a6dfe68e4be62bc8e508b658a51bcdec))
- **proxy-media:** 🐛 redirect tiktok media on proxy failures ([99ae9d0](https://github.com/115jon/ralph-meet/commit/99ae9d013aa8a7fc2022a04984aa09ed667223f4))
- **proxy-media:** 🐛 refresh signed tiktok media urls ([f298be2](https://github.com/115jon/ralph-meet/commit/f298be27e9973a38f1af964786678be2a5dbda1f))
- **recovery:** 🐛 restore non-rtc chat and shop salvage ([5e783e3](https://github.com/115jon/ralph-meet/commit/5e783e3b783f76f1fcb9f47ccefdfe9632eefb26))
- **room:** 🐛 stop resuming expired or intentional leaves ([5dd08a9](https://github.com/115jon/ralph-meet/commit/5dd08a92c6f0344f57fc99e3f745136a16c0ed3a))
- **shop:** 🐛 replace sidebar nav with responsive filters ([29a2fef](https://github.com/115jon/ralph-meet/commit/29a2fef796bc963b577b52ec6872d6515c2cb73a))
- **tiktok:** 🐛 recover slideshow embeds from stale cache misses ([1c8b3b2](https://github.com/115jon/ralph-meet/commit/1c8b3b24fd4c38215b366818a52299ab3f005816))
- **tiktok:** 🐛 smooth video poster hydration updates ([c16a757](https://github.com/115jon/ralph-meet/commit/c16a75722b047689fced9ec2733a85d76900f27b))
- **ui:** 🐛 retain delayed-unmount payloads during close ([eb043f4](https://github.com/115jon/ralph-meet/commit/eb043f4cb080d97ee738a87fd9134e62110e2438))
- **voice:** 🐛 clear voice presence on tab close ([eeb7254](https://github.com/115jon/ralph-meet/commit/eeb72540d1a6a8dd0ef502d06866c5f2500ad46c))
- **voice:** 🐛 hide pending tracks from voice ready ([4b3662a](https://github.com/115jon/ralph-meet/commit/4b3662aab08287673d685ecb9067362dc41e7611))
- **voice:** 🐛 ignore stale voice socket disconnects ([dadaea9](https://github.com/115jon/ralph-meet/commit/dadaea9c681eecfe373095600c81962ac8449975))
- **voice:** 🐛 plumb room session ids through voice tools ([33a87f5](https://github.com/115jon/ralph-meet/commit/33a87f50587b226668fa109dbf02dc8aa1fef5dc))
- **voice:** 🐛 preserve preview behavior across resume paths ([34749d7](https://github.com/115jon/ralph-meet/commit/34749d700a9eaca4e5d9c9a360615d3096e21a0e))
- **voice:** 🐛 preserve screen share tracks during push recovery ([3f9dad6](https://github.com/115jon/ralph-meet/commit/3f9dad6129b9b52ab0f1e4c8707f49ba17c3279a))
- **voice:** 🐛 reject expired pending reconnect transfer ([c03a2ed](https://github.com/115jon/ralph-meet/commit/c03a2ed4f7078e6b923df8886ac570b7cf76a0e1))
- **voice:** 🐛 remove stopped remote tracks from state ([7edb233](https://github.com/115jon/ralph-meet/commit/7edb233b418964c3e211f737a2e4ee56e71fbf3b))
- **voice:** 🐛 render voice details in a portal ([0c707b4](https://github.com/115jon/ralph-meet/commit/0c707b43dbcd8d5c77adb8c3520cd94cdde78cb9))
- **voice:** 🐛 restore raw avatar on focused stage ([8f41283](https://github.com/115jon/ralph-meet/commit/8f41283682384e1beef8c526adb68b4a18103307))

### Performance Improvements

- **chat:** ⚡️ memoize video attachment surface ([dae48e5](https://github.com/115jon/ralph-meet/commit/dae48e5dc1a26ba2c426a5f5c276a6ec52ed3a32))

## [1.14.1](https://github.com/115jon/ralph-meet/compare/v1.14.0...v1.14.1) (2026-06-30)

### Bug Fixes

- **ui:** 🐛 restore centered dialog layouts ([8f45590](https://github.com/115jon/ralph-meet/commit/8f45590dbdbbc199bc9e8973b1530ce1f226f440))

## [1.14.0](https://github.com/115jon/ralph-meet/compare/v1.13.0...v1.14.0) (2026-06-30)

### Features

- **desktop:** ✨ harden installer updates and hook unloading ([d13d8d9](https://github.com/115jon/ralph-meet/commit/d13d8d95d00ab8e1db071154d5e78b088f80dfcd))
- **desktop:** ✨ ship versioned installs and hook shutdown hardening ([35c1026](https://github.com/115jon/ralph-meet/commit/35c10269c95f6d6760a1faac9398973d3ea7de7a))
- **voice:** ✨ add floating stream mini previews ([ef61dee](https://github.com/115jon/ralph-meet/commit/ef61dee2b70ebf9e72ef99d695531108bd455191))

### Bug Fixes

- **a11y:** 🐛 improve media accessibility semantics ([6c52e24](https://github.com/115jon/ralph-meet/commit/6c52e2418102da79c975bbac5fc0e2df140cb787))
- **a11y:** 🐛 reduce react doctor accessibility warnings ([38d26fe](https://github.com/115jon/ralph-meet/commit/38d26fef883232bbe6c1608046de0c08663876ae))
- **a11y:** 🐛 use native controls for media previews ([0f6bab7](https://github.com/115jon/ralph-meet/commit/0f6bab71d66e35944ab4853be0fe4cd95b0c26f8))
- **a11y:** 🐛 use native dialog and button semantics ([fe61028](https://github.com/115jon/ralph-meet/commit/fe61028cfa65e4b1d289220fc506e8c69815059e))
- **build:** 🐛 set ci mode for installer script ([f292f56](https://github.com/115jon/ralph-meet/commit/f292f5637c12a823c50e0742b6ff4538c53f6432))
- **screen-share:** 🐛 restore self-capture sources and icons ([2e815a2](https://github.com/115jon/ralph-meet/commit/2e815a2c9651e85cef4db26b0e0a47d5aca045e2))

### Performance Improvements

- **react-doctor:** ⚡️ restore performance score to 100 ([c642605](https://github.com/115jon/ralph-meet/commit/c642605c6f4fd5576445ec82b772ce7d5373e8bc))

## [1.13.0](https://github.com/115jon/ralph-meet/compare/v1.12.0...v1.13.0) (2026-06-29)

### Features

- **streaming:** ✨ show exact desktop share source details ([370eff1](https://github.com/115jon/ralph-meet/commit/370eff1bffad25cdac7a0a8e61224b0fa676b47a))
- **voice:** ✨ add viewer join notifications and stream hover previews ([4d96a6a](https://github.com/115jon/ralph-meet/commit/4d96a6abba3cf71e03adbd56939536470519ef1f))

### Bug Fixes

- **chat:** :bug: fix voice channel text chat cursor and exit animation ([3949a6b](https://github.com/115jon/ralph-meet/commit/3949a6bddf8cf0be07adbe129a5cfcc8be379883))
- **chat:** 🐛 keep instagram embed previews full-size ([6690af5](https://github.com/115jon/ralph-meet/commit/6690af560019520b4a8d3672466a4734126012e7))
- **chat:** 🐛 repair instagram embed previews ([315f51e](https://github.com/115jon/ralph-meet/commit/315f51e9b0911837ecfb76ba9b8dcec74dce6a54))
- **installer:** 🐛 harden windows installer and release metadata ([bdf2e52](https://github.com/115jon/ralph-meet/commit/bdf2e52d1dfa7d50fb7273fd0851358f34c86ba8))
- **installer:** 🐛 harden windows installer and release metadata ([962012b](https://github.com/115jon/ralph-meet/commit/962012b0e50f0e49ef6c2d54fe3ce26329f2fd5d))

## [1.12.0](https://github.com/115jon/ralph-meet/compare/v1.11.0...v1.12.0) (2026-06-28)

### Features

- **chat:** ✨ add direct instagram reel playback ([657b6c9](https://github.com/115jon/ralph-meet/commit/657b6c922abae8761fdacee1fbb6bc4cca9c467d))
- **embeds:** ✨ add instagram video support for shared embeds ([b5c4150](https://github.com/115jon/ralph-meet/commit/b5c4150e71a94165c0d270813ad6b078ec8fb03b))

## [1.11.0](https://github.com/115jon/ralph-meet/compare/v1.10.0...v1.11.0) (2026-06-28)

### Features

- **landing:** ✨ auto-fetch desktop releases from github api ([336c897](https://github.com/115jon/ralph-meet/commit/336c89782aec94a518855f02bba4dcd8840a6fdf))

## [1.10.0](https://github.com/115jon/ralph-meet/compare/v1.9.0...v1.10.0) (2026-06-28)

### Features

- **ui:** :lipstick: overhaul homepage interactive showcases and design system alignment ([8d623d5](https://github.com/115jon/ralph-meet/commit/8d623d50529239696b4ebcf551fb66a04d77df95))

## [1.9.0](https://github.com/115jon/ralph-meet/compare/v1.8.0...v1.9.0) (2026-06-28)

### Features

- **chat:** :sparkles: implement media safety filter and sensitive content blurring ([b0202b5](https://github.com/115jon/ralph-meet/commit/b0202b5db3b4b71368afaaa772f048f9a1dc1862))
- **chat:** ✨ add gif and sticker picker shortcuts ([e15990d](https://github.com/115jon/ralph-meet/commit/e15990da7737f98898ca47c614c15345a37456f0))
- **chat:** ✨ add klipy meme support to media picker ([f38d218](https://github.com/115jon/ralph-meet/commit/f38d218ebe234c81c5197a10bb08447af047a114))
- **chat:** ✨ add mp4 video favorites to clips ([3e5a48f](https://github.com/115jon/ralph-meet/commit/3e5a48fc1ffccc97d4da500e7e223bd09547c17f))
- **chat:** ✨ add per-user media content filters ([abb5d46](https://github.com/115jon/ralph-meet/commit/abb5d4629c34c1225887079eb4f7ccfe01f7bedf))
- **chat:** ✨ add trending entry and keyboard suggestions ([21cdcc4](https://github.com/115jon/ralph-meet/commit/21cdcc4767c74e27170b7cf42f29129a315652e9))
- **theme:** ✨ persist synced themes with preview drawer ([8e221c7](https://github.com/115jon/ralph-meet/commit/8e221c70747b2132173e76732900da9240f23136))
- **ui:** 🎨 add spider-man theme and fix emoji selection alignment ([780f0e0](https://github.com/115jon/ralph-meet/commit/780f0e0127e2eb8b13522194cd3430a7408222d1))

### Bug Fixes

- **chat:** 🐛 keep gif picker tabs from snapping back ([ceac6b8](https://github.com/115jon/ralph-meet/commit/ceac6b813e6c665a470a6d3cbcb7c9a78cd352d5))
- **chat:** 🐛 preserve clip duration and fix embed assertions ([4674d5a](https://github.com/115jon/ralph-meet/commit/4674d5ac1fda1aaf714b83ec5d7a897463916835))
- **chat:** 🐛 render embed emoji tokens and preserve selection ([742772c](https://github.com/115jon/ralph-meet/commit/742772c6473b2e8865366ebe99f71b81ceafacee))
- **soundboard:** 🐛 sync picker pause state with media controls ([c41ecf6](https://github.com/115jon/ralph-meet/commit/c41ecf63819779b355d6147ca80db9b7bbeeb782))

### Performance Improvements

- **vite:** ⚡️ make polling opt-in for local dev ([774a331](https://github.com/115jon/ralph-meet/commit/774a33182a7223d882337e4e27fb24b63dfb67a6))

## [1.8.0](https://github.com/115jon/ralph-meet/compare/v1.7.0...v1.8.0) (2026-06-27)

### Features

- **chat:** ✨ add recent reaction submenu for messages ([65ab523](https://github.com/115jon/ralph-meet/commit/65ab52394bccbe1615458a7972d9ead929504c5c))
- **theme:** :sparkles: add miku light and dark themes with accessibility improvements ([cff54dc](https://github.com/115jon/ralph-meet/commit/cff54dc51c8d82a3c005836bbaad4dc5eb769df5))

### Bug Fixes

- **chat:** 🐛 dedupe echoed message reactions ([01571a3](https://github.com/115jon/ralph-meet/commit/01571a387834ab6930f2762ce9960736ec8a73f1))
- **native-share:** 🐛 align process loopback audio init ([30359bf](https://github.com/115jon/ralph-meet/commit/30359bfe5a308887d4212230f7ca358ae2fcc30e))
- **native-share:** 🐛 stabilize wgc fallback and loopback audio ([9e5cd91](https://github.com/115jon/ralph-meet/commit/9e5cd915ec3c0213471c9ecee9a63e0da3b5ae34))
- **voice:** :bug: guard connected publisher sessions from global eviction ([a74bd41](https://github.com/115jon/ralph-meet/commit/a74bd4168961fdcf23f19f38c2e48aa24346dfa7))

## [1.7.0](https://github.com/115jon/ralph-meet/compare/v1.6.2...v1.7.0) (2026-06-25)

### Features

- **desktop-installer:** ✨ initialize c# installer bootstrapper ([118f8ab](https://github.com/115jon/ralph-meet/commit/118f8ab77f6f0485545a026b139bb9e12bd3f1a2))
- **desktop:** :building_construction: configure custom bootstrapper updater integration and release pipeline ([0cbe97f](https://github.com/115jon/ralph-meet/commit/0cbe97f1e3692ce182babbbe5b208fca2c6076da))
- **desktop:** ✨ implement standalone updater splash screen and fix window visibility ([78e8ca0](https://github.com/115jon/ralph-meet/commit/78e8ca063f30b56cd7778f8a871d2c4f91af1720))

### Bug Fixes

- **desktop:** :bug: fix window maximized flash on startup and resolve state restoration ([f6b6fcd](https://github.com/115jon/ralph-meet/commit/f6b6fcd39b5c3c2ecd31b1f6fd30dadf903d3c6c))
- **desktop:** :bug: prevent window maximize/fullscreen flash on startup ([5672e90](https://github.com/115jon/ralph-meet/commit/5672e90e79728d68d68562b169fa9b1f3a5478cf))
- **desktop:** 🐛 resolve updater window stacking and lifecycle issues ([6acf86e](https://github.com/115jon/ralph-meet/commit/6acf86e60fe68c7789d09ccea78610304438ea72))
- **desktop:** allow process loopback audio without game-capture-hook feature ([4b95ff1](https://github.com/115jon/ralph-meet/commit/4b95ff1ca383d449dc465ffc883565d63b7e883b))

## [1.6.2](https://github.com/115jon/ralph-meet/compare/v1.6.1...v1.6.2) (2026-06-24)

### Bug Fixes

- **desktop:** allow radio-browser in connect-src CSP ([a0e5fde](https://github.com/115jon/ralph-meet/commit/a0e5fde28be8c4a847d1d8381619d84fc1fb511f))

## [1.6.1](https://github.com/115jon/ralph-meet/compare/v1.6.0...v1.6.1) (2026-06-24)

### Bug Fixes

- **soundboard:** add radio to soundType typescript interfaces ([a5fa6b5](https://github.com/115jon/ralph-meet/commit/a5fa6b56c4ab878ea6431113a19a16e3b9e7f6cf))

## [1.6.0](https://github.com/115jon/ralph-meet/compare/v1.5.1...v1.6.0) (2026-06-24)

### Features

- **channel-sidebar:** ✨ show voice status as read-only for observers ([b0f5d19](https://github.com/115jon/ralph-meet/commit/b0f5d19147e9f3f6e5402cd5c93716330b95ce5b))
- **chat:** ✨ add animated send button to mobile message input ([ff69c12](https://github.com/115jon/ralph-meet/commit/ff69c12169f4bf0834b3f6852b3c2db26d1c0134))
- **chat:** implement fluid exit animations for more modals ([04aaa22](https://github.com/115jon/ralph-meet/commit/04aaa22c42102bfb211b96c945db071a369cbeb7))
- **chat:** improve mobile UX with fluid animations and hardware back support ([ab1ddbd](https://github.com/115jon/ralph-meet/commit/ab1ddbd4222285fc575147a5f451ae347b005e16))
- **desktop:** ✨ implement hybrid WGC pre-roll and process loopback audio ([5cf47ea](https://github.com/115jon/ralph-meet/commit/5cf47ea56b1317b620c056f96cd3f95d3b7c9831))
- **soundboard:** integrate Radio Browser API for live streaming stations ([ff60057](https://github.com/115jon/ralph-meet/commit/ff60057f008b0f1b0405842482264d4daf54a982))

### Bug Fixes

- **chat:** :bug: fix blank image previews for pasted and mobile uploads ([ca9332d](https://github.com/115jon/ralph-meet/commit/ca9332dd8257503054611a8e64fc8e22f6acecc9))
- **soundboard:** display radio station favicons and distinct styling in favorites view ([214c816](https://github.com/115jon/ralph-meet/commit/214c816b5037d03d6f8e5c74f56d862786120966))

## [1.5.1](https://github.com/115jon/ralph-meet/compare/v1.5.0...v1.5.1) (2026-06-23)

### Bug Fixes

- **chat:** 🐛 fix X embed inline video src url ([e80395a](https://github.com/115jon/ralph-meet/commit/e80395ab9dc2347381fa7b3ea2ebd9edb0c2d4aa))

## [1.5.0](https://github.com/115jon/ralph-meet/compare/v1.4.1...v1.5.0) (2026-06-23)

### Features

- **chat:** ✨ make X embeds with videos playable inline ([97f7f43](https://github.com/115jon/ralph-meet/commit/97f7f434920c8e708263ff1942cdf593f33155e5))

## [1.4.1](https://github.com/115jon/ralph-meet/compare/v1.4.0...v1.4.1) (2026-06-23)

### Bug Fixes

- **audio:** 🐛 suppress reconnect sound replays ([194554e](https://github.com/115jon/ralph-meet/commit/194554e0a1ed014976de4d1538639207ae553123))
- **ui:** :bug: prevent sticker reaction modal from growing horizontally ([e0e4284](https://github.com/115jon/ralph-meet/commit/e0e4284b53898321a522056af6a91f45aabdab41))

## [1.4.0](https://github.com/115jon/ralph-meet/compare/v1.3.1...v1.4.0) (2026-06-23)

### Features

- **share:** proxy TikTok embeds and improve oEmbed presentation ([5c7febc](https://github.com/115jon/ralph-meet/commit/5c7febcc54cf13499300b2cbf321d05dbf55194f))
- **soundboard:** ✨ add myinstants favorites and revamp now playing ui ([ad372d0](https://github.com/115jon/ralph-meet/commit/ad372d014e78031f1a7e8b0b1579effdec13adce))
- **soundboard:** ✨ revamp picker layout, favorites metadata, and add local previews ([e748fa5](https://github.com/115jon/ralph-meet/commit/e748fa53722c117633b62bc7b088bc5fafb8c8e1))
- **soundboard:** ✨ revamp ui, add metadata and light mode theming ([31647cc](https://github.com/115jon/ralph-meet/commit/31647cc1aed199e013291a89ffa6a6230b6e5459))
- **ui:** 💄 apply theme-aware glassmorphic styling to emoji picker ([881ef78](https://github.com/115jon/ralph-meet/commit/881ef7885448c5d7b7d623374d5c28b76162b76e))
- **ui:** 💄 apply theme-aware glassmorphic styling to gif picker ([fdfab43](https://github.com/115jon/ralph-meet/commit/fdfab4360cc0507eb4b23a9ebec86f36121293fd))

### Bug Fixes

- **share:** 🐛 prevent discord from hiding video descriptions via twitter:card ([98edf0b](https://github.com/115jon/ralph-meet/commit/98edf0b1c1825ac11d33ca48302e066a1edce072))
- **share:** proxy TikTok embed videos for Discord ([713e056](https://github.com/115jon/ralph-meet/commit/713e056a7995713f1e1354e57ae223b631ef1cbc))
- **share:** remove twitter:player to allow rich embeds with descriptions ([f5ad9f5](https://github.com/115jon/ralph-meet/commit/f5ad9f5a55febf224295e686c678e8be423b4dce))
- **soundboard:** :bug: prevent audio looping on network reconnect ([7e8d7af](https://github.com/115jon/ralph-meet/commit/7e8d7aff35f3b227f9005dfce6bfc5b53c987335))
- **soundboard:** use deterministic playback ID to optimize spam handling ([2e3dc82](https://github.com/115jon/ralph-meet/commit/2e3dc825a3474482d09dd3f237caab52f8fe3942))
- **ui:** 🐛 prevent soundboard tooltip from falsely triggering on focus restore ([456ba99](https://github.com/115jon/ralph-meet/commit/456ba99e85ad219673f98c351293ddfe8f3ef154))
- **ui:** 💄 standardize popover positioning and mobile bottom-sheet behavior ([4836366](https://github.com/115jon/ralph-meet/commit/4836366692e23865d90ee137395fbc069592faad))
- **ui:** resolve EmojiPicker clipping and standardize theme colors ([d2d420b](https://github.com/115jon/ralph-meet/commit/d2d420bc523dd4d03524719403dd6493a2d147cc))
- **voice:** allow fxtwitter and twimg external GIF hosts in VoiceAppEvent validation ([370afd1](https://github.com/115jon/ralph-meet/commit/370afd1fa75ac5c0e3ad662dbcdbe74cae1786c4))

## [1.3.1](https://github.com/115jon/ralph-meet/compare/v1.3.0...v1.3.1) (2026-06-22)

### Bug Fixes

- **share:** revert inline video and use theme colors for external embeds ([1456c45](https://github.com/115jon/ralph-meet/commit/1456c45e0615c112b8bd431a90f5f2ec10cbba8d))
- **voice:** 🐛 handle favorite gif status and reactions ([31fef7a](https://github.com/115jon/ralph-meet/commit/31fef7afbb5ac8de3dee3eb70ecc6d8b28a8f2aa))

## [1.3.0](https://github.com/115jon/ralph-meet/compare/v1.2.0...v1.3.0) (2026-06-21)

### Features

- **camera:** improve background segmentation accuracy and feathering ([24ba1de](https://github.com/115jon/ralph-meet/commit/24ba1de79027a6dff1f28335c3809c38892df467))
- **chat:** ✨ add server voice activity hover cards ([36a9bb9](https://github.com/115jon/ralph-meet/commit/36a9bb9d2d8f5ccc99a774f675f9a56b736e4a5b))
- **chat:** comprehensive emoji system with custom ai generation ([6c47fec](https://github.com/115jon/ralph-meet/commit/6c47fecf3e408c4d988e0c013ac6b1cdf952b156))

## [1.2.0](https://github.com/115jon/ralph-meet/compare/v1.1.1...v1.2.0) (2026-06-20)

### Features

- **voice:** add channel status and media vibes ([37185b0](https://github.com/115jon/ralph-meet/commit/37185b06a45822eeda447746c6a181172d45fc6e))

## [1.1.1](https://github.com/115jon/ralph-meet/compare/v1.1.0...v1.1.1) (2026-06-20)

### Bug Fixes

- **desktop:** mount update checker overlay ([8035e1c](https://github.com/115jon/ralph-meet/commit/8035e1c0584c7b250433e827a9f0a675a6b29a6e))

## [1.1.0](https://github.com/115jon/ralph-meet/compare/v1.0.3...v1.1.0) (2026-06-20)

### Features

- **chat:** add profile banners and nameplates ([7110bc5](https://github.com/115jon/ralph-meet/commit/7110bc551f68cf89b12b7eb27586a8d031b19fe0))

### Bug Fixes

- **chat:** preserve external and embedded media in channel media ([40648bc](https://github.com/115jon/ralph-meet/commit/40648bcc1f975994e382d67e1c3caf7327e73b61))
- **chat:** refresh external embed media and add viewer jump ([4f32efe](https://github.com/115jon/ralph-meet/commit/4f32efe2a3665d8b78c639e02f4bd52a7bebe746))
- **chat:** restore embed video controls and DMCA fallbacks ([644aaad](https://github.com/115jon/ralph-meet/commit/644aaad82835113696f7e1cb6110ba55b9113a1e))
- **chat:** stabilize virtual message jumps ([4b22d62](https://github.com/115jon/ralph-meet/commit/4b22d626dbcd419d4c1f0fb12dbfb066207a81d9))
- **ci:** use release-please changelog for github release ([3acbae4](https://github.com/115jon/ralph-meet/commit/3acbae40107f1b394df0808cb9a9f20f9d300e47))

## [1.0.3](https://github.com/115jon/ralph-meet/compare/v1.0.2...v1.0.3) (2026-06-19)

### Bug Fixes

- **desktop:** log fetch_update invocation ([ac75cb2](https://github.com/115jon/ralph-meet/commit/ac75cb2829f331271a6131b13459f53350b2017a))

## [1.0.2](https://github.com/115jon/ralph-meet/compare/v1.0.1...v1.0.2) (2026-06-19)

### Bug Fixes

- **ci:** fix PR label swap permission by using default token ([f1db2ff](https://github.com/115jon/ralph-meet/commit/f1db2ffc997af460f1dad206e69df09f6a16fd80))
- **ci:** trigger release-please for 1.0.2 ([5201083](https://github.com/115jon/ralph-meet/commit/5201083ef9e227120ea1e5b707e2117f71b03f7c))
- **desktop:** allow fetch_update and install_update IPC commands via ACL ([b2aeb1b](https://github.com/115jon/ralph-meet/commit/b2aeb1b2c8361927328614946ff7420dedc04b15))

## [1.0.1](https://github.com/115jon/ralph-meet/compare/v1.0.0...v1.0.1) (2026-06-19)

### Bug Fixes

- **ci:** handle autorelease labels to prevent blocks ([228f6cd](https://github.com/115jon/ralph-meet/commit/228f6cd0f3cea6f4f8b02c84de4b9d32be47d3ac))
- **ci:** trigger release-please after label removal ([753befc](https://github.com/115jon/ralph-meet/commit/753befc598ac07dec63ede8a49194d058152c858))
- **ci:** verify automated release pipeline ([08ca0b4](https://github.com/115jon/ralph-meet/commit/08ca0b4e66d4b892cf11d16d36cb5a671047f6ca))

## 1.0.0 (2026-06-19)

### ⚠ BREAKING CHANGES

- **voice:** The logging format in the browser console has changed significantly.
- **ws:** heartbeat wire format changed. Server and client must be deployed together.
- **api:** All `apiSuccess` calls now return raw JSON data instead of a `{ data }` wrapper. Client consumers relying on `res.json().data` unwrapping will now receive the direct object. `apiFetch` in `api-client.ts` no longer unwraps a `.data` field.

### Features

- ✨ thread sidebar ui polish and server settings fixes ([ee6464c](https://github.com/115jon/ralph-meet/commit/ee6464cc120a318892b93fe08263f6d9cb89c842))
- 🔌 auto-reconnect with full-screen splash overlay ([0ccdce8](https://github.com/115jon/ralph-meet/commit/0ccdce89eb9db5f588492305fbed3a3f8e3c39a0))
- Add optimistic UI for reactions, pins, and channel creation ([#16](https://github.com/115jon/ralph-meet/issues/16)) ([e43d764](https://github.com/115jon/ralph-meet/commit/e43d764055b6625f488e54d575da802c53ccd65f))
- **api:** ✨ apply global DO rate limit to uploads and invites ([28c7abc](https://github.com/115jon/ralph-meet/commit/28c7abceb88755576c400c97b93aed47eebf2906))
- **audio:** ✨ add shared spatial audio controls ([6bb8ca4](https://github.com/115jon/ralph-meet/commit/6bb8ca4a0af93172421d553f1724ec80f6d76e78))
- **audio:** ✨ improve explicit stream audio playback and always hear settings ([0cf62b0](https://github.com/115jon/ralph-meet/commit/0cf62b011875ef01129f8cbb193c0c521f4b1c26))
- **audit:** ✨ implement server audit log system ([021d750](https://github.com/115jon/ralph-meet/commit/021d75086f1dcd238b65d470e72a36c4a95f214c))
- **auth:** :sparkles: replace clerk with ralph auth ([410e777](https://github.com/115jon/ralph-meet/commit/410e7775035e55c75c0827ed183ab0ba70508f42))
- **auth:** ✨ add /sign-up route with preserved redirect context ([a776aae](https://github.com/115jon/ralph-meet/commit/a776aaef6effb5007547554dd23945c63284cc54))
- **auth:** protect chat routes and extract clerk theme ([011adb8](https://github.com/115jon/ralph-meet/commit/011adb850f687e2d283dec5e135577dd9524a51a)), closes [#12](https://github.com/115jon/ralph-meet/issues/12)
- **call:** :sparkles: navigate to dm channel on call accept ([aeae2b5](https://github.com/115jon/ralph-meet/commit/aeae2b5cac9ae2855381248f5d11f6a4e360679f))
- **call:** ✨ add "Start a Call" context menu with confirmation modal ([3b343ec](https://github.com/115jon/ralph-meet/commit/3b343ecbc0449d7c32ab6ea3545a549aa495eced))
- **call:** 🔊 stabilize SFU reconnection and cold-rejoin logic ([dfecd2f](https://github.com/115jon/ralph-meet/commit/dfecd2f05a786500bba358eca978d1024c5e4a13))
- **calls:** 💄 refine call UI states and context menus ([85bfd61](https://github.com/115jon/ralph-meet/commit/85bfd61e0289131b87e6c0ce51e8db15f119a084))
- **camera:** :sparkles: implement WebGL compositor and high-fidelity background blur ([dfd8253](https://github.com/115jon/ralph-meet/commit/dfd8253aea424f104352e5912f6d1adab2a2504a))
- **camera:** ✨ add animated camera backgrounds ([8cc193f](https://github.com/115jon/ralph-meet/commit/8cc193fa5021366e42c167133e9e4eecb359c319))
- **channels:** ✨ add drag-and-drop channel reordering ([769533e](https://github.com/115jon/ralph-meet/commit/769533e84ad2b5ce04fbacabfa1e07740681037c))
- **channels:** ✨ implement channel overview settings & Discord-style context menu ([f6761b2](https://github.com/115jon/ralph-meet/commit/f6761b2f448662a6e026df368a12fa4f54c1a1ab))
- **channels:** implement channel permission overrides ([73112e8](https://github.com/115jon/ralph-meet/commit/73112e839033d59a79737336d5782acc08aebc79))
- **chat:** :lipstick: render visual reconnection indicators for sidebar voice members ([66d89c7](https://github.com/115jon/ralph-meet/commit/66d89c70c9f6e7ca45b42940a96de9d73d0da671))
- **chat:** :sparkles: implement persistent search history in gif picker modal ([df1c1ba](https://github.com/115jon/ralph-meet/commit/df1c1ba2f424d4816d6e8a9c85e8e1caf2f99853))
- **chat:** :sparkles: improve X and TikTok embed presentation ([337b2e5](https://github.com/115jon/ralph-meet/commit/337b2e5906e07f92648ae3f1226d50e19314f674))
- **chat:** :sparkles: integrate desktop notification state synchronization on chat store events ([00f279c](https://github.com/115jon/ralph-meet/commit/00f279cc29b79a2e0769269f14ffb659bd46971b))
- **chat:** :sparkles: isolate user voice activity and visual reconnects in DM call region ([c739960](https://github.com/115jon/ralph-meet/commit/c73996007ade3aab2157d689105605ba4f6ff324))
- **chat:** :sparkles: scroll-position restore with debug instrumentation ([defe121](https://github.com/115jon/ralph-meet/commit/defe121b2ee6dd57f6caa86d8f4376c471e944e6))
- **chat:** :sparkles: support attachment counts in reply previews and enhance command menu search ([f6c19a4](https://github.com/115jon/ralph-meet/commit/f6c19a47385d38fd37bbd87ab2c15cb562ec15a4))
- **chat:** :sparkles: track message visibility to clear unread counts and improve scroll behavior ([ae39213](https://github.com/115jon/ralph-meet/commit/ae39213379ee1c1000338f3c3b2a4cf5f9442146))
- **chat:** ↕️ bi-directional infinite scroll in detached mode ([84bf3c0](https://github.com/115jon/ralph-meet/commit/84bf3c0161e445a6e7fda8dfaf41b0724fa3efba))
- **chat:** ✨ add arrow-up to edit last own message ([a0dec94](https://github.com/115jon/ralph-meet/commit/a0dec94af3ae26385265994d5cf35333ce72e63f))
- **chat:** ✨ add custom video player, channel drag reorder, and icon upload hardening ([9a76454](https://github.com/115jon/ralph-meet/commit/9a7645452408ba6935245a1364271ec9a2cf633f))
- **chat:** ✨ add GIF picker ([9407ae1](https://github.com/115jon/ralph-meet/commit/9407ae119ef0a08b9b8b5be482bb17200cf52479))
- **chat:** ✨ add klipy gif provider support ([7aec177](https://github.com/115jon/ralph-meet/commit/7aec177c91ce8b1ed0ffd5446d8e972996b220e0))
- **chat:** ✨ add quick switcher and harden access control ([4c375aa](https://github.com/115jon/ralph-meet/commit/4c375aa60433d17965fc02415ddd94b22c133c24))
- **chat:** ✨ add unread message separator and banner ([78dee6d](https://github.com/115jon/ralph-meet/commit/78dee6d05f828f5d17bd787bf5d2229da381d77c))
- **chat:** ✨ implement media cache, tab keep-alive, and clip play controls ([2c89380](https://github.com/115jon/ralph-meet/commit/2c89380e52a80a72a862625c805a50a903b26829))
- **chat:** ✨ implement message embeds and removal functionality ([6f8f15c](https://github.com/115jon/ralph-meet/commit/6f8f15c1410e325a239d48d2ba9defac50c42ff8))
- **chat:** ✨ implement real-time invites and dynamic user resolution ([ffcf080](https://github.com/115jon/ralph-meet/commit/ffcf080d80581db2783acacfae9abbc355506003))
- **chat:** ✨ interactive mentions with hover tooltips and profile popovers ([be9a44b](https://github.com/115jon/ralph-meet/commit/be9a44b2f8ed4ae195efb9a9c34a16430dae5d61))
- **chat:** ✨ mention autocomplete, rendering, and background fix ([7266890](https://github.com/115jon/ralph-meet/commit/7266890aba9a765bafe05c4ed2d5999082d82139))
- **chat:** ✨ show display names across chat surfaces ([0c0cc56](https://github.com/115jon/ralph-meet/commit/0c0cc561c8fb078d0a0145769cdba8070e9cee6b))
- **chat:** 🎯 anchor fetch for jump-to-unloaded-message ([d4b3889](https://github.com/115jon/ralph-meet/commit/d4b3889c895cfb6b0a5f51e08e10f8409963f6da))
- **chat:** 🐛 attempt to stabilize detached programmatic jump scroll ([e2f4232](https://github.com/115jon/ralph-meet/commit/e2f4232d013eca6ba7d7b9381121ce7893e474cf))
- **chat:** 🔊 add message received sound and unified audio interaction ([3f9b831](https://github.com/115jon/ralph-meet/commit/3f9b83124908df464d25929face58fab6dfb64fd))
- **chat:** 🔨 add ban option to message and member context menus ([be4ae62](https://github.com/115jon/ralph-meet/commit/be4ae629e6a292f623b0a45fa4578be4a3a54c7d))
- **client:** improve DM channel UI and details pane ([a5b119f](https://github.com/115jon/ralph-meet/commit/a5b119f72ebc9159868669ac8fe6e5a8b3d97eba))
- **db:** ✨ add display_name field to users and api endpoints ([4857c7d](https://github.com/115jon/ralph-meet/commit/4857c7d2aabd294bb1a7ac2e92b599a9458bd660))
- **db:** schema drift sync migration for production D1 ([79ebcee](https://github.com/115jon/ralph-meet/commit/79ebcee3f7c9519763920b332e388b7180553f1d))
- **demo-room:** ✨ add ephemeral chat with GIF support ([1609dda](https://github.com/115jon/ralph-meet/commit/1609ddac61bd03d4e6f62fcd90731ff4e898542b))
- **desktop:** :package: vendor mediapipe assets locally for CEF compatibility ([0774e2c](https://github.com/115jon/ralph-meet/commit/0774e2ca5e6c661d5f02b0cb8a24e766b24549a5))
- **desktop:** :sparkles: add desktop notification settings toggling and tray sync helpers ([0e67a0f](https://github.com/115jon/ralph-meet/commit/0e67a0fc8c7586cb7ad89b6e3583b91da7279c87))
- **desktop:** :sparkles: add native video device enumeration via media_devices ([1563398](https://github.com/115jon/ralph-meet/commit/156339848277662ea96ba5096e8eb143bb1a1a65))
- **desktop:** :sparkles: implement system tray notification overlays and badge counter ([9602149](https://github.com/115jon/ralph-meet/commit/96021497970b4af5a7d9afff658566e8ae43286e))
- **desktop:** :sparkles: integrate manual update checker UI in Settings ([bf89374](https://github.com/115jon/ralph-meet/commit/bf89374b5c8abcbc86586712602490478d0b9d0d))
- **desktop:** ✨ add native OS notifications and post-save profile refresh ([b39d8ae](https://github.com/115jon/ralph-meet/commit/b39d8aef6739b5f1f50fd670d7a9200d996629bb))
- **desktop:** ✨ add OS settings tab with autostart, close-to-tray, and start-minimized ([2043ac6](https://github.com/115jon/ralph-meet/commit/2043ac6e68992a771477c72b4bf8164ac3f63b1b))
- **desktop:** ✨ add Tauri 2 desktop client with cross-platform auth and WebSocket support ([3d39985](https://github.com/115jon/ralph-meet/commit/3d3998503bf407aa785111cdab4dceb5e264b537))
- **desktop:** ✨ add theme-aware desktop splash screen ([ca9c6e0](https://github.com/115jon/ralph-meet/commit/ca9c6e057559bebbda280f947ad434c0f5ce6670))
- **desktop:** ✨ implement native Windows invisible-tray hack via layered transparency ([536e956](https://github.com/115jon/ralph-meet/commit/536e9566f541dec403b3ebc08e8194334e9c6c7d))
- **desktop:** ✨ minimize to tray on window close ([97193a2](https://github.com/115jon/ralph-meet/commit/97193a258f8ef3aeab3403db135475a48566c4f7))
- **desktop:** ✨ open external links in system browser ([ed3f7af](https://github.com/115jon/ralph-meet/commit/ed3f7af328cd542774d1ab8b0cddd4672bf8d2a8))
- **desktop:** ✨ vendor tauri-plugin-notification and sync unread state ([9252e7d](https://github.com/115jon/ralph-meet/commit/9252e7d38f1f32c457602b5c109f03422efa7395))
- **desktop:** ✨ Vulkan game capture + Discord-compatible hooking ([602509e](https://github.com/115jon/ralph-meet/commit/602509e4d3a8551d2058c2e50744085c353de136))
- **desktop:** 🏗️ migrate tauri renderer from webview2 to CEF ([ad18de8](https://github.com/115jon/ralph-meet/commit/ad18de869a45eb7667c08e37d8875c2dbf1cdcd7))
- **desktop:** 💾 persist window size and position across restarts ([45718b7](https://github.com/115jon/ralph-meet/commit/45718b7ec9851dd5ed7830fbaf0ee0de51ae3c79))
- **desktop:** 🔄 wire auto-update via tauri-plugin-updater ([9919623](https://github.com/115jon/ralph-meet/commit/9919623a9d0fc99ec541430e89861c34f8572a08))
- **desktop:** 🔐 browser-based sign-in with native Clerk sessions ([2f3e4cf](https://github.com/115jon/ralph-meet/commit/2f3e4cf54f2ae72331f5e931ded2ffee13e66918))
- **desktop:** 🔔 add system tray with unread notification badge ([f37e84c](https://github.com/115jon/ralph-meet/commit/f37e84c1b1111c58e37c8b44a8f620bc5255caa5))
- **desktop:** 🔗 invite deep-links + reworked invite UI with accept button ([28ce0b0](https://github.com/115jon/ralph-meet/commit/28ce0b0fb934514ca9647e0e2d9aef282abdfc90))
- **desktop:** implement hardware-accelerated WMF H.264 encoder for screen sharing ([787e321](https://github.com/115jon/ralph-meet/commit/787e3216bb9fafebe86795ded9aeb824ef91d834))
- **desktop:** zero-overhead native game-capture hook screen share ([32aec68](https://github.com/115jon/ralph-meet/commit/32aec687e4e007dacc6dea78be0ff76a5245cef7))
- **embeds:** :sparkles: add on-demand direct TikTok player with iframe fallback ([ab44a89](https://github.com/115jon/ralph-meet/commit/ab44a89201bd1b68c7c48211fcd0653f3fdcf90c))
- **embeds:** :sparkles: TikTok oEmbed player URLs and custom video controls ([5087aee](https://github.com/115jon/ralph-meet/commit/5087aee4b653817a3bc385c976eeb5b4ba9b8919))
- **gif:** :sparkles: add search suggestions and autocomplete to gif picker ([1415af3](https://github.com/115jon/ralph-meet/commit/1415af3f3340d20b25a5d7526c792b9f1bc250e6))
- **gifs:** :sparkles: add back button from search to categories ([9cb1875](https://github.com/115jon/ralph-meet/commit/9cb18758966bcea24dd0f54ccbfc6ba27c2e9120))
- **gifs:** :sparkles: stabilize clip detection and persist duration in favorites ([0a1cffc](https://github.com/115jon/ralph-meet/commit/0a1cffc69e12bba13485c1993ab4fb0751ac43a6))
- **home:** ✨ overhaul Home/DM UX with full-width FriendsView ([84ed315](https://github.com/115jon/ralph-meet/commit/84ed3157660bb21e28ae74b707b29e1702de4289))
- implement RBAC roles system and enhance user profiles ([1d09fb8](https://github.com/115jon/ralph-meet/commit/1d09fb8d7139da429215d25b58cf5d5d52089743))
- **mobile:** :iphone: enforce safe area padding across chat components ([8cd15e2](https://github.com/115jon/ralph-meet/commit/8cd15e262ec786568a15381207b45c72f3d22db5))
- **mobile:** :lipstick: refine UI components for mobile responsiveness ([86071a6](https://github.com/115jon/ralph-meet/commit/86071a606c0c611d33b51941b76737e1e7edfedd))
- **mobile:** ✨ add full-screen profile sheet for mobile member views ([24063b1](https://github.com/115jon/ralph-meet/commit/24063b1b56642d42d2d604b76d38ea1ba47f8932))
- **mobile:** ✨ fix Clerk auth flow with session persistence ([45173f3](https://github.com/115jon/ralph-meet/commit/45173f3097939cb50c0476607c0528931b60c69b))
- **mobile:** ✨ implement safe area view with tauri plugin ([bab70fb](https://github.com/115jon/ralph-meet/commit/bab70fb91e23d6102a12bd9a1a2e6cf0695ed3f2))
- **mobile:** use native onBackButtonPress API for Android navigation ([b98400d](https://github.com/115jon/ralph-meet/commit/b98400d6563210c36cd67b1e062d6479c2f5b412))
- **notifications:** ✨ add Discord-style notification badges across UI ([f8d68a7](https://github.com/115jon/ralph-meet/commit/f8d68a7a52c8e9808821bb9256dfceb060e5b223))
- **notifications:** ✨ add quick win UX enhancements ([087436b](https://github.com/115jon/ralph-meet/commit/087436bf05dfc4f181d4866865b16d9ca2a1f936))
- **notifications:** 🔔 add [@mention](https://github.com/mention) and reply notification system ([14e4ba9](https://github.com/115jon/ralph-meet/commit/14e4ba9ad98c0573a093ea7c6c9047c22df4e791))
- **profile:** :sparkles: broadcast updated_at on avatar change and profile sync ([7a64c3c](https://github.com/115jon/ralph-meet/commit/7a64c3c9c8c2cfc5d3ced346e7966f0bd7a3cbe3))
- **profile:** display mutual friends and servers with avatars ([9a86603](https://github.com/115jon/ralph-meet/commit/9a866033cfc87ccf80c0be9f356146c2515032f3))
- rebuild demo room on modern voice components ([d649c4f](https://github.com/115jon/ralph-meet/commit/d649c4f8df0958be2a40e94c9db4e5dae90049de))
- resolve desktop build asset URLs ([5e614a9](https://github.com/115jon/ralph-meet/commit/5e614a91fd9151cad0189ad729bc9e236727a90a))
- **screen-share:** ✨ wire change source button to desktop screen picker ([b1f894d](https://github.com/115jon/ralph-meet/commit/b1f894d1f5e0605174775f326b9d1a81f5c5b194))
- **screenshare:** ✨ unify desktop and web screenPicker modals ([fca36c2](https://github.com/115jon/ralph-meet/commit/fca36c24c4dfdb80cbfcd918c3c1e68843dacb18))
- **scroll:** ♻️ implement correct scroll restoration & read state logic ([09a5065](https://github.com/115jon/ralph-meet/commit/09a50655fb6d4ff07b617e8f9059c16f3e681483))
- **security:** 🔒 add rate limiting, ban system, and permission helper ([6120011](https://github.com/115jon/ralph-meet/commit/6120011d7ae07f1d399ffca8636348531324f772))
- **server:** ✨ add server icon upload with R2 storage ([dbc7dea](https://github.com/115jon/ralph-meet/commit/dbc7dea97205b2a5406bf95b2c0f54e53811f8e0))
- **settings:** implement devices tab with clerk session management ([a4619fe](https://github.com/115jon/ralph-meet/commit/a4619fe82241a5cbfc1b61ad12407d139e8b97cf))
- **sfu-client:** 🏗️ add WebRTC fault tolerance with grace timers and network recovery ([b4f0720](https://github.com/115jon/ralph-meet/commit/b4f072079c0250b3b5fc9a1cbcaa0dc14caed8be))
- **share:** :sparkles: add public message snapshots ([37966d4](https://github.com/115jon/ralph-meet/commit/37966d4d4207017be070e3a9ee377a42ac0829c0))
- **soundboard:** ✨ add pause/resume, volume control, and mute sync ([9d41dca](https://github.com/115jon/ralph-meet/commit/9d41dca9506758df71c9fd65c07b132087c754f1))
- **soundboard:** ✨ persist server soundboard clips ([b03626d](https://github.com/115jon/ralph-meet/commit/b03626dac7ab09f934c5a907b8d8524485f034ac))
- **sounds:** ✨ add synthesized sound effects for voice and notifications ([6403577](https://github.com/115jon/ralph-meet/commit/6403577385311768818e6689c79fb1b30e3139a9))
- **threads:** ✨ add message thread sidebar with reply count badges ([fdc28bf](https://github.com/115jon/ralph-meet/commit/fdc28bf10b7ee7c8da4cb7dce34b06a5c0d35b64))
- **ui:** :sparkles: display names, link context menu, and voice channel routing ([a242c65](https://github.com/115jon/ralph-meet/commit/a242c65016beb86628319952b9b05d9d1e307107))
- **ui:** ✨ add stream loading indicator ([f8809f3](https://github.com/115jon/ralph-meet/commit/f8809f307e74d6c0154830707c7082b3c2f7f48d))
- **ui:** ✨ integrate universal splash screen across web and desktop ([eaebb14](https://github.com/115jon/ralph-meet/commit/eaebb14b1609a93aa297937101e5b0626b231091))
- **ui:** ✨ remove uptime counter from dm call ui ([c580cfe](https://github.com/115jon/ralph-meet/commit/c580cfeccd1802b435d50a4d2384e85d1671344d))
- **ui:** ✨ update chat and member lists to prioritize display names ([967dd38](https://github.com/115jon/ralph-meet/commit/967dd38ab9a64f3de2f9edfe220ef6edafd8c5f7))
- **ui:** 🎨 custom video player for media viewer ([5e47264](https://github.com/115jon/ralph-meet/commit/5e472641368232fac0b0ea6a2f63f66b4b5742d2))
- **ui:** 🎨 revamp DM call region and unified voice grid ([293c32e](https://github.com/115jon/ralph-meet/commit/293c32e5c1b842f6b56f69cf3741e645f52e2952))
- **ui:** 🎬 add video support to media tab and image viewer ([026d3e0](https://github.com/115jon/ralph-meet/commit/026d3e0a467ecf4931613d7189a2643d30334112))
- **updater:** :sparkles: integrate tauri updater plugin with CI release pipeline ([b32c826](https://github.com/115jon/ralph-meet/commit/b32c8260ec77092aadb443aa093db609c90c1438))
- **uploads:** ✨ unrestricted file uploads with smart file icons ([9ea4d9d](https://github.com/115jon/ralph-meet/commit/9ea4d9dc55a21100149d28cdea74e853b0c600da))
- **voice:** :sparkles: add activities and soundboard controls ([3fd316a](https://github.com/115jon/ralph-meet/commit/3fd316a295fb6a0e3fbddb09cce310c54d5f10c9))
- **voice:** :sparkles: support clerk-less room modes, set track controls, and restore voice DTX ([e20e7b2](https://github.com/115jon/ralph-meet/commit/e20e7b230cdb808742393f00e410f7543c2f14ff))
- **voice:** ⚡️ optimize latency and implement scoped logging ([93144c4](https://github.com/115jon/ralph-meet/commit/93144c41873173ce3f111040922acbe7f651f751))
- **voice:** ✨ add real-time GIF/sticker/clip reactions in voice calls ([df032f1](https://github.com/115jon/ralph-meet/commit/df032f1c1af362d89d5cfe21c254291094e0cff0))
- **voice:** ✨ add server-side uptime tracking for voice channels and calls ([d244885](https://github.com/115jon/ralph-meet/commit/d244885aa11702da8192638291873160424e4145))
- **voice:** ✨ add voice switch confirmation modal ([8790896](https://github.com/115jon/ralph-meet/commit/8790896f7ca529cfaad35399c6f55d7b298fd02a))
- **voice:** ✨ sync VAD sensitivity and add mic test widget ([be6f5a5](https://github.com/115jon/ralph-meet/commit/be6f5a5e4cdd841930f423853b10f42f99aca538))
- **worker:** :sparkles: implement voice reconnect grace period and dynamic alarm scheduling ([1a946e0](https://github.com/115jon/ralph-meet/commit/1a946e040ee4c72561d98b929d85250dddd60de4))
- **worker:** 🔧 create custom server entry with DO exports and WS routing ([ad2860b](https://github.com/115jon/ralph-meet/commit/ad2860b42315cf821ffd1ede8d244cbe3d1f4f99))

### Bug Fixes

- `scrollToIndex` and `initialTopMostItemIndex` now correctly add `firstItemIndex` to the 0-based array index. ([4812872](https://github.com/115jon/ralph-meet/commit/4812872e0c124231643572e1267507a05bf7683a))
- 🐛 fix server icon 404, thread sidebar layout, and reply count updates ([2d43e6f](https://github.com/115jon/ralph-meet/commit/2d43e6fd99bd7bc506dcbf07f29eacdef28d8605))
- 🐛 misc fixes for media devices, voice settings, and modal components ([9bea61b](https://github.com/115jon/ralph-meet/commit/9bea61bb6b0f76e17af7e55bad2270da0ab40d41))
- 🐛 reload data on gateway reconnect + add updater permissions ([c6a6eec](https://github.com/115jon/ralph-meet/commit/c6a6eec77276c2ebcd0258b55b083748aa09192c))
- 🐛 resolve TypeScript errors in service layer type signatures ([de1a2a2](https://github.com/115jon/ralph-meet/commit/de1a2a2cb78aadd00305c0a1fdbe1047fca7526f))
- 🔧 add client-side shims for server/desktop-only modules ([d2c3bb0](https://github.com/115jon/ralph-meet/commit/d2c3bb089b62977c1936cf9fe847f9aadfa767a4))
- **api:** :bug: fix desktop camera backgrounds CORS cache-poisoning ([7d9d1d5](https://github.com/115jon/ralph-meet/commit/7d9d1d5df248d14d95b3e687dcd909a426ec31c4))
- **api:** 🐛 fix media tab returning empty results ([a24ff68](https://github.com/115jon/ralph-meet/commit/a24ff68a9e1d11c6b96a4070794f57cf1d9a2605))
- **api:** 🔒 close permission gaps and DRY up inline permission queries ([0fe710d](https://github.com/115jon/ralph-meet/commit/0fe710d40233afc25818cd27a4401a2f8c71859f))
- **api:** 🔒 enforce SEND_MESSAGES, ADD_REACTIONS, ATTACH_FILES permissions ([211cdd5](https://github.com/115jon/ralph-meet/commit/211cdd52139908284a293555b0c050a309a2cc97))
- **api:** Unwrap JSON '{ data }' envelope returned from apiSuccess in all fetch actions ([60d691f](https://github.com/115jon/ralph-meet/commit/60d691f5c9b64ed4fb2c4fbcbd756dde54094e29))
- **app:** :bug: prevent logout restore and update cta ([263cb56](https://github.com/115jon/ralph-meet/commit/263cb56f454b020e485ea0ed5773c92177bb2c82))
- **audio:** ⚡️ implement websocket resume grace period and hibernation optimizations ([a8d35a9](https://github.com/115jon/ralph-meet/commit/a8d35a9c62bf81ee3004f0ed73231c49ac2dfb3a))
- **audio:** rework chromium stereo mic and noise gate constraints ([5f47e5c](https://github.com/115jon/ralph-meet/commit/5f47e5c12e17f56fd3fc33106a30fd5fadfb5219))
- **auth:** :bug: finish kova auth rebrand ([ec301c5](https://github.com/115jon/ralph-meet/commit/ec301c51ec61bf651b6829d47f9ddc788deefe2d))
- **auth:** :bug: migrate meet to kova auth ([53927fc](https://github.com/115jon/ralph-meet/commit/53927fc59baefe008dca2f45a8ce334840e3dc4e))
- **auth:** :bug: stabilize Ralph Auth handoff ([150b4a2](https://github.com/115jon/ralph-meet/commit/150b4a2ab9736f12a772629f3c84db9caf18a9cb))
- **auth:** :bug: use app-local sign-out to preserve desktop session ([ea2b473](https://github.com/115jon/ralph-meet/commit/ea2b4737a0299d57abf7ce72487e60d96d823e2f))
- **auth:** 🐛 prevent tokenless desktop handoff ([ecab9d7](https://github.com/115jon/ralph-meet/commit/ecab9d71f11aadccdcaa711edb8c033cba5d709c))
- **auth:** 🔧 fix Clerk env var name and router getRouter export ([4a04a3c](https://github.com/115jon/ralph-meet/commit/4a04a3c3e3113c2e6056e300909f4d5f3123dbc5))
- **avatar:** merge D1 profile on load to prevent Clerk sync race conditions ([c9a3108](https://github.com/115jon/ralph-meet/commit/c9a31088a898d17b11ee82a3be94f8a868dc20fb))
- **build:** replace ralph-auth vite alias with vendored packages/kova-react ([b37aefd](https://github.com/115jon/ralph-meet/commit/b37aefd63b656d5f0cc31c7c6c43b0d27b6adb01))
- **call:** :bug: resolve diagonal tearing artifact in Chromium ([a06ef04](https://github.com/115jon/ralph-meet/commit/a06ef042e72106ac7d9384f8be1ccba5604961d9))
- **call:** :lipstick: refine UI presentation during ringing states ([44556b2](https://github.com/115jon/ralph-meet/commit/44556b26730ddce9ced15fc419402334ae7381b4))
- **call:** allow caller to stay when callee declines and make UI theme-aware ([92121a1](https://github.com/115jon/ralph-meet/commit/92121a1012a8b8f537122b3fea8b251204e61c24))
- **call:** allow users to stay in active calls when partner leaves ([8a51736](https://github.com/115jon/ralph-meet/commit/8a5173652a1e050603a2c9336f2502b4de5e2d05))
- **chat:** :bug: constrain invisible status cutout to badge ([d5c7499](https://github.com/115jon/ralph-meet/commit/d5c74993ef5d856316e7a2cf92b2aacb773ff8af))
- **chat:** :bug: fix gif picker layout shifts and recursive load-more loops ([9dc763d](https://github.com/115jon/ralph-meet/commit/9dc763d9381182afaf5ad2cf167ac8137dde1639))
- **chat:** :bug: remove duplicate screen share modal import ([86b7ccf](https://github.com/115jon/ralph-meet/commit/86b7ccf485d66de564e5e1382b2f6ba8896c1016))
- **chat:** :bug: use stable tiktok player embeds ([4ba1f86](https://github.com/115jon/ralph-meet/commit/4ba1f860a99f368321c6d299a893646dc505e96c))
- **chat:** ✨ atomic cursor navigation and input alignment ([5b11891](https://github.com/115jon/ralph-meet/commit/5b11891853142669be5c4334535f261cc573f65a))
- **chat:** 🐛 fix auto-scroll anchoring when message height changes ([268359e](https://github.com/115jon/ralph-meet/commit/268359eaafbc6160ed7e5c39f7a71ca7a2de2970))
- **chat:** 🐛 fix itemContent index crash during forward pagination ([31dce3b](https://github.com/115jon/ralph-meet/commit/31dce3b854ea3e2c51f06b7c522481a6eaaf47dc))
- **chat:** 🐛 fix jump from detached anchor to detached anchor ([daca97e](https://github.com/115jon/ralph-meet/commit/daca97e44a182c8e2ab25473c35d1e67f523fffa))
- **chat:** 🐛 fix jump-to-loaded-message inside detached window ([4812872](https://github.com/115jon/ralph-meet/commit/4812872e0c124231643572e1267507a05bf7683a))
- **chat:** 🐛 fix virtuoso initial scroll by forcing remount on anchor hops ([5074e42](https://github.com/115jon/ralph-meet/commit/5074e420038fcfa26c490c79adaad3a01c64f1cf))
- **chat:** 🐛 harden role and moderation enforcement ([c6dc897](https://github.com/115jon/ralph-meet/commit/c6dc89776d6a8bea9a4cfc3281ef735ebdda3664))
- **chat:** 🐛 keep display names in social payloads ([92fc704](https://github.com/115jon/ralph-meet/commit/92fc70439ae76f4ff9d8a4cf8f3562d97645b8ff))
- **chat:** 🐛 mention navigation, undo history, and tooltips ([99ff668](https://github.com/115jon/ralph-meet/commit/99ff6689ed8170a8a4292810e671d696bb836c14))
- **chat:** 🐛 mention undo history, bounds, and tooltip bg ([f670360](https://github.com/115jon/ralph-meet/commit/f6703606411ea18c876dc4d601ce19678969ff7d))
- **chat:** 🐛 preserve display names across realtime surfaces ([0912811](https://github.com/115jon/ralph-meet/commit/09128111de0f03b3fee0c2b76087c16880ffd02d))
- **chat:** 🐛 prevent video attachment from causing horizontal overflow ([1bfd204](https://github.com/115jon/ralph-meet/commit/1bfd2043681bb59a7968f6dc69608314d24bada7))
- **chat:** 🐛 refine mention behavior and UI ([8d451a0](https://github.com/115jon/ralph-meet/commit/8d451a0e72364bfb3888c1b1b8a8fe1eb5796400))
- **chat:** 🐛 replace react-virtuoso with virtua and fix scroll restoration ([6a80059](https://github.com/115jon/ralph-meet/commit/6a8005973ca363493b8bcdea265fccd671988a08))
- **chat:** 🐛 resolve remaining display name flashes ([1e42422](https://github.com/115jon/ralph-meet/commit/1e4242283963c4d257de2d36a73d6ba1d18f4737))
- **chat:** 🐛 resolve state sync and list rendering issues ([fd3a4d5](https://github.com/115jon/ralph-meet/commit/fd3a4d5ea1ac8eaf56aaa2cfaa508d13e542e546))
- **chat:** 🐛 resolve typing input re-render cascade and 204 parse error ([6b54e07](https://github.com/115jon/ralph-meet/commit/6b54e07d1830ab7b77b09e2c61d04551ef5e29c7))
- **chat:** 🐛 robust twin-div mention input architecture ([1bb9f71](https://github.com/115jon/ralph-meet/commit/1bb9f71269d6b7929b05513993b90958955383f6))
- **chat:** 🐛 sync member role updates ([9a70f56](https://github.com/115jon/ralph-meet/commit/9a70f5698b387604c5bfc85a0005dd3855d50ad8))
- **chat:** 🐛 track firstItemIndex as state to fix forward pagination ([d78c5b1](https://github.com/115jon/ralph-meet/commit/d78c5b1c01544c48265838efc25ef52a57b24e86))
- **chat:** 💄 improve URL handling and prevent mention triggers in links ([59cff3c](https://github.com/115jon/ralph-meet/commit/59cff3ca18a3f83a6b55ddb0baeb46fbd5fc4d00))
- **chat:** resolve Zustand render loop & gateway instability ([863be80](https://github.com/115jon/ralph-meet/commit/863be80bbf70c67c558a546b37d46afbf3f199b8))
- **client:** Local avatar UI now instantly reflects custom uploads ([6574edc](https://github.com/115jon/ralph-meet/commit/6574edce0748bfcb345085121f998e6b6a3c6935))
- conditionally apply tauri shims so real native plugins actually load in the Tauri environment ([d24cde5](https://github.com/115jon/ralph-meet/commit/d24cde56de5192ff0f3952ea9497be9888bd36d4))
- **deps:** remove remaining file: ralph-auth refs from mobile and lockfile ([917a4df](https://github.com/115jon/ralph-meet/commit/917a4dffdcfedfe61cbf52f10266c47f20e8db64))
- **desktop-auth:** 🐛 stabilize native session handoff ([0486415](https://github.com/115jon/ralph-meet/commit/048641578f596cb155d915ea77ef1663c2b80ae4))
- **desktop-cef:** :bug: restore stable gpu compositor startup ([f6fe95a](https://github.com/115jon/ralph-meet/commit/f6fe95a37fe09e33d54d493a2550c297bdad9eab))
- **desktop:** :bug: harden login listener cleanup and add voice join tracing ([737e6eb](https://github.com/115jon/ralph-meet/commit/737e6eb35b2f3c349d271ac146f50c9b69171c9c))
- **desktop:** :bug: preserve recovery screen sharing work ([5d238ba](https://github.com/115jon/ralph-meet/commit/5d238ba3bb68e41d68326cbfdd1a25e6bfa259b3))
- **desktop:** :bug: preserve source changes while streaming ([00b24a0](https://github.com/115jon/ralph-meet/commit/00b24a0bfb5ac687dd4dc77582413b68b3bcc07c))
- **desktop:** :bug: ship working CEF desktop installer ([8be2b4d](https://github.com/115jon/ralph-meet/commit/8be2b4d4999476de51b3aba5faf26bf19946d80b))
- **desktop:** :bug: stabilize screen share control path ([e2b5823](https://github.com/115jon/ralph-meet/commit/e2b582333dcf3f1b9ac4dab1692790ba6aa7d357))
- **desktop:** 🐛 auto-retry API calls on 401 with fresh Clerk token ([eaf2fff](https://github.com/115jon/ralph-meet/commit/eaf2fffa7985bc24dba062499d30aec3b5c27dba))
- **desktop:** 🐛 avoid stripping origin for external media urls in tauri ([0d87825](https://github.com/115jon/ralph-meet/commit/0d87825570eba2abff2a3a152458ed374ee410c4))
- **desktop:** 🐛 commit game-capture hook on real present, not install ([9fed1cd](https://github.com/115jon/ralph-meet/commit/9fed1cd59f770a3587cb8360a4a4f3aec951bf75))
- **desktop:** 🐛 correct kova-react alias path in desktop config ([17a4e7d](https://github.com/115jon/ralph-meet/commit/17a4e7d8d0d93593b4b7f005411abdf89fa17c30))
- **desktop:** 🐛 fix title bar repaint and devtools dark mode ([10a5299](https://github.com/115jon/ralph-meet/commit/10a52994991f86d8d12dff7b54f33784371c740f))
- **desktop:** 🐛 fix WebSocket connectivity, fonts, auth, and settings crashes ([e197648](https://github.com/115jon/ralph-meet/commit/e1976480ff8d0d77aa58528da8e401e60d48183f))
- **desktop:** 🐛 resolve tauri plugin build and ui layout failures ([6ace30e](https://github.com/115jon/ralph-meet/commit/6ace30ed7e2316f10e5c3d360675db2a6ff8f7b6))
- **desktop:** 🐛 resolve video seeking and tauri production origins ([e9fa832](https://github.com/115jon/ralph-meet/commit/e9fa832cc21e80ba885699575efdc2e0043e4aa0))
- **desktop:** 🐛 revert close-to-tray — blocked by CEF runtime ([ab59cfe](https://github.com/115jon/ralph-meet/commit/ab59cfedfd61468025ea90cf058e2f4abc2b1efc))
- **desktop:** expose full audio device list in the picker ([f8fd46e](https://github.com/115jon/ralph-meet/commit/f8fd46e9d329ab37c430a6a756b9b58d3d35f330))
- **desktop:** register ralphmeet:// deep link scheme during dev ([57b1df5](https://github.com/115jon/ralph-meet/commit/57b1df591c0506ba6065b137012bbd9954a9d661))
- **desktop:** resolve CORS and deep-link auth issues for local development ([833ea79](https://github.com/115jon/ralph-meet/commit/833ea79ebb352ce1725df42f6233aef1b10a7519))
- **do:** 🐛 add replay buffers to channel/server/user broadcasts ([4056247](https://github.com/115jon/ralph-meet/commit/4056247f9861ef84ec5c9c971c3706451d8d184c))
- **embeds:** :bug: proxy x video media playback ([63120b6](https://github.com/115jon/ralph-meet/commit/63120b6ec2f7151806ce5dfd3b56ab85df671c77))
- **embeds:** :bug: remove sandbox from YouTube and TikTok iframes ([e743d31](https://github.com/115jon/ralph-meet/commit/e743d3148f0e487aab9e47e479bd45b1797fbf51))
- **embeds:** :bug: render YouTube Shorts in portrait aspect ratio ([5363faf](https://github.com/115jon/ralph-meet/commit/5363fafc7fe81221e24ed3c0ac402c9e817dc23c))
- **embeds:** :bug: use custom video player for TikTok direct mode ([8d3825b](https://github.com/115jon/ralph-meet/commit/8d3825b223baeebea8c102a95060d97c3dca6ed0))
- **embeds:** 🐛 dedupe x videos across metadata sources ([1e9185d](https://github.com/115jon/ralph-meet/commit/1e9185d9b7a331a9aee8ec7961507696e3b1471e))
- **embeds:** 🐛 detect youtube portrait dimensions ([94c50a6](https://github.com/115jon/ralph-meet/commit/94c50a6a554b2829336be857314659beab64a568))
- **embeds:** 🐛 fix embed size when inline-block shrink-wraps ([5aabc4b](https://github.com/115jon/ralph-meet/commit/5aabc4be64e6ab3500a73c71bd5f4105b8889956))
- **embeds:** 🐛 match X gif behavior and alt text ([a60416d](https://github.com/115jon/ralph-meet/commit/a60416dbddc67acc6c13d801b419a5a684d3d92d))
- **embeds:** 🐛 render complete X media embeds ([13eba26](https://github.com/115jon/ralph-meet/commit/13eba265bc7c465f31d51c9ed56c5602fbf1e66b))
- **embeds:** 🐛 render mixed x media grids correctly ([fda8b1b](https://github.com/115jon/ralph-meet/commit/fda8b1be48c7d4f0e8fc3025312ecb316b97952c))
- **embeds:** 🐛 use shared media viewer for X embeds ([05e2235](https://github.com/115jon/ralph-meet/commit/05e2235b202df19cde7d77b18201d22801b4b65a))
- **gateway:** 🐛 fix voice channel dropping on server switch & duplicate logs ([cf3a5a8](https://github.com/115jon/ralph-meet/commit/cf3a5a81cd255572323700cbb0ba6bcefa5974ea))
- **gateway:** await notification promise on dispatch ([df9c61e](https://github.com/115jon/ralph-meet/commit/df9c61ed11e7fc2a1fcfd657b40913a4ed0c897a))
- **gif-picker:** :bug: isolate stickers and gifs in favorites and media type search ([7a1ac88](https://github.com/115jon/ralph-meet/commit/7a1ac8816abf7767e483c6a428eec666cdfdbff5))
- **gifs:** 🐛 match sent x gif favorite identities ([ac62ebd](https://github.com/115jon/ralph-meet/commit/ac62ebdcb69813a8ba3c403e3c3adcffeb45af93))
- **gifs:** 🐛 preserve favorite state on sent gifs ([9a7b34c](https://github.com/115jon/ralph-meet/commit/9a7b34c641b85ed5c61575bcb66a91e9d7064c4e))
- **gui:** 💄 correct mobile sidebar stacking over voice header ([542897f](https://github.com/115jon/ralph-meet/commit/542897f856e84d658ab66a62180a3e4be0156407))
- **hooks:** 🐛 resolve strict mode React compiler/hooks errors ([721d837](https://github.com/115jon/ralph-meet/commit/721d83792f5d8be991e7e25b17348d18167730a1))
- **media:** 🐛 handle animated gif media in viewer ([65ec591](https://github.com/115jon/ralph-meet/commit/65ec5912ce000da8edd80cdd5465992bcd51afd7))
- **meeting-room:** 🐛 wrap presence update D1 write with ctx.waitUntil ([123b1d1](https://github.com/115jon/ralph-meet/commit/123b1d12f0d06b1f48dc5fe7424c3ec6e27408ac))
- **mobile:** add core:window:allow-close capability for back button exit ([7b4116b](https://github.com/115jon/ralph-meet/commit/7b4116b21681bf033c5c586a639658df274009d5))
- **mobile:** gracefully exit the app or navigate browser back when back button reaches base layer ([c70ddaa](https://github.com/115jon/ralph-meet/commit/c70ddaa6300aa4fdc0ddc96fc363e0b63850af7a))
- **mobile:** pre-load API chunks in useBackButton to fix execution latency when exiting app ([0347a3f](https://github.com/115jon/ralph-meet/commit/0347a3fcb1982bd2d89d350e11afa57e1906d84d))
- **mobile:** remove ?url modifier from splash logo to fix vite MIME resolve errors ([8cb268c](https://github.com/115jon/ralph-meet/commit/8cb268c618dfb4c8139674f9a498fcb5db4387c2))
- **mobile:** remove legacy CloseRequested intercept that conflicts with tauri v2 back handlers ([d6eb7ba](https://github.com/115jon/ralph-meet/commit/d6eb7ba5c548b9f5318a4f515e021cd60e990b48))
- **mobile:** replace tauri-plugin-process with native app.exit(0) command via invoke ([5f194d0](https://github.com/115jon/ralph-meet/commit/5f194d009ee7941213709060282b8d0b89bfcf79))
- **mobile:** replace unsupported window.close() with tauri-plugin-process exit(0) ([a17d61e](https://github.com/115jon/ralph-meet/commit/a17d61e4ee9bc63ff3723feefaa8bbb5c7f01db0))
- **mobile:** resolve react hook rendering order and add back handler to bottom sheet ([aa5a775](https://github.com/115jon/ralph-meet/commit/aa5a775e303b528a81fa6457aaeee3209de066e2))
- **mobile:** robust back-button handling for sidebars and popovers ([f646d38](https://github.com/115jon/ralph-meet/commit/f646d38a36363c56ca14c53d9e141350b46f4461))
- **native-share:** 🐛 align safe hook capture with OBS ([ea27734](https://github.com/115jon/ralph-meet/commit/ea27734ead875119c43170dbf0eae5ceee95c9dd))
- **native-share:** 🐛 fix preview loopback and hook disabled in production ([3de5ac0](https://github.com/115jon/ralph-meet/commit/3de5ac07d2108f9851a284dfc9847889fa2262a3))
- **native-share:** 🐛 wire loopback commands into Tauri and fix hook defaults ([4852981](https://github.com/115jon/ralph-meet/commit/48529817ef6489b7734308bd41f4f9f63508ad52))
- **notifications:** 🐛 fix DM badge counts, pill indicators, and persistence ([b7e525a](https://github.com/115jon/ralph-meet/commit/b7e525ae4349747b69cacf71cf7e183527400736))
- **notifications:** 🐛 resolve DM unread counts not updating or persisting ([44efae7](https://github.com/115jon/ralph-meet/commit/44efae7c02f5d6536c8cb739f2a4ad9262802680))
- only transfer pending sessions when participant_id matches (actual reconnect). For clerk_user_id-only matches (fresh join), clean up the dead SFU sessions instead. ([57edb4b](https://github.com/115jon/ralph-meet/commit/57edb4b0237778d36f894b96097fc9f717d7d5af))
- **profile:** :bug: avoid guest fallback for oauth users ([c7c8ca1](https://github.com/115jon/ralph-meet/commit/c7c8ca1e83cb2f6c6e0d771a59ef28b0818a0867))
- refactor svg strings to react components ([056074b](https://github.com/115jon/ralph-meet/commit/056074be1364fe2dc8ebced0533fbe7cd3902405))
- remove dangerouslySetInnerHTML security warnings ([2caa834](https://github.com/115jon/ralph-meet/commit/2caa834e839bdbbd0da8f251ba914a40989313a9))
- **rtc:** 🐛 fix black screen in screen share and hardware encoder deadlock ([de67300](https://github.com/115jon/ralph-meet/commit/de673003919ed1cf484e9410483c1f53e9c3f696))
- **rtc:** 🐛 proactively unpublish and detach all local tracks gracefully before track stop ([fe279b7](https://github.com/115jon/ralph-meet/commit/fe279b7d831e84849827f1c5e80db7bfbf932b38))
- **runtime:** 🔧 alias use-sync-external-store to React shim, add 404 page ([6fa0842](https://github.com/115jon/ralph-meet/commit/6fa084275e9c5b13904910fc869b1b57cff8893c))
- **security:** 🧹 fully clean up state when user is banned/kicked ([a39a3d1](https://github.com/115jon/ralph-meet/commit/a39a3d1fb92ebd87f93e9f424000bf062af502c9))
- **security:** 🚨 handle self-ban: kick from voice, remove server, navigate away ([7dcbcec](https://github.com/115jon/ralph-meet/commit/7dcbcec58c6f3c3415294840b91e2c12577c5aaa))
- **sfu:** 🐛 fix screen share pull failure and signal timeout leak ([d6bcd40](https://github.com/115jon/ralph-meet/commit/d6bcd4038a42eef07fdd79efb19700a10d4bcec7))
- **sidebar:** 🔒 gate channel/category management actions behind permissions ([815e537](https://github.com/115jon/ralph-meet/commit/815e537b057253a39dd89de6ee4bffb6d206d105))
- **soundboard:** 🐛 support larger custom audio playback ([b632012](https://github.com/115jon/ralph-meet/commit/b632012d99f7ebfa13a20fe1b8c1451523790d40))
- **ui:** 🐛 fix member list popover toggle and unmount crash ([0be9698](https://github.com/115jon/ralph-meet/commit/0be96988ba9c70dc004277a6fa797e346d15f492))
- **ui:** 🐛 fix portrait video fullscreen rendering in viewer ([1ae4681](https://github.com/115jon/ralph-meet/commit/1ae4681e07a1c4421f3b43e456930bdb31f12f59))
- **ui:** 🐛 fix scrollbar overflow past message list boundary ([b91078c](https://github.com/115jon/ralph-meet/commit/b91078ca5f1d1b89f1c8fa10c30561c88ee54a4a))
- **ui:** 🐛 fix trapped focus and escape key closing dialogs ([6e170a8](https://github.com/115jon/ralph-meet/commit/6e170a8894dacfdedae83d513182a8af85d2b547))
- **ui:** 🐛 move message-input spacing outside scroll container ([c1d1b70](https://github.com/115jon/ralph-meet/commit/c1d1b70806c0ac13ed571d402fcdc51d0d60e896))
- **ui:** 🐛 prevent tooltips from intercepting hover events ([b1d362b](https://github.com/115jon/ralph-meet/commit/b1d362bd0b6e1ed059b08cf598b527b99316be4c))
- **ui:** 💄 align overlay UI and add global escape key handlers ([59373a8](https://github.com/115jon/ralph-meet/commit/59373a80d4c52b95f44653a9c23b907d54790616))
- **ui:** 💄 enhance voice header legibility with dark gradients in cinema mode ([1649796](https://github.com/115jon/ralph-meet/commit/1649796d538eef91ad62d5b7129b5bb0745ff84e))
- **ui:** 💄 fix settings modal scrollbar overlapping close button ([f81e39f](https://github.com/115jon/ralph-meet/commit/f81e39fd87c0870920202376f5156bfafc088d67))
- **ui:** 💄 fix voice layout avatar sizing and consistency ([adcec65](https://github.com/115jon/ralph-meet/commit/adcec655fde37bd1916e1a0716cc3a3e97950524))
- **ui:** 💄 improve channel details discoverability and tab metadata ([2008862](https://github.com/115jon/ralph-meet/commit/20088625b7e048572ed91ff5c30df252cea0eec7))
- **ui:** 💄 refine voice grid avatar display and background styling ([e295124](https://github.com/115jon/ralph-meet/commit/e2951241aaff5c23034910b2dc9e84c0f0cd5f89))
- **ui:** 🔧 adapt media viewer toolbar for videos, fix scroll jitter ([c7b6639](https://github.com/115jon/ralph-meet/commit/c7b6639ec2d34bd2e72a9b057bd7c627093411ad))
- **ui:** correct Virtuoso scroll index calculations for jump-to-message ([6c55fa1](https://github.com/115jon/ralph-meet/commit/6c55fa1e878b244c80d126cf15a1998a42bb04f3))
- **ui:** do not render disconnected users as ringing ([f9836c2](https://github.com/115jon/ralph-meet/commit/f9836c2ccdf0bc74092a522f56abc49a88148cfe))
- **vite:** 🔧 pre-bundle use-sync-external-store for ESM compatibility ([6b3e86f](https://github.com/115jon/ralph-meet/commit/6b3e86f4082290cd07c2f045b7299e071900fe6d))
- **vite:** 🔧 use resolveId plugin for use-sync-external-store shim ([12af25a](https://github.com/115jon/ralph-meet/commit/12af25a86ec5dd5d4be7b78837e9c846b7c884d6))
- **voice-room:** 🐛 await handleVoiceIdentify and remove redundant heartbeat persist ([a22a39d](https://github.com/115jon/ralph-meet/commit/a22a39d90acd8c39bdba5ee08ccef9b1541f6d18))
- **voice:** :bug: handle addTransceiver failure by falling back to compatible RTP encodings ([39032f8](https://github.com/115jon/ralph-meet/commit/39032f86d862a540117e5a2d80fd9b98ac7a10da))
- **voice:** :bug: preserve sidebar presence on reconnect ([e4d0e2f](https://github.com/115jon/ralph-meet/commit/e4d0e2fa8d40fe0d1555045cc5bc8a4533692637))
- **voice:** :bug: rejoin voice on first click under StrictMode ([befff94](https://github.com/115jon/ralph-meet/commit/befff9449e2e0bdf3b3d0dcb5b34c1e6ce7c4671))
- **voice:** :bug: reset auto-join when switching channels ([7c19b09](https://github.com/115jon/ralph-meet/commit/7c19b0994bdb2a7df77e997df00f513060dbf2e5))
- **voice:** :bug: restore sidebar voice join ([d8a338a](https://github.com/115jon/ralph-meet/commit/d8a338af08557b07fa298f868d814df9ab475eec))
- **voice:** :bug: stabilize cloudflare realtime calls ([d3918a1](https://github.com/115jon/ralph-meet/commit/d3918a1523c77fa964edb6869613d07562117937))
- **voice:** :speaker: continue join after voice switch confirm ([7cd3b06](https://github.com/115jon/ralph-meet/commit/7cd3b06131c879a50b9a183d04b22ab28687edb0))
- **voice:** :speaker: leave and rejoin when switching channels ([7c03ed2](https://github.com/115jon/ralph-meet/commit/7c03ed2b0405077438e33e87a96915d033a55482))
- **voice:** ⚡️ eliminate publish delay on join and reload ([ae2b093](https://github.com/115jon/ralph-meet/commit/ae2b093d734fe86a0381055459bc307f9aa0656e))
- **voice:** ⚡️ zero-interruption voice reconnect via SFU session transfer ([0f9cc89](https://github.com/115jon/ralph-meet/commit/0f9cc895c931c906a08069ad7bdcec3d7b22581d))
- **voice:** 🐛 add cursor overlay to screen share + remove dead capture ref ([5750ed3](https://github.com/115jon/ralph-meet/commit/5750ed3404767cbe12a3686d6866727409e4c49f))
- **voice:** 🐛 await ICE connected state before sending TracksReady ([0969c16](https://github.com/115jon/ralph-meet/commit/0969c16a9a5fc30dbb017a522d62eb4c5bca3ae3))
- **voice:** 🐛 await tracks/close to prevent race with re-publish ([4933b80](https://github.com/115jon/ralph-meet/commit/4933b80ac8c3239ec02a975da6b8284fa5ee0571))
- **voice:** 🐛 delay pull for re-published tracks after quality change ([81b12f5](https://github.com/115jon/ralph-meet/commit/81b12f5ff69c21e8defa45cb1eeae50774169489))
- **voice:** 🐛 don't transfer dead SFU sessions on fresh join ([57edb4b](https://github.com/115jon/ralph-meet/commit/57edb4b0237778d36f894b96097fc9f717d7d5af))
- **voice:** 🐛 expose sfuInstance as reactive state to fix stuck Connecting status ([8835ae5](https://github.com/115jon/ralph-meet/commit/8835ae503adac262b4d65bcbfe461ab0f73e05ed))
- **voice:** 🐛 fix 1080p stream degrading to 451p for receivers ([37e51d8](https://github.com/115jon/ralph-meet/commit/37e51d8af3041d0882818c6f99222d3308762457))
- **voice:** 🐛 fix hibernation desync, SFU leaks, and voice reconnect ([16ad317](https://github.com/115jon/ralph-meet/commit/16ad31791b74b7f94d1d34867281f058b7e45a33))
- **voice:** 🐛 fix infinite render loops in settings and device swap ([48c361c](https://github.com/115jon/ralph-meet/commit/48c361ca6cdee2640b5313bac3765b379b3babf2))
- **voice:** 🐛 fix pull-side concurrency bugs and double-publish on initial connect ([498e472](https://github.com/115jon/ralph-meet/commit/498e4724be99d35d1a554d04c9c50b6c518b248b))
- **voice:** 🐛 fix screen share pull recovery and voice state desync ([c70377b](https://github.com/115jon/ralph-meet/commit/c70377b53f713053c0c76aaded55b3924547c4b1))
- **voice:** 🐛 fix screen share quality and restore thumbnails ([a348aff](https://github.com/115jon/ralph-meet/commit/a348aff6ce530f0313bc18202f04cf1792a127cb))
- **voice:** 🐛 fix screen share re-publish by reusing push session ([c777aa9](https://github.com/115jon/ralph-meet/commit/c777aa9401940472aa66a66893c3a9922fde26a4))
- **voice:** 🐛 fix screen share re-stream race condition ([244d1bc](https://github.com/115jon/ralph-meet/commit/244d1bce6859d655886c6be4174464fb9228d949))
- **voice:** 🐛 fix stream freeze when changing quality ([21e1755](https://github.com/115jon/ralph-meet/commit/21e1755d2f9fcb63a8ff2c2b447afdacaaf51e16))
- **voice:** 🐛 harden WebRTC edge cases for ICE failure and rapid screen toggle ([3354162](https://github.com/115jon/ralph-meet/commit/33541623c570ed382083e63373e2f2160f3e9411))
- **voice:** 🐛 hide stream volume without audio ([0930c2a](https://github.com/115jon/ralph-meet/commit/0930c2a17b5736484e228258fcdb79aaa5ff715e))
- **voice:** 🐛 ignore stale StopTracks payloads on fast republish ([aa2bde6](https://github.com/115jon/ralph-meet/commit/aa2bde67fdc7badb10d6abb9c078092e2e50e8e3))
- **voice:** 🐛 implement event-driven TracksReady signal ([c6cb73f](https://github.com/115jon/ralph-meet/commit/c6cb73ffc627e5d1cbd0085a5a42f775525bc9ca))
- **voice:** 🐛 keep stream video subscribed ([15fc12a](https://github.com/115jon/ralph-meet/commit/15fc12a8f6a0217f0339adb8c40b3da9a0941b8a))
- **voice:** 🐛 prefer freshest avatar source ([663eba6](https://github.com/115jon/ralph-meet/commit/663eba67c2e9d918c955c58b10b0d47b67f1fc4a))
- **voice:** 🐛 prevent audio peaking and improve mic quality ([e2baf5e](https://github.com/115jon/ralph-meet/commit/e2baf5e9a18a0520e8a982b038b2a4f39359a5c4))
- **voice:** 🐛 propagate display names through sfu ([15134b6](https://github.com/115jon/ralph-meet/commit/15134b6d06a773223abd319afb20180f2b0e6661))
- **voice:** 🐛 recreate MediaStream references to prevent video freezes ([c46f6c9](https://github.com/115jon/ralph-meet/commit/c46f6c9e97298850cba0ffabed9ad54e8b705764))
- **voice:** 🐛 recreate PeerConnections on session resume path ([ffbd9fd](https://github.com/115jon/ralph-meet/commit/ffbd9fdb5c3f766490cf700a8be1e9c108021eb6))
- **voice:** 🐛 refresh voice token on session resume ([2f2af87](https://github.com/115jon/ralph-meet/commit/2f2af878d427daa8813f1cce876f386c5d26a148))
- **voice:** 🐛 replace polling with push-based stats subscription ([47f51df](https://github.com/115jon/ralph-meet/commit/47f51df1b72ca285c2c338a7e6d027bbbc663984))
- **voice:** 🐛 resolve missing avatars and stale device selection in voice channels ([89a17dd](https://github.com/115jon/ralph-meet/commit/89a17dd5c5c98e62c3a28806150d6bf3c0096444))
- **voice:** 🐛 resolve permanent audio dropouts on screen share stop ([a7a02af](https://github.com/115jon/ralph-meet/commit/a7a02aff29a934fbb7b3836bb775eafc9feefaf9))
- **voice:** 🐛 resolve screen share black screen on restart ([bb1fd2e](https://github.com/115jon/ralph-meet/commit/bb1fd2eef3795fe909d484e7d8b2a1108b26dc9f))
- **voice:** 🐛 resolve voice reconnect loop and add 4006 fallback ([5928a2d](https://github.com/115jon/ralph-meet/commit/5928a2db9c28227b9f88d81e662d8437651e25b9))
- **voice:** 🐛 separate stream and user volume controls ([328683e](https://github.com/115jon/ralph-meet/commit/328683e4cd996030f234a6a0068425f6bbe4ca52))
- **voice:** 🐛 show all stream qualities and fix dashboard share button ([f516c12](https://github.com/115jon/ralph-meet/commit/f516c12816364643324895d150abd55ce3d6c53f))
- **voice:** 🐛 stop reusing transceivers after closing them on SFU ([90d6b84](https://github.com/115jon/ralph-meet/commit/90d6b8480bc5693a4cdc73232b4cf636279150a0))
- **voice:** 🔇 fix VAD gate reliability and gate debug logs behind DEV flag ([9c6e3f0](https://github.com/115jon/ralph-meet/commit/9c6e3f0c19076872301ce80f0e3d580521a4a950))
- **voice:** fix state staleness across pc recreations ([ffdf60b](https://github.com/115jon/ralph-meet/commit/ffdf60bf28b1290ff32d59bc7750e37ae2649dbc))
- **voice:** improve overnight stability and fix UI desyncs ([064cea9](https://github.com/115jon/ralph-meet/commit/064cea9a4400de4cc1cb37e53c1e6b4dcde3fc28))
- **voice:** recover from SFU internal errors during track negotiation ([e9f5be5](https://github.com/115jon/ralph-meet/commit/e9f5be5972f76a80ec57403f15d438022b24a113))
- **webrtc:** :bug: fix one-way audio after hot reload ([c000ddf](https://github.com/115jon/ralph-meet/commit/c000ddfbed3e53c7dadf58b2c1fb110db2eb918a))
- **webrtc:** 🐛 resolve metrics permanently stuck on loading and improve signal UI ([bbd881f](https://github.com/115jon/ralph-meet/commit/bbd881fe67371a5fb51e75f2a5f17ba749c93473))
- **wordle:** 🐛 load current NYT puzzle ([915f0bd](https://github.com/115jon/ralph-meet/commit/915f0bd9b91013513923e4d091d46c168cd11836))
- **worker:** 🐛 fix alarm error handling and normalize log prefixes to [ChatGW] ([3374654](https://github.com/115jon/ralph-meet/commit/337465433de67233a1ff15f8635034db478bbe9d))
- **ws:** 🐛 simplify heartbeat auto-response pattern for proper hibernation ([878d010](https://github.com/115jon/ralph-meet/commit/878d01063ad43ca7266aeb0c0d2d9a1fa0441815))

### Performance Improvements

- **chat:** :zap: coalesce bootstrap loading ([bac8b24](https://github.com/115jon/ralph-meet/commit/bac8b244ad2bf49a29d73c01249cf670b9617803))
- **chat:** :zap: lazy load remaining screen share modals ([909bcbc](https://github.com/115jon/ralph-meet/commit/909bcbcca1d3cfbd030d3f86574d4c3061f668be))
- **chat:** :zap: lazy load screen share pickers ([fb5a441](https://github.com/115jon/ralph-meet/commit/fb5a441e5f8b40eca5a31d999866ffd18b7605b5))
- **chat:** :zap: lazy load user panel popovers ([63b4c5c](https://github.com/115jon/ralph-meet/commit/63b4c5cf250954cff7c64b05f0c8eb8f4b5af674))
- **chat:** :zap: lazy load user settings modal ([280aeb4](https://github.com/115jon/ralph-meet/commit/280aeb4d89879fbaaacc241de12b431a484a9077))
- **chat:** :zap: lazy load voice confirmation modals ([60b17f4](https://github.com/115jon/ralph-meet/commit/60b17f44689c8556e0825b74c6d47328e410396e))
- **chat:** :zap: lazy load voice dashboard ([b73b9f6](https://github.com/115jon/ralph-meet/commit/b73b9f65f0e3a0a180b450c2447a864e993dbccb))
- **chat:** ⚡️ cache messages across channel switches ([2bb0723](https://github.com/115jon/ralph-meet/commit/2bb07237d7ba30b7df16b3219c52a3204116c6e9))
- **chat:** ⚡️ cache server navigation data ([f8f873c](https://github.com/115jon/ralph-meet/commit/f8f873cdb53335bb97491f0b7ed4460763a6ee3a))
- **chat:** ⚡️ cache Tenor GIF requests ([ca61b1e](https://github.com/115jon/ralph-meet/commit/ca61b1e490b5dc12ffe3453a8c1d70b2ee19c012))
- **chat:** ⚡️ convert remaining full-store subscribers to useShallow selectors ([bda7c71](https://github.com/115jon/ralph-meet/commit/bda7c71cb10745f83821d24399c5cca7fd05511f))
- **chat:** ⚡️ fix re-render storms from speaking state and full-store subscriptions ([80bcc10](https://github.com/115jon/ralph-meet/commit/80bcc1050b894f7e8be68126cfa6dfaa7b858fec))
- **chat:** ⚡️ keep played media mounted in virtual list ([7cafa9b](https://github.com/115jon/ralph-meet/commit/7cafa9b11e6bff148d4e87d95ca593fe07a03f92))
- **chat:** ⚡️ reduce gif send latency ([306a653](https://github.com/115jon/ralph-meet/commit/306a6535e3169d1fabae82dbe731ccd94b0cf295))
- **chat:** ⚡️ virtualize message list with react-virtuoso ([be95ced](https://github.com/115jon/ralph-meet/commit/be95ced38bbc1d07a056fc8ab2200bb43328a5b4))
- **desktop:** :zap: implement zero-overhead screen share pipeline with DX11 game-capture hook ([6575356](https://github.com/115jon/ralph-meet/commit/6575356401f68199aabc0d41d5e7780e72288415))
- **desktop:** :zap: streamline chat startup ([c813983](https://github.com/115jon/ralph-meet/commit/c813983d97613ec0db0f844be202e21ece05788e))
- **desktop:** ⚡️ eliminate IPC registry overhead and enable hw acceleration ([be2512e](https://github.com/115jon/ralph-meet/commit/be2512e4607684ae21b61369f775f2bfd56bb096))
- **do:** ⚡️ batch storage.put() calls with dirty-flag pattern ([a30fafd](https://github.com/115jon/ralph-meet/commit/a30fafd5c8eb20aadbe96087796219312c6933e9))
- **do:** ⚡️ cache Clerk profiles in KV with 5min TTL ([c433076](https://github.com/115jon/ralph-meet/commit/c433076c2f5f76c28f09bf48cf9eefc19980754f))
- **do:** ⚡️ debounce D1 writes in handlePresenceUpdate ([b910f05](https://github.com/115jon/ralph-meet/commit/b910f051fb25344a04d8893fe598d1cf178f78b6))
- **do:** ⚡️ split voiceChannelMembers into per-channel storage keys ([a081123](https://github.com/115jon/ralph-meet/commit/a0811235d9dc2825aa5075d0fde0caee227da8ca))
- **media:** ⚡️ use permissions.query() for fast mic/camera detection ([900f02f](https://github.com/115jon/ralph-meet/commit/900f02faa1c8bd71ad38ce8e50e961c58d397a18))
- **screen-share:** ⚡ replace native capture with CEF chromeMediaSource API ([1d960b0](https://github.com/115jon/ralph-meet/commit/1d960b0773380153a523b1acd9fe0bcf9e7274bb))
- **security:** 🔒 reduce TURN credential TTL from 24h to 1h ([08d10fa](https://github.com/115jon/ralph-meet/commit/08d10fa0e84a3d29c63ac95715b2040c276d315b))
- **voice-room:** ⚡️ add SFU retry logic and reduce voice token TTL ([9ecbef8](https://github.com/115jon/ralph-meet/commit/9ecbef8637f41f8aae785ce9dc4bbba0c7426884))
- **voice:** :zap: lazy load screen share modal ([ffd4ecc](https://github.com/115jon/ralph-meet/commit/ffd4ecc93f6887eae87cafea29785a607055980a))
- **voice:** :zap: lazy load stream context menu ([25231ea](https://github.com/115jon/ralph-meet/commit/25231eadda3eef28b9d1e6df192e45f46e0091da))
- **voice:** :zap: preserve screen share source metadata ([74feb44](https://github.com/115jon/ralph-meet/commit/74feb44ad1ed5498eaf4e7f79e2faf5177ba635a))
- **webrtc:** ⚡️ optimize connection and media flow latency ([92aed92](https://github.com/115jon/ralph-meet/commit/92aed92109542f19272bd5904ebc7a86c884132e))
- **worker:** ⚡️ hoist SSR handler and pre-compile rate limiter regexes ([31e1a11](https://github.com/115jon/ralph-meet/commit/31e1a11c2607ed2395c54b6f905380abd0def3df))

### Miscellaneous Chores

- **release:** bump to accurate semantic version 1.0.0 ([1563867](https://github.com/115jon/ralph-meet/commit/1563867df8f96ee51775a067a78073b25ba1fcba))

### Code Refactoring

- **api:** ♻️ flatten api responses and completely replace raw fetch calls ([a93a52e](https://github.com/115jon/ralph-meet/commit/a93a52e03fcaf3119c17c4e659dcb3a42588d5dc))

## Changelog
