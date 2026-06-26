use serde::Serialize;

#[derive(Debug, Serialize, Clone)]
pub struct NativeDevice {
    pub device_id: String,
    pub label: String,
    pub kind: String,
    pub is_default: bool,
}

#[cfg(target_os = "windows")]
fn enumerate_windows_audio_devices() -> windows::core::Result<Vec<NativeDevice>> {
    use windows::core::PWSTR;
    use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
    use windows::Win32::Media::Audio::{
        eCapture, eCommunications, eRender, IMMDevice, IMMDeviceEnumerator, MMDeviceEnumerator,
        DEVICE_STATE_ACTIVE,
    };
    use windows::Win32::System::Com::StructuredStorage::{
        PropVariantClear, PropVariantToStringAlloc,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_ALL, COINIT_MULTITHREADED,
        STGM_READ,
    };

    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;

        let default_input_id = default_endpoint_id(&enumerator, eCapture).ok();
        let default_output_id = default_endpoint_id(&enumerator, eRender).ok();
        let mut devices = Vec::new();

        for (flow, kind, default_id) in [
            (eCapture, "audioinput", default_input_id.as_deref()),
            (eRender, "audiooutput", default_output_id.as_deref()),
        ] {
            let collection = enumerator.EnumAudioEndpoints(flow, DEVICE_STATE_ACTIVE)?;
            let count = collection.GetCount()?;

            for index in 0..count {
                let device = collection.Item(index)?;
                let device_id = device.GetId()?.to_string()?;
                let label = friendly_name(&device).unwrap_or_else(|_| {
                    if kind == "audioinput" {
                        format!("Microphone {}", index + 1)
                    } else {
                        format!("Speaker {}", index + 1)
                    }
                });

                devices.push(NativeDevice {
                    is_default: default_id == Some(device_id.as_str()),
                    device_id,
                    label,
                    kind: kind.to_string(),
                });
            }
        }

        return Ok(devices);
    }

    unsafe fn default_endpoint_id(
        enumerator: &IMMDeviceEnumerator,
        flow: windows::Win32::Media::Audio::EDataFlow,
    ) -> windows::core::Result<String> {
        let device = enumerator.GetDefaultAudioEndpoint(flow, eCommunications)?;
        Ok(device.GetId()?.to_string()?)
    }

    unsafe fn friendly_name(device: &IMMDevice) -> windows::core::Result<String> {
        let store = device.OpenPropertyStore(STGM_READ)?;
        let mut value = store.GetValue(&PKEY_Device_FriendlyName)?;
        let text: PWSTR = PropVariantToStringAlloc(&value)?;
        let name = text.to_string()?;
        CoTaskMemFree(Some(text.0 as _));
        PropVariantClear(&mut value)?;
        Ok(name)
    }
}

#[cfg(target_os = "windows")]
fn enumerate_windows_video_devices() -> windows::core::Result<Vec<NativeDevice>> {
    use windows::core::PWSTR;
    use windows::Win32::Media::MediaFoundation::{
        IMFActivate, IMFAttributes, MFCreateAttributes, MFEnumDeviceSources, MFShutdown, MFStartup,
        MFSTARTUP_NOSOCKET, MF_DEVSOURCE_ATTRIBUTE_FRIENDLY_NAME,
        MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE, MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_GUID,
        MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_SYMBOLIC_LINK, MF_VERSION,
    };
    use windows::Win32::System::Com::{CoInitializeEx, CoTaskMemFree, COINIT_MULTITHREADED};

    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let _ = MFStartup(MF_VERSION, MFSTARTUP_NOSOCKET);

        let mut attributes: Option<IMFAttributes> = None;
        MFCreateAttributes(&mut attributes, 1)?;
        let attributes = attributes.unwrap();

        attributes.SetGUID(
            &MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE,
            &MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_GUID,
        )?;

        let mut devices_ptr: *mut Option<IMFActivate> = std::ptr::null_mut();
        let mut count: u32 = 0;

        MFEnumDeviceSources(&attributes, &mut devices_ptr, &mut count)?;

        let mut native_devices = Vec::new();

        if !devices_ptr.is_null() && count > 0 {
            for i in 0..count as usize {
                let device_ptr = devices_ptr.add(i);
                if let Some(activate) = (*device_ptr).take() {
                    let mut pwsz_name: PWSTR = PWSTR::null();
                    let mut cch_name = 0;
                    let label = if activate
                        .GetAllocatedString(
                            &MF_DEVSOURCE_ATTRIBUTE_FRIENDLY_NAME,
                            &mut pwsz_name,
                            &mut cch_name,
                        )
                        .is_ok()
                    {
                        let name = pwsz_name.to_string().unwrap_or_default();
                        CoTaskMemFree(Some(pwsz_name.0 as _));
                        name
                    } else {
                        format!("Camera {}", i + 1)
                    };

                    let mut pwsz_link: PWSTR = PWSTR::null();
                    let mut cch_link = 0;
                    let device_id = if activate
                        .GetAllocatedString(
                            &MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_SYMBOLIC_LINK,
                            &mut pwsz_link,
                            &mut cch_link,
                        )
                        .is_ok()
                    {
                        let link = pwsz_link.to_string().unwrap_or_default();
                        CoTaskMemFree(Some(pwsz_link.0 as _));
                        link
                    } else {
                        format!("camera_link_{}", i)
                    };

                    native_devices.push(NativeDevice {
                        device_id,
                        label,
                        kind: "videoinput".to_string(),
                        is_default: false,
                    });
                }
            }
            CoTaskMemFree(Some(devices_ptr as _));
        }

        let _ = MFShutdown();
        Ok(native_devices)
    }
}

#[tauri::command]
pub fn get_native_audio_devices() -> Vec<NativeDevice> {
    #[cfg(target_os = "windows")]
    {
        match enumerate_windows_audio_devices() {
            Ok(devices) => {
                let inputs = devices
                    .iter()
                    .filter(|device| device.kind == "audioinput")
                    .count();
                let outputs = devices
                    .iter()
                    .filter(|device| device.kind == "audiooutput")
                    .count();
                log::info!("[AudioDevices] Enumerated {inputs} input(s), {outputs} output(s)");
                devices
            }
            Err(err) => {
                log::warn!("[AudioDevices] Failed to enumerate Windows audio devices: {err}");
                Vec::new()
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        Vec::new()
    }
}

#[tauri::command]
pub fn get_native_video_devices() -> Vec<NativeDevice> {
    #[cfg(target_os = "windows")]
    {
        match enumerate_windows_video_devices() {
            Ok(devices) => {
                let cameras = devices.len();
                log::info!("[VideoDevices] Enumerated {cameras} camera(s)");
                devices
            }
            Err(err) => {
                log::warn!("[VideoDevices] Failed to enumerate Windows video devices: {err}");
                Vec::new()
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_enumerate_video_devices() {
        let devices = enumerate_windows_video_devices().unwrap();
        println!("===> Enumerate video devices output: {:?}", devices);
    }
}
