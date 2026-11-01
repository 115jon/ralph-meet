//! Hardware video-encoder enumeration (Media Foundation `MFTEnumEx`).
//!
//! The single place encoder MFTs are enumerated: the renderer's
//! `probe_hardware_video_encoders` command (which decides whether the native
//! publisher is used at all) and the native encoder worker (`wmf_encoder`,
//! which picks the backend it activates) both call
//! [`enumerate_hardware_encoder_activates`], so they can never disagree.

#[derive(Debug, serde::Serialize)]
pub struct HardwareVideoEncoder {
    pub name: String,
    pub clsid: String,
    pub flags: Option<u32>,
}

#[derive(Debug, serde::Serialize)]
pub struct HardwareEncoderProbe {
    pub h264: Vec<HardwareVideoEncoder>,
    pub hevc: Vec<HardwareVideoEncoder>,
}

/// Read an `IMFActivate` allocated-string attribute (e.g.
/// `MFT_FRIENDLY_NAME_Attribute`), freeing the buffer `GetAllocatedString`
/// hands back. Returns `None` if the attribute is absent.
///
/// # Safety
/// `activate` must be a live `IMFActivate`.
#[cfg(target_os = "windows")]
pub(crate) unsafe fn read_activate_string(
    activate: &windows::Win32::Media::MediaFoundation::IMFActivate,
    key: &windows::core::GUID,
) -> Option<String> {
    use windows::core::PWSTR;
    use windows::Win32::System::Com::CoTaskMemFree;

    let mut raw = PWSTR::null();
    let mut len = 0;
    activate.GetAllocatedString(key, &mut raw, &mut len).ok()?;
    if raw.is_null() {
        return None;
    }
    let value = raw.to_string().ok();
    CoTaskMemFree(Some(raw.0 as _));
    value
}

/// Enumerate hardware video-encoder MFTs that take NV12 and produce `subtype`,
/// in Media Foundation's sorted (merit) order, taking ownership of each
/// activate. An empty result is `Ok(vec![])`.
///
/// # Safety
/// Media Foundation must be started (`MFStartup`) on this process.
#[cfg(target_os = "windows")]
pub(crate) unsafe fn enumerate_hardware_encoder_activates(
    subtype: windows::core::GUID,
) -> windows::core::Result<Vec<windows::Win32::Media::MediaFoundation::IMFActivate>> {
    use windows::Win32::Media::MediaFoundation::{
        MFMediaType_Video, MFTEnumEx, MFVideoFormat_NV12, MFT_CATEGORY_VIDEO_ENCODER,
        MFT_ENUM_FLAG, MFT_ENUM_FLAG_HARDWARE, MFT_ENUM_FLAG_SORTANDFILTER, MFT_REGISTER_TYPE_INFO,
    };
    use windows::Win32::System::Com::CoTaskMemFree;

    let input = MFT_REGISTER_TYPE_INFO {
        guidMajorType: MFMediaType_Video,
        guidSubtype: MFVideoFormat_NV12,
    };
    let output = MFT_REGISTER_TYPE_INFO {
        guidMajorType: MFMediaType_Video,
        guidSubtype: subtype,
    };
    let flags = MFT_ENUM_FLAG(MFT_ENUM_FLAG_HARDWARE.0 | MFT_ENUM_FLAG_SORTANDFILTER.0);
    let mut activates = std::ptr::null_mut();
    let mut count = 0u32;
    MFTEnumEx(
        MFT_CATEGORY_VIDEO_ENCODER,
        flags,
        Some(&input),
        Some(&output),
        &mut activates,
        &mut count,
    )?;

    let mut result = Vec::with_capacity(count as usize);
    if count > 0 && !activates.is_null() {
        for item in std::slice::from_raw_parts_mut(activates, count as usize) {
            if let Some(activate) = item.take() {
                result.push(activate);
            }
        }
    }
    CoTaskMemFree(Some(activates as _));
    Ok(result)
}

#[cfg(target_os = "windows")]
fn probe_encoders(subtype: windows::core::GUID) -> Result<Vec<HardwareVideoEncoder>, String> {
    use windows::Win32::Media::MediaFoundation::{
        MFShutdown, MFStartup, MFT_FRIENDLY_NAME_Attribute, MFT_TRANSFORM_CLSID_Attribute,
        MF_TRANSFORM_FLAGS_Attribute, MFSTARTUP_NOSOCKET, MF_VERSION,
    };

    unsafe {
        MFStartup(MF_VERSION, MFSTARTUP_NOSOCKET).map_err(|e| format!("MFStartup failed: {e}"))?;
        let activates = enumerate_hardware_encoder_activates(subtype);
        let encoders = activates.map(|activates| {
            activates
                .iter()
                .map(|activate| HardwareVideoEncoder {
                    name: read_activate_string(activate, &MFT_FRIENDLY_NAME_Attribute)
                        .unwrap_or_else(|| "Unknown hardware encoder".to_owned()),
                    clsid: activate
                        .GetGUID(&MFT_TRANSFORM_CLSID_Attribute)
                        .map(|guid| format!("{guid:?}"))
                        .unwrap_or_else(|_| "unknown".to_owned()),
                    flags: activate.GetUINT32(&MF_TRANSFORM_FLAGS_Attribute).ok(),
                })
                .collect()
        });
        let _ = MFShutdown();
        encoders.map_err(|e| format!("MFTEnumEx failed: {e}"))
    }
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub fn probe_hardware_video_encoders() -> Result<HardwareEncoderProbe, String> {
    use windows::Win32::Media::MediaFoundation::{MFVideoFormat_H264, MFVideoFormat_HEVC};

    let h264 = probe_encoders(MFVideoFormat_H264)?;
    let hevc = probe_encoders(MFVideoFormat_HEVC).unwrap_or_default();
    log::info!(
        "[HardwareEncoder] Found {} H.264 hardware encoder(s), {} HEVC hardware encoder(s)",
        h264.len(),
        hevc.len()
    );
    Ok(HardwareEncoderProbe { h264, hevc })
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
pub fn probe_hardware_video_encoders() -> Result<HardwareEncoderProbe, String> {
    Ok(HardwareEncoderProbe {
        h264: Vec::new(),
        hevc: Vec::new(),
    })
}
