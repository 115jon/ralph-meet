## Krisp-Style Noise Reduction Plan

1. Verify current vendor constraints for Krisp Browser SDK and keep the implementation provider-backed so we can support an open RNNoise path now and a Krisp adapter later.
2. Trace the existing mic capture and processed-track pipeline to find the live swap point for outbound audio and the local loopback seam for mic testing.
3. Extend voice settings state with a noise-reduction mode and enabled flag that can be toggled from both the settings modal and the in-call control cluster.
4. Implement a browser-safe denoiser service that can process outbound microphone audio in real time and update seamlessly while a call or mic test is active.
5. Add UI for voice settings and the in-call quick toggle, then run focused validation for browser and desktop behavior.
