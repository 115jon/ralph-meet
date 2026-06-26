//! Property-based test for the OBS `hook_info` frame-metadata IPC codec.
//!
//! Feature: universal-game-capture-hook, Property 8: OBS frame-metadata IPC
//! round-trip preserves all fields.
//!
//! Validates: Requirements 1.7
//!
//! The codec under test is the pure, GPU-/OS-independent
//! `app_lib::game_capture::obs_ipc::{encode_hook_info, decode_hook_info}`. It is
//! the project's clean-room writer-of-record for the host-side reader, so decode
//! is the exact inverse of encode by construction; this property pins that
//! inverse across the full `FrameMetadata` input space (every field's full
//! range, including the numeric extremes). A second property asserts that a byte
//! slice of the wrong length decodes to `Err(IpcError)` (malformed) rather than
//! panicking.
//!
//! NOTE: This is an integration-test crate, so the codec must be reachable as
//! `app_lib::game_capture::obs_ipc` — it is declared `pub mod obs_ipc` behind
//! `#[cfg(feature = "game-capture-hook")]` (on top of `native-screen-share`) in
//! `game_capture/mod.rs`. Run with:
//!   cargo test --features game-capture-hook --test prop_obs_ipc_roundtrip

#![cfg(feature = "game-capture-hook")]

use app_lib::game_capture::obs_ipc::{
    decode_hook_info, encode_hook_info, FrameMetadata, IpcError, HOOK_INFO_LEN,
};
use proptest::prelude::*;

/// Strategy producing arbitrary `FrameMetadata` over the FULL range of each
/// field, with the numeric extremes (0 and each type's MAX/MIN) explicitly
/// over-sampled so the round-trip is exercised at the boundaries — not just on
/// the middling values a uniform sampler favours.
fn frame_metadata_strategy() -> impl Strategy<Value = FrameMetadata> {
    (full_u32(), full_u32(), full_u32(), full_i64(), full_u64()).prop_map(
        |(width, height, format, timestamp_qpc, shared_handle)| FrameMetadata {
            width,
            height,
            format,
            timestamp_qpc,
            shared_handle,
        },
    )
}

/// Full-range `u32` with the extremes (`0`, `u32::MAX`) over-sampled.
fn full_u32() -> impl Strategy<Value = u32> {
    prop_oneof![
        1 => Just(0u32),
        1 => Just(u32::MAX),
        8 => any::<u32>(),
    ]
}

/// Full-range `i64` with the extremes (`0`, `i64::MIN`, `i64::MAX`, `-1`)
/// over-sampled — `timestamp_qpc` is signed (`LONGLONG`) so negatives matter.
fn full_i64() -> impl Strategy<Value = i64> {
    prop_oneof![
        1 => Just(0i64),
        1 => Just(i64::MIN),
        1 => Just(i64::MAX),
        1 => Just(-1i64),
        8 => any::<i64>(),
    ]
}

/// Full-range `u64` with the extremes (`0`, `u64::MAX`) over-sampled.
fn full_u64() -> impl Strategy<Value = u64> {
    prop_oneof![
        1 => Just(0u64),
        1 => Just(u64::MAX),
        8 => any::<u64>(),
    ]
}

proptest! {
    // Property 8 requires a minimum of 100 iterations; run well above the floor
    // so the over-sampled extremes and the random interior are both covered.
    #![proptest_config(ProptestConfig::with_cases(1024))]

    /// Feature: universal-game-capture-hook, Property 8: OBS frame-metadata IPC
    /// round-trip preserves all fields.
    ///
    /// For every `FrameMetadata m`, decoding its encoding reproduces `m`
    /// exactly: `decode_hook_info(&encode_hook_info(&m)) == Ok(m)`. Because the
    /// codec is the writer-of-record for the reader, this is the totality and
    /// inverse guarantee the host depends on (Req 1.7).
    ///
    /// Validates: Requirements 1.7
    #[test]
    fn obs_frame_metadata_ipc_roundtrip_preserves_all_fields(
        meta in frame_metadata_strategy(),
    ) {
        let encoded = encode_hook_info(&meta);

        // The encoding is always exactly the fixed on-wire length, so the
        // reader's length check accepts every value the writer produces.
        prop_assert_eq!(
            encoded.len(),
            HOOK_INFO_LEN,
            "encode must always produce exactly HOOK_INFO_LEN bytes"
        );

        // Round-trip: decode is the exact inverse of encode (Req 1.7).
        let decoded = decode_hook_info(&encoded);
        prop_assert_eq!(
            decoded,
            Ok(meta),
            "decode(encode(m)) must reproduce m exactly for every field"
        );
    }

    /// Decoding a byte slice whose length is NOT `HOOK_INFO_LEN` returns
    /// `Err(IpcError::MalformedHookInfo)` rather than panicking — the reader
    /// must never crash on a short, long, or empty `hook_info` payload (Req
    /// 1.7). The reported `got`/`expected` lengths describe the malformation.
    ///
    /// Validates: Requirements 1.7
    #[test]
    fn decode_wrong_length_is_malformed_not_panic(
        // Any length except the one valid length; capped so the test is cheap.
        bytes in proptest::collection::vec(any::<u8>(), 0..=128)
            .prop_filter("exclude the one valid length", |b| b.len() != HOOK_INFO_LEN),
    ) {
        let result = decode_hook_info(&bytes);
        prop_assert_eq!(
            result,
            Err(IpcError::MalformedHookInfo {
                got: bytes.len(),
                expected: HOOK_INFO_LEN,
            }),
            "a wrong-length slice must decode to MalformedHookInfo, never panic"
        );
    }
}

/// A focused, non-property check that the documented extreme is handled: the
/// all-`0xFF` valid-length buffer (every field saturated) round-trips, and the
/// boundary lengths around `HOOK_INFO_LEN` are malformed. Complements the
/// property with concrete, named edge cases.
#[test]
fn extremes_and_boundary_lengths() {
    // All-max metadata round-trips.
    let saturated = FrameMetadata {
        width: u32::MAX,
        height: u32::MAX,
        format: u32::MAX,
        timestamp_qpc: i64::MIN,
        shared_handle: u64::MAX,
    };
    assert_eq!(
        decode_hook_info(&encode_hook_info(&saturated)),
        Ok(saturated)
    );

    // All-zero metadata round-trips.
    let zeroed = FrameMetadata {
        width: 0,
        height: 0,
        format: 0,
        timestamp_qpc: 0,
        shared_handle: 0,
    };
    assert_eq!(decode_hook_info(&encode_hook_info(&zeroed)), Ok(zeroed));

    // One byte short and one byte long are both malformed, not panics.
    for len in [HOOK_INFO_LEN - 1, HOOK_INFO_LEN + 1, 0] {
        assert_eq!(
            decode_hook_info(&vec![0u8; len]),
            Err(IpcError::MalformedHookInfo {
                got: len,
                expected: HOOK_INFO_LEN,
            }),
        );
    }
}
