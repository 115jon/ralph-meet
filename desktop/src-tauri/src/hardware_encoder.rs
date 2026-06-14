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

#[cfg(target_os = "windows")]
fn read_mf_string(
    activate: &windows::Win32::Media::MediaFoundation::IMFActivate,
    key: &windows::core::GUID,
) -> Option<String> {
    use windows::core::PWSTR;
    use windows::Win32::System::Com::CoTaskMemFree;

    unsafe {
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
}

#[cfg(target_os = "windows")]
fn enumerate_hardware_encoders(
    subtype: windows::core::GUID,
) -> Result<Vec<HardwareVideoEncoder>, String> {
    use std::slice;
    use windows::Win32::Media::MediaFoundation::{
        MFMediaType_Video, MFShutdown, MFStartup, MFTEnumEx, MFT_FRIENDLY_NAME_Attribute,
        MFT_TRANSFORM_CLSID_Attribute, MFVideoFormat_NV12, MF_TRANSFORM_FLAGS_Attribute,
        MFSTARTUP_NOSOCKET, MFT_CATEGORY_VIDEO_ENCODER, MFT_ENUM_FLAG, MFT_ENUM_FLAG_HARDWARE,
        MFT_ENUM_FLAG_SORTANDFILTER, MFT_REGISTER_TYPE_INFO, MF_VERSION,
    };
    use windows::Win32::System::Com::CoTaskMemFree;

    unsafe {
        MFStartup(MF_VERSION, MFSTARTUP_NOSOCKET).map_err(|e| format!("MFStartup failed: {e}"))?;

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
        let mut count = 0;
        let result = MFTEnumEx(
            MFT_CATEGORY_VIDEO_ENCODER,
            flags,
            Some(&input),
            Some(&output),
            &mut activates,
            &mut count,
        );

        if let Err(err) = result {
            let _ = MFShutdown();
            return Err(format!("MFTEnumEx failed: {err}"));
        }

        let mut encoders = Vec::new();
        for activate in slice::from_raw_parts_mut(activates, count as usize) {
            if let Some(activate) = activate.take() {
                let name = read_mf_string(&activate, &MFT_FRIENDLY_NAME_Attribute)
                    .unwrap_or_else(|| "Unknown hardware encoder".to_owned());
                let clsid = activate
                    .GetGUID(&MFT_TRANSFORM_CLSID_Attribute)
                    .map(|guid| format!("{guid:?}"))
                    .unwrap_or_else(|_| "unknown".to_owned());
                let encoder_flags = activate.GetUINT32(&MF_TRANSFORM_FLAGS_Attribute).ok();
                encoders.push(HardwareVideoEncoder {
                    name,
                    clsid,
                    flags: encoder_flags,
                });
            }
        }

        CoTaskMemFree(Some(activates as _));
        let _ = MFShutdown();
        Ok(encoders)
    }
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub fn probe_hardware_video_encoders() -> Result<HardwareEncoderProbe, String> {
    use windows::Win32::Media::MediaFoundation::{MFVideoFormat_H264, MFVideoFormat_HEVC};

    let h264 = enumerate_hardware_encoders(MFVideoFormat_H264)?;
    let hevc = enumerate_hardware_encoders(MFVideoFormat_HEVC).unwrap_or_default();
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
